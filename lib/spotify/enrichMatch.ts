import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { artists, spotifyEnrichJobTracks, spotifyEnrichJobs, tracks } from "../db/schema";
import { normalizeForFingerprint } from "../import/fingerprint";
import { SpotifyQuotaExceededError, parseReleaseYear, searchTracks, type SpotifyTrackMetadata } from "./client";
import { publishSpotifyEnrichJobUpdate } from "./enrichEvents";
import { fuzzyMatches } from "../text/fuzzy";

function bestMatch(localTitle: string, localArtist: string, candidates: SpotifyTrackMetadata[]): SpotifyTrackMetadata | null {
  const normTitle = normalizeForFingerprint(localTitle);
  const normArtist = normalizeForFingerprint(localArtist);
  return (
    candidates.find((c) => fuzzyMatches(normTitle, normalizeForFingerprint(c.title)) && c.artists.some((a) => fuzzyMatches(normArtist, normalizeForFingerprint(a)))) ??
    null
  );
}

// Trailing bracket/paren groups worth stripping before a catalog search — download-site/player
// decoration that a YouTube-sourced local file accumulates but the real Spotify title never has.
// Deliberately NOT stripping things like "(Wilkinson Remix)" or "(Radio Edit)" here: those are
// often literally part of the Spotify title too, so keeping them can help a match as easily as
// hurt one, and bestMatch's fuzzy contains-check tolerates them being present either way.
const SEARCH_NOISE_PATTERN =
  /\b(official|lyrics?|audio|video|visualizer|acapella|instrumental|drumless|vocals?|clean|explicit|hq|hd|4k|karaoke|kbps)\b/i;
// A bracket/paren group that's just a bare domain-ish token, e.g. "[ ezmp3.cc ]", "(ytmp3s.net)".
const DOWNLOAD_SITE_PATTERN = /^[\w.-]+\.[a-z]{2,6}$/i;
// The yt-dlp "[videoId]" filename-fallback tag (lib/import/tags.ts's filenameFallback) -- a bare
// no-space alphanumeric token, never a real title fragment (which would have spaces).
const VIDEO_ID_PATTERN = /^[\w-]{6,15}$/;

/** Iteratively strips trailing "[...]"/"(...)" groups that are download-site noise (yt-dlp/
 *  browser-extension tags like "[ ezmp3.cc ]", "(320 kbps)") or common non-title descriptors
 *  ("(Official Video)", "(Lyrics)", "(Acapella)", "[vocals]") -- meaningless to a catalog search,
 *  and left untouched by earlier code this only ever removed the trailing "[videoId]" yt-dlp
 *  fallback pattern, which left titles like "Silver Soul [OFFICIAL VIDEO]" or "Sex on Fire
 *  (Lyrics)" un-searchable. Stops at the first trailing group that doesn't look like noise (e.g.
 *  "(Wilkinson Remix)"), so genuine remix/edit info in the title is left alone. Also drops stray
 *  quotes so they can't break a quoted search term. */
function cleanForSearch(value: string): string {
  let result = value.trim();
  while (true) {
    const match = result.match(/\s*[[(]([^[\]()]*)[\])]\s*$/);
    if (!match) break;
    const inner = match[1].trim();
    const isNoise =
      SEARCH_NOISE_PATTERN.test(inner) ||
      DOWNLOAD_SITE_PATTERN.test(inner) ||
      /^\d+\s*kbps$/i.test(inner) ||
      VIDEO_ID_PATTERN.test(inner);
    if (!isNoise) break;
    result = result.slice(0, match.index).trim();
  }
  return result.replace(/"/g, "").trim();
}

/**
 * Looks up one track against the Spotify catalog by title+artist and fills in its release year if
 * still missing — tag and manually-set values always win, this only fills gaps (same contract as
 * lib/analysis/detect.ts's analyzeTrack). Genre is NOT sourced from here: Spotify deprecated the
 * artist `genres` field (confirmed against their own API reference — every artist object omits
 * it now, popular or obscure), so there's nothing left to look up; genre is instead backfilled
 * from on-device audio analysis (see lib/similarity/queue.ts). Tracks with no confident Spotify
 * match, or a match with nothing useful to add, are recorded as `no_match` rather than `failed` —
 * not every song in a local library is on Spotify's catalog, and that's expected, not an error.
 */
export async function enrichTrackFromSpotify(trackId: number, jobTrackId: number, jobId: number): Promise<void> {
  const db = getDb();
  const now = () => new Date().toISOString();

  db.update(spotifyEnrichJobTracks).set({ status: "matching", updatedAt: now() }).where(eq(spotifyEnrichJobTracks.id, jobTrackId)).run();
  publishSpotifyEnrichJobUpdate(jobId);

  const finishNoMatch = () => {
    db.update(spotifyEnrichJobTracks).set({ status: "no_match", updatedAt: now() }).where(eq(spotifyEnrichJobTracks.id, jobTrackId)).run();
    db.update(spotifyEnrichJobs).set({ processedTracks: sql`${spotifyEnrichJobs.processedTracks} + 1` }).where(eq(spotifyEnrichJobs.id, jobId)).run();
    publishSpotifyEnrichJobUpdate(jobId);
  };

  try {
    const row = db
      .select({ title: tracks.title, year: tracks.year, artistName: artists.name })
      .from(tracks)
      .innerJoin(artists, eq(tracks.artistId, artists.id))
      .where(eq(tracks.id, trackId))
      .get();

    if (!row || !row.title) {
      finishNoMatch();
      return;
    }

    // Genre is deliberately not checked here — Spotify has nothing to offer for it (see the
    // docstring above), so a track missing only genre would always end in a wasted search.
    if (row.year != null) {
      finishNoMatch();
      return;
    }

    // "Unknown Artist" is filenameFallback's placeholder for a file with no embedded tags and no
    // "Artist - Title" in its filename to fall back to (common for yt-dlp downloads outside the
    // Spotify-import flow, which always has a real artist). There's nothing to confidently match
    // against without a real artist name, so skip the Spotify round-trip entirely rather than
    // burn rate-limit budget on a search that bestMatch's artist check would reject anyway.
    if (!row.artistName || normalizeForFingerprint(row.artistName) === "unknown artist") {
      finishNoMatch();
      return;
    }

    const cleanTitle = cleanForSearch(row.title);
    const cleanArtist = cleanForSearch(row.artistName);
    // A plain query, not Spotify's track:"..."/artist:"..." field-filter syntax — confirmed live
    // that the field-filtered form is too brittle for real-world local titles: e.g.
    // track:"Rock It (Wilkinson Remix)" artist:"Sub Focus" returned zero results while the exact
    // same terms as a plain query found "Rock It - Wilkinson Remix" by Sub Focus & Wilkinson
    // immediately. bestMatch below independently re-verifies both title and artist on every
    // candidate, so the precision the field filter was meant to add isn't lost by dropping it.
    const results = await searchTracks(`${cleanTitle} ${cleanArtist}`, 5);
    const match = bestMatch(cleanTitle, cleanArtist, results);
    if (!match) {
      finishNoMatch();
      return;
    }

    const year = parseReleaseYear(match.releaseDate);
    if (year == null) {
      finishNoMatch();
      return;
    }

    db.update(tracks).set({ year }).where(eq(tracks.id, trackId)).run();
    db.update(spotifyEnrichJobTracks).set({ status: "matched", updatedAt: now() }).where(eq(spotifyEnrichJobTracks.id, jobTrackId)).run();
    db.update(spotifyEnrichJobs)
      .set({ processedTracks: sql`${spotifyEnrichJobs.processedTracks} + 1`, matchedTracks: sql`${spotifyEnrichJobs.matchedTracks} + 1` })
      .where(eq(spotifyEnrichJobs.id, jobId))
      .run();
    publishSpotifyEnrichJobUpdate(jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Spotify lookup failed";
    db.update(spotifyEnrichJobTracks)
      .set({ status: "failed", errorMessage: message, updatedAt: now() })
      .where(eq(spotifyEnrichJobTracks.id, jobTrackId))
      .run();
    db.update(spotifyEnrichJobs)
      .set({ processedTracks: sql`${spotifyEnrichJobs.processedTracks} + 1`, failedTracks: sql`${spotifyEnrichJobs.failedTracks} + 1` })
      .where(eq(spotifyEnrichJobs.id, jobId))
      .run();
    publishSpotifyEnrichJobUpdate(jobId);

    // Not an ordinary per-track failure — the whole app is locked out for hours, so every other
    // track still queued behind this one would fail the exact same way. Rethrow so the queue can
    // stop the rest of the job dead instead of grinding through them one by one.
    if (err instanceof SpotifyQuotaExceededError) throw err;
  }
}
