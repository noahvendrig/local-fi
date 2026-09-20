import { and, eq, isNull, or, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { artists, musicbrainzEnrichJobTracks, musicbrainzEnrichJobs, tracks } from "../db/schema";
import { normalizeLoose } from "../text/fuzzy";
import { canonicalizeGenreQuery } from "../llm/vibeVocabulary";
import { searchRecordings, type MusicBrainzCandidate } from "./client";
import { publishMusicbrainzEnrichJobUpdate } from "./enrichEvents";

/** Trailing decorations that describe a RELEASE rather than the song, and which keep a local title
 *  from matching the catalog's. Stripped before searching so "Big Poppa - 2007 Remaster" finds
 *  "Big Poppa" -- which is the whole point of this pass. */
// Note the deliberate absence of "remix", "edit" and bare "mix": a Wilkinson Remix or a VIP Edit is
// a genuinely different recording with its own release date, so stripping those would match the
// wrong thing. Only labels that describe a re-release OF THE SAME recording are listed.
const EDITION_SUFFIX = /\s*[-–—]\s*(\d{4}\s+)?(remaster(ed)?|reissue|mono|stereo|single (version|mix)|album (version|mix)|original mix|radio edit|anniversary edition|deluxe( edition)?|expanded( edition)?)(\s+\d{4})?\s*$/i;
/** yt-dlp / download-site noise in bracket groups, same shapes lib/spotify/enrichMatch.ts strips. */
const BRACKET_NOISE = /\s*[[(][^[\]()]*(official|lyrics?|audio|video|visualizer|hq|hd|4k|kbps|[\w.-]+\.[a-z]{2,6})[^[\]()]*[\])]\s*/gi;
/** A bare "[dQw4w9WgXcQ]" filename-fallback tag from lib/import/tags.ts. */
const VIDEO_ID_TAG = /\s*\[[\w-]{6,15}\]\s*$/;

/** How much of the local title has to survive cleaning for the result to still be searchable. */
const MIN_SEARCHABLE_TITLE = 2;

export function cleanTitleForSearch(title: string): string {
  let result = title.replace(BRACKET_NOISE, " ").replace(VIDEO_ID_TAG, " ");
  // Applied repeatedly: real titles carry stacked suffixes ("- Single Mix - 2011 Remaster").
  let previous: string;
  do {
    previous = result;
    result = result.replace(EDITION_SUFFIX, "");
  } while (result !== previous);
  return result.replace(/["']/g, "").replace(/\s+/g, " ").trim();
}

/** Strips a featured-artist credit, which the catalog models as a separate relationship rather than
 *  as part of the artist name. */
function primaryArtist(name: string): string {
  return name.replace(/\s*[(\[]?\bfeat(uring)?\.?\b.*$/i, "").replace(/\s*[,&x×]\s.*$/i, "").trim();
}

/**
 * Whether a catalog candidate is the same song as the local track.
 *
 * Deliberately conservative, for the same reason lib/spotify/enrichMatch.ts is: a false negative
 * skips one track, a false positive writes the wrong year and genre onto it. The title must match
 * exactly or be a prefix (so "Roxanne" matches "Roxanne (live)" but not "Roxanne's Revenge").
 *
 * The artist must match EXACTLY once a leading article is discounted ("The Police" vs "Police").
 * Substring correspondence was tried first and is too loose to be safe on short names: searching
 * this library's Lloyd for "You" accepts recordings by "Lloyd Banks" and "Olivia Ellen Lloyd",
 * which is how a 2006 R&B track acquired an original release year of 1959.
 */
function isSameSong(candidate: MusicBrainzCandidate, title: string, artist: string): boolean {
  const candidateTitle = normalizeLoose(candidate.title);
  const candidateArtist = normalizeLoose(candidate.artistName ?? "");
  if (!candidateTitle || !title) return false;
  if (candidateTitle !== title && !candidateTitle.startsWith(`${title} `)) return false;
  if (!artist) return true;
  return withoutArticle(candidateArtist) === withoutArticle(artist);
}

const withoutArticle = (name: string): string => name.replace(/^the /, "");

/** A tag needs at least this many votes to be believed at all. */
const MIN_TAG_VOTES = 2;
/** ...and at least this share of the top tag's votes, so a couple of stray votes on a well-tagged
 *  song still lose to the consensus. */
const TAG_VOTE_SHARE = 0.25;
const MAX_GENRES = 4;

/**
 * Canonical genre tokens for the app's vocabulary, from MusicBrainz's tag names.
 *
 * Votes are the whole point here. MusicBrainz tags are open folksonomy, so a single user really can
 * put "dance" and "house" on AC/DC's "Thunderstruck" -- which is exactly what this library's first
 * enrichment run wrote before this threshold existed. Aggregated across matching recordings that
 * track reads hard rock 9, rock 5, classic rock 4, dance 1, house 1, and the cutoff keeps the first
 * three and drops the last two.
 *
 * Curated `genres` win outright when a recording has any, since those are moderated rather than
 * free-form. Mapping through canonicalizeGenreQuery keeps enriched genres in the same namespace the
 * matcher and the Stage A prompt use, instead of introducing a second spelling of every genre.
 */
function canonicalGenres(candidates: MusicBrainzCandidate[]): string[] {
  const votes = new Map<string, number>();
  const tally = (entries: { name: string; count: number }[]) => {
    for (const entry of entries) votes.set(entry.name, (votes.get(entry.name) ?? 0) + entry.count);
  };

  for (const candidate of candidates) tally(candidate.genres);
  if (votes.size === 0) for (const candidate of candidates) tally(candidate.tags);
  if (votes.size === 0) return [];

  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const cutoff = Math.max(MIN_TAG_VOTES, ranked[0][1] * TAG_VOTE_SHARE);

  const out: string[] = [];
  for (const [name, count] of ranked) {
    if (count < cutoff) break;
    for (const canonical of canonicalizeGenreQuery(name)) {
      if (!out.includes(canonical)) out.push(canonical);
    }
  }
  return out.slice(0, MAX_GENRES);
}

export interface MusicBrainzResolution {
  originalYear: number | null;
  genres: string[];
  matchCount: number;
}

/** Pure half of the match, exported for the eval script. */
export function resolveFromCandidates(candidates: MusicBrainzCandidate[], title: string, artist: string): MusicBrainzResolution {
  const wantTitle = normalizeLoose(cleanTitleForSearch(title));
  const wantArtist = normalizeLoose(primaryArtist(artist));
  const matches = candidates.filter((c) => isSameSong(c, wantTitle, wantArtist));
  const years = matches.flatMap((c) => c.years);
  return {
    originalYear: years.length > 0 ? Math.min(...years) : null,
    genres: canonicalGenres(matches),
    matchCount: matches.length,
  };
}

/**
 * Looks one track up in MusicBrainz and fills in what it can.
 *
 * Two write rules, both about never making things worse:
 *
 *   ORIGINAL YEAR is only written when it is EARLIER than the tag year. A reissue's tag is always at
 *   or after the true original, so an earlier catalog year means the tag was a reissue date, while a
 *   later one means the search simply missed the original pressing. Verified against this library:
 *   the rule rescues "Big Poppa" (tag 2007 -> 1994) and "Roxanne" (tag 2007 -> 1978) while leaving
 *   AC/DC's "Thunderstruck" and Van Halen's "Jump" alone, whose tags are already correct and whose
 *   catalog lookups come back five and one years too late respectively.
 *
 *   GENRE is only written over a `detected` value (CNN14's AudioSet guess) or a missing one. A tag
 *   the user's own file carried, or one they set by hand, always wins -- a departure from the
 *   "only fill gaps" contract in lib/similarity/queue.ts, justified because `detected` is precisely
 *   the low-confidence source this pass exists to replace.
 *
 * A track the catalog has nothing confident for is recorded as `no_match`, not `failed`: not every
 * song in a local library is in MusicBrainz, and that is expected rather than an error.
 */
export async function enrichTrackFromMusicBrainz(trackId: number, jobTrackId: number, jobId: number): Promise<void> {
  const db = getDb();
  const now = () => new Date().toISOString();

  const track = db
    .select({
      id: tracks.id,
      title: tracks.title,
      year: tracks.year,
      genreSource: tracks.genreSource,
      artistName: artists.name,
    })
    .from(tracks)
    .leftJoin(artists, eq(tracks.artistId, artists.id))
    .where(eq(tracks.id, trackId))
    .get();

  db.update(musicbrainzEnrichJobTracks).set({ status: "matching", updatedAt: now() }).where(eq(musicbrainzEnrichJobTracks.id, jobTrackId)).run();

  const finish = (status: "matched" | "no_match" | "failed", message?: string) => {
    db.update(musicbrainzEnrichJobTracks).set({ status, errorMessage: message ?? null, updatedAt: now() }).where(eq(musicbrainzEnrichJobTracks.id, jobTrackId)).run();
    db.update(musicbrainzEnrichJobs)
      .set({
        processedTracks: sql`${musicbrainzEnrichJobs.processedTracks} + 1`,
        ...(status === "matched" ? { matchedTracks: sql`${musicbrainzEnrichJobs.matchedTracks} + 1` } : {}),
        ...(status === "failed" ? { failedTracks: sql`${musicbrainzEnrichJobs.failedTracks} + 1` } : {}),
      })
      .where(eq(musicbrainzEnrichJobs.id, jobId))
      .run();
    publishMusicbrainzEnrichJobUpdate(jobId);
  };

  const searchTitle = cleanTitleForSearch(track?.title ?? "");
  if (!track || searchTitle.length < MIN_SEARCHABLE_TITLE) {
    finish("no_match", "No usable title to search on.");
    return;
  }

  const candidates = await searchRecordings(searchTitle, primaryArtist(track.artistName ?? ""));
  const resolution = resolveFromCandidates(candidates, track.title ?? "", track.artistName ?? "");
  if (resolution.matchCount === 0) {
    finish("no_match", "No confident MusicBrainz match.");
    return;
  }

  let wrote = false;

  // Only ever move a year earlier -- see the doc comment above.
  if (resolution.originalYear != null && (track.year == null || resolution.originalYear < track.year)) {
    db.update(tracks)
      .set({ originalYear: resolution.originalYear, originalYearSource: "musicbrainz" })
      .where(and(eq(tracks.id, trackId), isNull(tracks.originalYearSource)))
      .run();
    wrote = true;
  }

  // Conditional update rather than read-then-write, so a concurrent manual edit can't be raced --
  // same shape as the genre backfill in lib/similarity/queue.ts.
  if (resolution.genres.length > 0) {
    const result = db
      .update(tracks)
      .set({ genre: resolution.genres.join(", "), genreSource: "musicbrainz" })
      .where(and(eq(tracks.id, trackId), or(isNull(tracks.genreSource), eq(tracks.genreSource, "detected"))))
      .run();
    if (result.changes > 0) wrote = true;
  }

  finish(wrote ? "matched" : "no_match", wrote ? undefined : "Nothing new to add.");
}
