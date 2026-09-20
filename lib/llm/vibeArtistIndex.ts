/**
 * Deterministic artist-name resolution against the real `artists` table.
 *
 * This is the half of the fix that makes "justin bieber" work. The Stage A model is only asked to
 * *extract* names it sees written in the prompt; turning a name into a real artist id happens here,
 * in TypeScript, against actual rows -- so it is correct even with Ollama down, and an artist that
 * does not exist in the library simply fails to resolve instead of becoming a fuzzy text filter.
 *
 * The prompt is ALSO scanned directly (scanPromptForArtists), so the common case needs no LLM at all.
 *
 * Pure except for loadArtistIndex: callers pass the index in. See the note in lib/text/fuzzy.ts.
 */
import { fuzzyMatches, normalizeLoose, normalizeTight } from "../text/fuzzy";

export interface ArtistIndexEntry {
  id: number;
  name: string;
  /** normalizeLoose(name) -- word boundaries preserved, so tokenCount is meaningful. */
  loose: string;
  /** normalizeTight(name) -- separators removed, so "acdc" finds "AC/DC". */
  tight: string;
  tokenCount: number;
}

export interface ArtistScanHit {
  id: number;
  name: string;
  /** True when this hit is safe to treat as a HARD constraint (see the single-token rule below). */
  confident: boolean;
}

/**
 * Single-token artist names that are also ordinary English words. This library really does contain
 * artists called Yes, Used, Player, Artist, Future, Queen, Sweet, Offset, KISS, Lens, Serum, GIRLS
 * and positions, so a naive "does this word appear in the prompt" scan would read "music for the
 * future" as a hard Future constraint and "songs I'm used to" as a hard Used constraint.
 *
 * A name in this set only resolves when the whole prompt IS that word (see scanPromptForArtists).
 * The list is intentionally about the WORD, not about which artists happen to exist today -- adding
 * an artist called "Rain" later needs no change here.
 */
const COMMON_WORDS = new Set(
  (
    "a an the and or but for of to in on at by with from into over under after before " +
    "i me my we us you your they them he she it its this that these those " +
    "is am are was were be been being do does did done have has had will would can could should " +
    "not no yes maybe only just very really more most some any all every none " +
    "song songs music track tracks playlist playlists radio mix mixes album albums artist artists " +
    "band bands sound sounds vibe vibes vibey beat beats tune tunes hit hits set sets " +
    "play playing played listen listening new old classic classics best top good great bad " +
    "slow fast hard soft loud quiet deep dark light bright warm cold cool hot chill chilled " +
    "happy sad angry calm relaxed energetic upbeat mellow moody dreamy sleepy " +
    "morning afternoon evening night nights midnight day days weekend summer winter spring autumn fall " +
    "drive driving walk walking run running workout gym study studying work working party parties " +
    "dance dancing sleep sleeping cook cooking clean cleaning focus " +
    "love lover loving heart hearts life live living time times day " +
    "future past present queen king girls girl boys boy man woman men women people " +
    "used using use player players game games kiss kisses lens serum notion positions position " +
    "offset sweet sweeter salute voltage friction ares eagles campbell dave " +
    "up down out back home away here there when where what why how who"
  ).split(" ")
);

export function buildArtistIndex(rows: { id: number; name: string }[]): ArtistIndexEntry[] {
  const out: ArtistIndexEntry[] = [];
  for (const row of rows) {
    const loose = normalizeLoose(row.name);
    if (!loose) continue; // e.g. an artist named only with symbols -- nothing to match on
    out.push({ id: row.id, name: row.name, loose, tight: normalizeTight(row.name), tokenCount: loose.split(" ").length });
  }
  return out;
}

/** Both normalized forms point at the same entry. First writer wins, so two artists normalizing
 *  identically ("Beyonce" / "Beyoncé") resolve to whichever the DB returned first rather than
 *  silently swapping between requests. */
function indexByForm(index: ArtistIndexEntry[]): Map<string, ArtistIndexEntry> {
  const map = new Map<string, ArtistIndexEntry>();
  for (const entry of index) {
    if (!map.has(entry.loose)) map.set(entry.loose, entry);
    if (!map.has(entry.tight)) map.set(entry.tight, entry);
  }
  return map;
}

/**
 * Finds artists named directly in the prompt, without asking an LLM.
 *
 * Multi-token names are matched anywhere in the prompt -- "justin bieber", "spice girls" and
 * "dr dre" are specific enough that a chance collision is not a real concern. Single-token names
 * are the dangerous case and are split in two:
 *   - a name that is NOT an ordinary English word ("netsky", "doechii") matches anywhere, so
 *     "songs like netsky" works;
 *   - a name that IS an ordinary English word ("future", "queen", "yes") matches only when the
 *     whole prompt is exactly that word -- so "future" resolves but "music for the future" does not.
 * A common-word name can still become a hard constraint when the Stage A model explicitly nominates
 * it (resolveArtistName), because then the model has asserted it is being used as a name.
 */
export function scanPromptForArtists(prompt: string, index: ArtistIndexEntry[]): ArtistScanHit[] {
  const loosePrompt = normalizeLoose(prompt);
  if (!loosePrompt) return [];
  const tokens = loosePrompt.split(" ");
  const byForm = indexByForm(index);
  const hits = new Map<number, ArtistScanHit>();
  const consider = (entry: ArtistIndexEntry | undefined) => {
    if (!entry || hits.has(entry.id)) return;
    // A common-word name must be the ENTIRE prompt -- not merely what's left after dropping filler.
    // Stripping filler first would reduce "music for the future" to "future" and hand back a hard
    // Future constraint, which is the exact false positive this guard exists to prevent.
    if (entry.tokenCount === 1 && COMMON_WORDS.has(entry.loose) && loosePrompt !== entry.loose) return;
    hits.set(entry.id, { id: entry.id, name: entry.name, confident: true });
  };

  // n-grams longest-first so "spice girls" is preferred over a bare "girls".
  for (let size = Math.min(4, tokens.length); size >= 1; size--) {
    for (let start = 0; start + size <= tokens.length; start++) {
      const gram = tokens.slice(start, start + size).join(" ");
      consider(byForm.get(gram));
      consider(byForm.get(gram.replace(/ /g, "")));
    }
  }
  return [...hits.values()];
}

/**
 * Resolves one artist name supplied by the Stage A model. Exact on either normalized form first,
 * then a gated fuzzy pass.
 *
 * The fuzzy tier is gated on length because fuzzyMatches treats "one string contains the other" as
 * a match -- ideal for song titles ("Song" vs "Song - Remastered"), far too loose for short artist
 * names, where it would make "Dave" match "Dave Grohl" and "Bou" match "Boubacar". Names shorter
 * than 4 characters must match exactly.
 */
export function resolveArtistName(name: string, index: ArtistIndexEntry[]): ArtistIndexEntry | null {
  const loose = normalizeLoose(name);
  if (!loose) return null;
  const tight = normalizeTight(name);
  const byForm = indexByForm(index);
  const exact = byForm.get(loose) ?? byForm.get(tight);
  if (exact) return exact;
  if (loose.length < 4) return null;
  return index.find((entry) => entry.loose.length >= 4 && fuzzyMatches(loose, entry.loose)) ?? null;
}
