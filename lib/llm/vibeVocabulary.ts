/**
 * Canonical genre vocabulary + the alias tables that map messy real-world genre text onto it.
 *
 * `tracks.genre` is mostly machine-generated: python-backend/services/similarity/genre.py runs
 * CNN14's AudioSet head and comma-joins a hand-picked subset of its 527 sound-event classes. The
 * rest comes from ID3 tags, which are free text. The result is one column holding "Hip Hop, R&B",
 * "UK GARAGE", "ukg", "Drum & Bass", "Dance - House - 2 Step" and even "pinkpantheress".
 *
 * Splitting those on "&" or "-" is not safe -- "R&B", "Drum & Bass" and "Dance & EDM" would all be
 * torn in half -- so instead every known cell-piece is listed explicitly below. The vocabulary is
 * finite and auditable, which is worth more here than a clever parser.
 *
 * Pure and dependency-free: the DB-reading half (getGenreVocabulary) lives in vibeCandidates.ts so
 * that this module stays loadable by scripts/vibe-eval.mts. See the note in lib/text/fuzzy.ts.
 */

/** The 46 labels genre.py can emit, plus "UK Garage" (never emitted by CNN14 but present in this
 *  library's ID3 tags, and a genre users genuinely ask for by name). */
export const CANONICAL_GENRES: string[] = [
  "African",
  "Afrobeat",
  "Ambient",
  "Asian",
  "Bluegrass",
  "Blues",
  "Bollywood",
  "Carnatic",
  "Christian",
  "Classical",
  "Country",
  "Dance",
  "Disco",
  "Drum and Bass",
  "Dubstep",
  "EDM",
  "Electronic",
  "Electronica",
  "Flamenco",
  "Folk",
  "Funk",
  "Gospel",
  "Grunge",
  "Heavy Metal",
  "Hip Hop",
  "House",
  "Indie",
  "Jazz",
  "Latin",
  "Middle Eastern",
  "New Age",
  "Opera",
  "Pop",
  "Progressive Rock",
  "Psychedelic Rock",
  "Punk",
  "R&B",
  "Reggae",
  "Rock",
  "Rock and Roll",
  "Salsa",
  "Ska",
  "Soul",
  "Swing",
  "Techno",
  "Traditional",
  "Trance",
  "UK Garage",
];

/**
 * Lowercased raw cell-piece -> canonical token(s). Keyed on what actually appears in `tracks.genre`
 * after splitting on commas. A piece with no entry here is DROPPED rather than passed through, which
 * is what keeps junk like "pinkpantheress" out of the vocabulary offered to the Stage A model.
 */
const GENRE_ALIASES: Record<string, string[]> = Object.fromEntries([
  ...CANONICAL_GENRES.map((genre) => [genre.toLowerCase(), [genre]] as const),
  // Casing/spelling variants that coexist in this library's genre column.
  ["ukg", ["UK Garage"]],
  ["garage", ["UK Garage"]],
  ["speed garage", ["UK Garage"]],
  ["2 step", ["UK Garage"]],
  ["2-step", ["UK Garage"]],
  // A single ID3 cell that is itself a multi-genre string with "-" separators. Listed whole rather
  // than parsed, since "-" is not a safe separator in general (see "blink-182").
  ["dance - house - 2 step", ["Dance", "House", "UK Garage"]],
  ["drum & bass", ["Drum and Bass"]],
  ["drum n bass", ["Drum and Bass"]],
  ["dnb", ["Drum and Bass"]],
  ["dance & edm", ["Dance", "EDM"]],
  ["rap", ["Hip Hop"]],
  ["r and b", ["R&B"]],
  ["rnb", ["R&B"]],
]);

/**
 * Words a user is likely to TYPE that are not how the library spells the genre. Query-side only --
 * these must never be used to canonicalize a DB cell, or a track tagged "Trap" would silently
 * become "Hip Hop" in the vocabulary listing.
 */
const PROMPT_GENRE_SYNONYMS: Record<string, string[]> = {
  hiphop: ["Hip Hop"],
  "hip-hop": ["Hip Hop"],
  rap: ["Hip Hop"],
  trap: ["Hip Hop"],
  "boom bap": ["Hip Hop"],
  drill: ["Hip Hop"],
  grime: ["Hip Hop", "UK Garage"],
  rnb: ["R&B"],
  "r n b": ["R&B"],
  "rhythm and blues": ["R&B"],
  dnb: ["Drum and Bass"],
  "d&b": ["Drum and Bass"],
  jungle: ["Drum and Bass"],
  liquid: ["Drum and Bass"],
  edm: ["EDM", "Dance"],
  electro: ["Electronic"],
  "lo-fi": ["Ambient", "Hip Hop"],
  lofi: ["Ambient", "Hip Hop"],
  chillout: ["Ambient"],
  metal: ["Heavy Metal"],
  "rock n roll": ["Rock and Roll"],
  psychedelic: ["Psychedelic Rock"],
  prog: ["Progressive Rock"],
  afrobeats: ["Afrobeat"],
  amapiano: ["African", "House"],
  reggaeton: ["Reggae", "Latin"],
  dub: ["Reggae"],
  kpop: ["Asian", "Pop"],
  "k-pop": ["Asian", "Pop"],
  jpop: ["Asian", "Pop"],
  // Genre names MusicBrainz tags use that this vocabulary spells differently or more coarsely
  // (lib/musicbrainz/enrichMatch.ts maps incoming tags through here).
  "hard rock": ["Rock", "Heavy Metal"],
  "classic rock": ["Rock"],
  "pop rock": ["Rock", "Pop"],
  "pop/rock": ["Rock", "Pop"],
  "alternative rock": ["Rock", "Indie"],
  "indie rock": ["Indie", "Rock"],
  "blues rock": ["Blues", "Rock"],
  "punk rock": ["Punk"],
  "heavy metal": ["Heavy Metal"],
  "gangsta rap": ["Hip Hop"],
  "hip-hop/rap": ["Hip Hop"],
  "contemporary r&b": ["R&B"],
  "soul/r&b": ["Soul", "R&B"],
  "new wave": ["Pop", "Rock"],
  "synthpop": ["Pop", "Electronic"],
  "dance-pop": ["Dance", "Pop"],
  "electropop": ["Electronic", "Pop"],
  "singer-songwriter": ["Folk"],
  "drum n bass": ["Drum and Bass"],
  "drum and bass": ["Drum and Bass"],
};

/**
 * Loose stylistic neighbourhoods, used only for partial credit: asking for "house" should nudge
 * Techno and Electronic up slightly without ever putting them level with an actual House track.
 * Not a taxonomy -- membership is deliberately generous and overlapping.
 */
const GENRE_FAMILIES: string[][] = [
  ["Electronic", "Electronica", "House", "Techno", "Trance", "EDM", "Dance", "Dubstep", "Drum and Bass", "UK Garage", "Disco"],
  ["Hip Hop", "R&B", "Soul", "Funk"],
  ["Rock", "Grunge", "Punk", "Heavy Metal", "Psychedelic Rock", "Progressive Rock", "Rock and Roll", "Indie"],
  ["Afrobeat", "African", "Reggae", "Ska", "Latin", "Salsa"],
  ["Jazz", "Blues", "Swing", "Soul", "Gospel"],
  ["Folk", "Country", "Bluegrass", "Traditional"],
  ["Christian", "Gospel"],
  ["Classical", "Opera", "Ambient", "New Age"],
];

const RELATED: Map<string, Set<string>> = (() => {
  const map = new Map<string, Set<string>>();
  for (const family of GENRE_FAMILIES) {
    for (const member of family) {
      let set = map.get(member);
      if (!set) {
        set = new Set<string>();
        map.set(member, set);
      }
      for (const other of family) if (other !== member) set.add(other);
    }
  }
  return map;
})();

function lookup(table: Record<string, string[]>, key: string): string[] | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/** Turns one raw `tracks.genre` cell into canonical tokens. Unrecognized pieces are dropped. The
 *  whole-cell lookup runs first so multi-genre ID3 strings that contain commas-free separators
 *  ("Dance - House - 2 Step") resolve before the comma split gets a chance to mangle them. */
export function canonicalizeGenreCell(cell: string | null | undefined): string[] {
  if (!cell) return [];
  const whole = lookup(GENRE_ALIASES, cell.trim().toLowerCase());
  if (whole) return dedupe(whole);
  const out: string[] = [];
  for (const piece of cell.split(",")) {
    const hit = lookup(GENRE_ALIASES, piece.trim().toLowerCase());
    if (hit) out.push(...hit);
  }
  return dedupe(out);
}

/** Turns one genre word from a prompt (or from the Stage A model) into canonical tokens. Checks the
 *  query-side synonyms first so "trap"/"lofi" resolve, then falls back to the DB-side aliases. */
export function canonicalizeGenreQuery(term: string | null | undefined): string[] {
  if (!term) return [];
  const key = term.trim().toLowerCase();
  if (!key) return [];
  return dedupe(lookup(PROMPT_GENRE_SYNONYMS, key) ?? lookup(GENRE_ALIASES, key) ?? []);
}

/** Builds the vocabulary to show the Stage A model: canonical tokens actually present in the
 *  library, most-used first, so the model picks from what exists instead of inventing "lo-fi". */
export function buildGenreVocabulary(cells: (string | null)[]): string[] {
  const counts = new Map<string, number>();
  for (const cell of cells) {
    for (const token of canonicalizeGenreCell(cell)) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([token]) => token);
}

/**
 * How well a track's genre tags answer the query. Returns counts rather than a score so the weights
 * stay in one place (vibeScore.ts).
 *
 * Counted from the QUERY side -- how many of the genres asked for this track has -- not the track
 * side. Counting track tokens rewarded tracks for carrying MORE tags, which is backwards: CNN14
 * emits up to 5 labels per track, so "R&B, Pop, Hip Hop" would beat a clean "Hip Hop" on a hip hop
 * prompt purely for being vaguer. (In this library that is literally why Spice Girls outranked
 * Dr. Dre on "90s hiphop".)
 *
 * `related` is partial credit for a near miss, so it only applies when nothing matched directly --
 * otherwise a stray sibling tag would top up an already-direct hit for free.
 *
 * `trackTokenCount` lets the caller reward precision: Hip Hop as a track's only tag is a stronger
 * claim than Hip Hop as one of three.
 */
export function genreMatchCounts(
  trackTokens: string[],
  queryTokens: string[]
): { direct: number; related: number; trackTokenCount: number } {
  const trackTokenCount = trackTokens.length;
  if (trackTokenCount === 0 || queryTokens.length === 0) return { direct: 0, related: 0, trackTokenCount };
  const have = new Set(trackTokens);
  let direct = 0;
  for (const wanted of queryTokens) if (have.has(wanted)) direct++;
  if (direct > 0) return { direct, related: 0, trackTokenCount };
  let related = 0;
  for (const wanted of queryTokens) {
    if (trackTokens.some((token) => RELATED.get(token)?.has(wanted))) related++;
  }
  return { direct: 0, related, trackTokenCount };
}
