/**
 * Minimal MusicBrainz web-service client.
 *
 * Exists because the two metadata fields vibe matching most depends on are the two this library is
 * worst at:
 *
 *   ORIGINAL RELEASE YEAR. `tracks.year` comes from the file's tag, which on a reissue describes the
 *   reissue: Notorious B.I.G.'s "Big Poppa - 2007 Remaster" is stored as 2007 though the recording is
 *   from 1994, and The Police's "Roxanne" as 2007 though it is from 1978. An era query that trusts
 *   `year` cannot reach either. MusicBrainz's first-release-date is exactly the missing field.
 *
 *   GENRE. `tracks.genre` is mostly CNN14's AudioSet guess (python-backend/services/similarity/
 *   genre.py) — a 527-class sound-event taxonomy, not a genre vocabulary, which is why Spice Girls
 *   tracks in this library are labelled "Hip Hop". MusicBrainz genres are human-curated tags.
 *
 * No API key and no OAuth, unlike lib/spotify/client.ts. In exchange there is a hard rate limit of
 * one request per second and a mandatory descriptive User-Agent; both are handled here.
 */

const API_BASE = "https://musicbrainz.org/ws/2";

/**
 * MusicBrainz requires a User-Agent identifying the application and a contact address, and blocks
 * clients that omit it. Overridable so someone running a fork can identify it as theirs.
 */
const USER_AGENT = process.env.LOCALFI_MUSICBRAINZ_USER_AGENT ?? "local-fi/1.0 (https://github.com/local-fi)";

/**
 * MusicBrainz asks for at most one request per second per client, averaged. 1100ms leaves headroom
 * for clock jitter -- being throttled costs far more than the extra 100ms, since a 503 here means
 * re-queueing the track.
 */
const MIN_REQUEST_INTERVAL_MS = 1_250;
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * A 503 from MusicBrainz means "you are going too fast", not "stop" — it is transient, and the
 * documented response is to back off and retry. Retrying matters more than it looks: the enrichment
 * queue treats an escaped MusicBrainzRateLimitedError as fatal to the whole run, so without this a
 * single throttle 85 tracks into a 445-track backfill abandons the other 360 (observed exactly that
 * on this library). The service throttles in bursts rather than on a strict average, so waiting out
 * one burst is nearly always enough.
 */
const MAX_RATE_LIMIT_RETRIES = 4;
/** Doubles per attempt: 2s, 4s, 8s, 16s — 30s of patience before the run is given up on. */
const RATE_LIMIT_BACKOFF_MS = 2_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class MusicBrainzRateLimitedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MusicBrainzRateLimitedError";
  }
}

/**
 * Serializes every call in this process behind the rate limit.
 *
 * A promise chain rather than a timestamp check: concurrent callers must queue behind each other,
 * not each independently observe "the last request was long enough ago" and fire together. The
 * enrichment queue is already concurrency 1, but nothing stops another caller appearing later.
 */
let rateLimitChain: Promise<void> = Promise.resolve();

function nextSlot(): Promise<void> {
  const wait = rateLimitChain.then(() => new Promise<void>((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS)));
  rateLimitChain = wait;
  return wait;
}

async function musicBrainzGet<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries({ ...params, fmt: "json" })) url.searchParams.set(key, value);

  for (let attempt = 0; ; attempt++) {
    // Inside the loop so a retry queues behind the rate limiter like any other request rather than
    // jumping ahead of the calls already waiting.
    await nextSlot();

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return null; // Network blip or timeout — the track is recorded as no_match, not a hard failure.
    }

    if (res.status === 503) {
      // Only give up once backing off has repeatedly failed: the caller treats this as fatal to the
      // entire run, so throwing on the first 503 costs every remaining track.
      if (attempt >= MAX_RATE_LIMIT_RETRIES) {
        throw new MusicBrainzRateLimitedError("MusicBrainz is still rate-limiting this client after several backoffs.");
      }
      await sleep(RATE_LIMIT_BACKOFF_MS * 2 ** attempt);
      continue;
    }

    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as T | null;
  }
}

interface MusicBrainzRecording {
  id: string;
  title: string;
  score?: number;
  "artist-credit"?: { name: string }[];
  "first-release-date"?: string;
  releases?: { date?: string; "release-group"?: { "first-release-date"?: string } }[];
  genres?: { name: string; count: number }[];
  tags?: { name: string; count: number }[];
}

interface RecordingSearchResponse {
  recordings?: MusicBrainzRecording[];
}

export interface MusicBrainzCandidate {
  recordingId: string;
  title: string;
  artistName: string | null;
  /** Every release year seen on this recording. The caller takes the minimum across all candidates
   *  it accepts as a match — see the note on searchRecordings. */
  years: number[];
  /** MusicBrainz's curated genre list for this recording, with vote counts. Usually empty. */
  genres: WeightedTag[];
  /** Free folksonomy tags, with vote counts. Much better populated, and much noisier: a single
   *  user can put "house" on an AC/DC track, so counts matter (see enrichMatch.ts). */
  tags: WeightedTag[];
}

export interface WeightedTag {
  name: string;
  count: number;
}

function parseYear(value: string | undefined): number | null {
  if (!value) return null;
  const year = Number(value.slice(0, 4));
  return Number.isInteger(year) && year >= 1000 && year <= 2999 ? year : null;
}

function releaseYears(recording: MusicBrainzRecording): number[] {
  const years: number[] = [];
  const direct = parseYear(recording["first-release-date"]);
  if (direct != null) years.push(direct);
  for (const release of recording.releases ?? []) {
    const groupYear = parseYear(release["release-group"]?.["first-release-date"]);
    if (groupYear != null) years.push(groupYear);
    const releaseYear = parseYear(release.date);
    if (releaseYear != null) years.push(releaseYear);
  }
  return years;
}

function weightedTags(entries: { name: string; count: number }[] | undefined): WeightedTag[] {
  return (entries ?? []).filter((entry) => entry.count > 0).map((entry) => ({ name: entry.name, count: entry.count }));
}

/** Lucene special characters that would otherwise change the meaning of the query. */
function escapeLucene(value: string): string {
  return value.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, "\\$1");
}

/**
 * Searches MusicBrainz for recordings of one song.
 *
 * Returns MANY candidates, and deliberately does not pick one. MusicBrainz holds a separate
 * recording per version of a song -- studio, live, remaster, every compilation appearance -- and the
 * top-scored result is usually a late one. Verified against this library: taking the first result
 * dates The Police's "Roxanne" to 1992 and Dr. Dre's "Still D.R.E." to 2005, while the minimum year
 * across all matching candidates gives the correct 1978 and 1999. The caller decides which
 * candidates count as the same song (lib/musicbrainz/enrichMatch.ts) and takes that minimum.
 *
 * The default limit is MusicBrainz's maximum for the same reason. Results come back in relevance
 * order, not date order, so the original pressing can sit well down the list: at limit 25 this
 * library's "Roxanne" resolves to 1990 and Duran Duran's "Girls on Film" to 1984, while at 100 both
 * come back correct (1978 and 1981). It costs nothing extra -- still one request.
 */
export async function searchRecordings(title: string, artist: string, limit = 100): Promise<MusicBrainzCandidate[]> {
  const terms = [`recording:"${escapeLucene(title)}"`];
  if (artist) terms.push(`artist:"${escapeLucene(artist)}"`);

  const data = await musicBrainzGet<RecordingSearchResponse>("/recording", {
    query: terms.join(" AND "),
    limit: String(limit),
  });

  return (data?.recordings ?? []).map((recording) => ({
    recordingId: recording.id,
    title: recording.title,
    artistName: recording["artist-credit"]?.[0]?.name ?? null,
    years: releaseYears(recording),
    genres: weightedTags(recording.genres),
    tags: weightedTags(recording.tags),
  }));
}
