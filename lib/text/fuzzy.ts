/**
 * Shared string-similarity and normalization helpers.
 *
 * `levenshtein`/`fuzzyMatches` were extracted verbatim from lib/spotify/enrichMatch.ts, where they
 * were module-private, so the vibe matcher (lib/llm/vibeArtistIndex.ts) can resolve a prompt's
 * artist names against the real `artists` table with the same conservative comparison the Spotify
 * catalog matcher uses. Behaviour there is unchanged.
 *
 * Deliberately dependency-free and importing nothing: scripts/vibe-eval.mts loads the vibe scoring
 * core directly under Node's TypeScript type-stripping, which does NOT resolve the `@/` tsconfig
 * alias. Every module in that core must therefore import only via relative paths, and this one sits
 * at the bottom of it.
 */

/** Small in-house Levenshtein distance — titles/artist names are short, so the O(n*m) table is cheap
 *  and pulling in a dependency for one comparison isn't worth it. */
export function levenshtein(a: string, b: string): number {
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
 *  metadata, so this errs toward skipping.
 *
 *  Note for callers matching ARTIST names (vibeArtistIndex.ts): the contains-check is safe for song
 *  titles but over-matches on short names, so gate this behind a minimum length there. */
export function fuzzyMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const distance = levenshtein(a, b);
  return distance <= Math.max(2, Math.floor(Math.min(a.length, b.length) * 0.15));
}

/** Accent/punctuation-insensitive form that KEEPS word boundaries as single spaces. Built for
 *  matching artist names as a user would type them: "Beyoncé" -> "beyonce", "JAŸ-Z" -> "jay z",
 *  "Dr. Dre" -> "dr dre", "A$AP Ferg" -> "asap ferg" ($ -> s, since it stands in for a letter in
 *  stylized names like A$AP and Ty Dolla $ign rather than being punctuation). */
export function normalizeLoose(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\$/g, "s")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Same as normalizeLoose but with separators DELETED rather than collapsed to spaces, so a user
 *  can type a stylized name without its punctuation: "AC/DC" -> "acdc", "blink-182" -> "blink182".
 *  Kept as a second form rather than replacing normalizeLoose because collapsing to nothing would
 *  also glue genuinely separate words together ("spice girls" -> "spicegirls"), which would make
 *  the n-gram scan in vibeArtistIndex.ts unable to count tokens. */
export function normalizeTight(value: string): string {
  return normalizeLoose(value).replace(/ /g, "");
}
