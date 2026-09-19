import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { artists, spotifyEnrichJobTracks, spotifyEnrichJobs, tracks } from "../db/schema";
import { normalizeForFingerprint } from "../import/fingerprint";
import { SpotifyQuotaExceededError, parseReleaseYear, searchTracks, type SpotifyTrackMetadata } from "./client";
import { publishSpotifyEnrichJobUpdate } from "./enrichEvents";

/** Small in-house Levenshtein distance — titles/artist names are short, so the O(n*m) table is cheap
 *  and pulling in a dependency for one comparison isn't worth it. */
function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[rows - 1][cols - 1];
}

/** True when two normalized strings are close enough to call the same thing — exact, one contains
 *  the other (catches "Song Title" vs "Song Title - Remastered 2011"), or within a small edit
 *  distance (catches minor punctuation/typo differences). Deliberately conservative: a false
 *  negative just means one track gets skipped instead of enriched, a false positive writes wrong
 *  metadata, so this errs toward skipping. */
function fuzzyMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const distance = levenshtein(a, b);
  return distance <= Math.max(2, Math.floor(Math.min(a.length, b.length) * 0.15));
}

function bestMatch(localTitle: string, localArtist: string, candidates: SpotifyTrackMetadata[]): SpotifyTrackMetadata | null {
  const normTitle = normalizeForFingerprint(localTitle);
  const normArtist = normalizeForFingerprint(localArtist);
  return (
    candidates.find((c) => fuzzyMatches(normTitle, normalizeForFingerprint(c.title)) && c.artists.some((a) => fuzzyMatches(normArtist, normalizeForFingerprint(a)))) ??
    null
  );
}

/** Strips the trailing "[videoId]" yt-dlp leaves on the filename fallback (lib/import/tags.ts's
 *  filenameFallback) when a downloaded file had no embedded tags to read a real title from —
 *  meaningless noise for a catalog search. Also drops stray quotes so they can't break the
 *  track:"..."/artist:"..." field-search syntax below. */
function cleanForSearch(value: string): string {
  return value
    .replace(/\s*\[[\w-]{6,15}\]\s*$/, "")
    .replace(/"/g, "")
    .trim();
}

/**
 * Looks up one track against the Spotify catalog by title+artist and fills in whichever of
 * genre/year is still missing — tag and manually-set values always win, this only fills gaps
 * (same contract as lib/analysis/detect.ts's analyzeTrack). Tracks with no confident Spotify
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
      .select({ title: tracks.title, genre: tracks.genre, year: tracks.year, artistName: artists.name })
      .from(tracks)
      .innerJoin(artists, eq(tracks.artistId, artists.id))
      .where(eq(tracks.id, trackId))
      .get();

    if (!row || !row.title) {
      finishNoMatch();
      return;
    }

    const needsGenre = row.genre == null;
    const needsYear = row.year == null;
    if (!needsGenre && !needsYear) {
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
    const results = await searchTracks(`track:"${cleanTitle}" artist:"${cleanArtist}"`, 5, { includeGenres: true });
    const match = bestMatch(cleanTitle, cleanArtist, results);
    if (!match) {
      finishNoMatch();
      return;
    }

    const patch: { genre?: string; year?: number } = {};
    if (needsGenre && match.genres.length > 0) patch.genre = match.genres.join(", ");
    if (needsYear) {
      const year = parseReleaseYear(match.releaseDate);
      if (year != null) patch.year = year;
    }

    if (Object.keys(patch).length === 0) {
      finishNoMatch();
      return;
    }

    db.update(tracks).set(patch).where(eq(tracks.id, trackId)).run();
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
