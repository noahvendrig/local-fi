/**
 * Offline assertion harness for the vibe matching core.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/vibe-eval.mts
 *
 * Runs against the real data/library.db, READ-ONLY, with no Ollama and no Python backend — the
 * scoring core is pure, so everything it needs (taste scores, embedding neighbours) can be stubbed.
 * There is no test runner in this project; this is a plain script that counts failures and exits
 * non-zero, which is enough to catch a regression in the parts that matter.
 *
 * Sections 5 and 6 are the two reported bugs, asserted against the real library.
 */
import Database from "better-sqlite3";
import { detectEra } from "../lib/llm/vibeEra.ts";
import { buildArtistIndex, resolveArtistName, scanPromptForArtists } from "../lib/llm/vibeArtistIndex.ts";
import { buildGenreVocabulary, canonicalizeGenreCell, canonicalizeGenreQuery, genreMatchCounts } from "../lib/llm/vibeVocabulary.ts";
import { resolveVibeIntent, type ResolvedVibeFilter } from "../lib/llm/vibeResolve.ts";
import { cleanTitleForSearch, resolveFromCandidates } from "../lib/musicbrainz/enrichMatch.ts";
import type { MusicBrainzCandidate } from "../lib/musicbrainz/client.ts";
import {
  effectiveYear,
  gateIfSatisfiable,
  rankNormalize,
  scoreCandidates,
  W_ARTIST_CREDIT,
  W_ARTIST_PRIMARY,
  W_ERA_IN,
  W_ERA_OUT,
  W_ERA_UNKNOWN,
  W_GENRE_CAP,
  W_JITTER_MAX,
  W_KEYWORD_CAP,
  W_NEIGHBOUR_MAX,
  W_RECENCY_MAX,
  W_SOFT_ERA_IN,
  W_TASTE_MAX,
  type ScoringRow,
} from "../lib/llm/vibeScore.ts";

let failures = 0;
let checks = 0;
function check(label: string, condition: boolean, detail = ""): void {
  checks++;
  if (!condition) {
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}
function eq(label: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  check(label, g === w, g === w ? "" : `want ${w}, got ${g}`);
}
function section(name: string): void {
  console.log(`\n${name}`);
}

const db = new Database("data/library.db", { readonly: true });
const artistIndex = buildArtistIndex(db.prepare("select id, name from artists").all() as { id: number; name: string }[]);
const rows = db
  .prepare(
    `select t.id, t.title, t.artist_id as artistId, a.name as artistName, al.title as albumTitle,
            t.genre, t.year, t.original_year as originalYear, t.bpm, t.key, t.date_added as dateAdded,
            t.similarity_status as similarityStatus
     from tracks t
     left join artists a on t.artist_id = a.id
     left join albums al on t.album_id = al.id
     where t.deleted_at is null`
  )
  .all()
  .map((r): ScoringRow => ({ ...(r as Omit<ScoringRow, "similarityReady">), similarityReady: (r as { similarityStatus: string }).similarityStatus === "ready" }));

const resolve = (prompt: string, intent: Parameters<typeof resolveVibeIntent>[0]["intent"] = null) => resolveVibeIntent({ prompt, intent, artistIndex });
const score = (filter: ResolvedVibeFilter, opts: { exclude?: number[]; neighbours?: Map<number, number> } = {}) => {
  const exclude = new Set(opts.exclude ?? []);
  return scoreCandidates(
    rows.filter((r) => !exclude.has(r.id)),
    filter,
    { neighbourScores: opts.neighbours, sessionId: "eval", now: Date.parse("2026-09-20T00:00:00Z") }
  );
};
// Reported as the EFFECTIVE year (original release where MusicBrainz supplied one), since that is
// what era matching actually uses -- printing the tag year would make an enriched reissue look wrong.
const describe = (c: ScoringRow) => `${c.artistName ?? "?"} — ${c.title ?? "?"} (${effectiveYear(c) ?? "no year"}${c.originalYear != null && c.originalYear !== c.year ? ` orig, tag ${c.year}` : ""})`;

// ---------------------------------------------------------------------------- 1. detectEra
section("1. detectEra");
for (const [input, want] of [
  ["90s hiphop", "1990-1999"],
  ["early 80s", "1980-1984"],
  ["mid 90s", "1993-1997"],
  ["mid-90s", "1993-1997"],
  ["late 70s rock", "1975-1979"],
  ["1995-2005", "1995-2005"],
  ["1995 to 2005", "1995-2005"],
  ["2010s indie", "2010-2019"],
  ["1990s", "1990-1999"],
  ["20s", "2020-2029"],
  ["30s", "1930-1939"],
  ["00s bangers", "2000-2009"],
  ["nineties", "1990-1999"],
  ["y2k pop", "1999-2003"],
  ["1994", "1994-1994"],
  ["justin bieber", "null"],
  ["old school hip hop", "null"],
  ["throwback classics", "null"],
  ["songs for a rainy 2am drive", "null"],
  ["blink 182", "null"],
  ["top 40 hits", "null"],
] as [string, string][]) {
  const era = detectEra(input);
  eq(`detectEra(${JSON.stringify(input)})`, era ? `${era.min}-${era.max}` : "null", want);
}

// ---------------------------------------------------------------- 2. Artist resolution
section("2. Artist resolution");
const scanNames = (p: string) => scanPromptForArtists(p, artistIndex).map((h) => h.name).sort();
eq("scan: justin bieber", scanNames("justin bieber"), ["Justin Bieber"]);
eq("scan: justin bieber songs", scanNames("justin bieber songs"), ["Justin Bieber"]);
eq("scan: spice girls", scanNames("spice girls"), ["Spice Girls"]);
eq("scan: some dr dre please", scanNames("some dr dre please"), ["Dr. Dre"]);
eq("scan: drake", scanNames("drake"), ["Drake"]);
eq("scan: songs like netsky", scanNames("songs like netsky"), ["Netsky"]);
eq("scan: 90s hiphop", scanNames("90s hiphop"), []);
eq("scan: songs for a rainy 2am drive", scanNames("songs for a rainy 2am drive"), []);
// The single-token common-word guard. These artists really are in this library, and a naive scan
// would turn ordinary English into a hard constraint.
eq("scan: music for the future", scanNames("music for the future"), []);
eq("scan: future (bare)", scanNames("future"), ["Future"]);
eq("scan: songs im used to", scanNames("songs im used to"), []);
eq("scan: girls night out", scanNames("girls night out"), []);
eq("scan: yes energy", scanNames("yes energy"), []);
const resolved = (n: string) => resolveArtistName(n, artistIndex)?.name ?? null;
eq("resolve: Justin Bieber", resolved("Justin Bieber"), "Justin Bieber");
eq("resolve: justin beiber (typo)", resolved("justin beiber"), "Justin Bieber");
eq("resolve: ASAP Ferg", resolved("ASAP Ferg"), "A$AP Ferg");
eq("resolve: acdc", resolved("acdc"), "AC/DC");
eq("resolve: blink182", resolved("blink182"), "blink-182");
eq("resolve: Beyonce", resolved("Beyonce"), "Beyoncé");
eq("resolve: Tiesto", resolved("Tiesto"), "Tiësto");
eq("resolve: Queen (nominated)", resolved("Queen"), "Queen");
eq("resolve: absent artist", resolved("Frank Sinatra"), null);

// -------------------------------------------------------------- 3. Genre canonicalization
section("3. Genre canonicalization");
eq('cell("Dance - House - 2 Step")', canonicalizeGenreCell("Dance - House - 2 Step"), ["Dance", "House", "UK Garage"]);
eq('cell("UK GARAGE")', canonicalizeGenreCell("UK GARAGE"), ["UK Garage"]);
eq('cell("ukg")', canonicalizeGenreCell("ukg"), ["UK Garage"]);
eq('cell("Speed Garage")', canonicalizeGenreCell("Speed Garage"), ["UK Garage"]);
eq('cell("Drum & Bass")', canonicalizeGenreCell("Drum & Bass"), ["Drum and Bass"]);
eq('cell("Hip Hop, R&B")', canonicalizeGenreCell("Hip Hop, R&B"), ["Hip Hop", "R&B"]);
eq('cell("pinkpantheress")', canonicalizeGenreCell("pinkpantheress"), []);
eq('query("hiphop")', canonicalizeGenreQuery("hiphop"), ["Hip Hop"]);
eq('query("dnb")', canonicalizeGenreQuery("dnb"), ["Drum and Bass"]);
eq('query("rnb")', canonicalizeGenreQuery("rnb"), ["R&B"]);
eq("family credit when no direct hit", genreMatchCounts(["Techno"], ["House"]), { direct: 0, related: 1, trackTokenCount: 1 });
// Counted query-side, and no sibling top-up once something matched directly -- otherwise a track
// simply carrying more tags outscores a cleanly-tagged one (Spice Girls vs Dr. Dre on "90s hiphop").
eq("direct hit suppresses sibling credit", genreMatchCounts(["Hip Hop", "R&B", "Pop"], ["Hip Hop"]), { direct: 1, related: 0, trackTokenCount: 3 });
eq("clean tag scores the same direct count", genreMatchCounts(["Hip Hop"], ["Hip Hop"]), { direct: 1, related: 0, trackTokenCount: 1 });
const vocabulary = buildGenreVocabulary(rows.map((r) => r.genre));
check("vocabulary excludes junk", !vocabulary.includes("pinkpantheress"));
check("vocabulary has no duplicates", new Set(vocabulary).size === vocabulary.length);
check("vocabulary is usage-ordered", vocabulary[0] === "Hip Hop", `got ${vocabulary[0]}`);

// ------------------------------------------------------------------- 4. Score invariants
section("4. Score invariants (lexicographic banding)");
// The most any track can score WITHOUT an artist band. era and softEra are mutually exclusive by
// construction (softEra is only set when no hard era was found), so only the larger counts.
const MAX_BELOW_ARTIST = W_ERA_IN + W_NEIGHBOUR_MAX + W_GENRE_CAP + W_KEYWORD_CAP + W_TASTE_MAX + W_RECENCY_MAX + W_JITTER_MAX;
const MAX_BELOW_ERA = W_NEIGHBOUR_MAX + W_GENRE_CAP + W_KEYWORD_CAP + W_TASTE_MAX + W_RECENCY_MAX + W_JITTER_MAX;
const MAX_SOFT_ONLY = W_GENRE_CAP + W_KEYWORD_CAP + W_SOFT_ERA_IN + W_TASTE_MAX + W_RECENCY_MAX + W_JITTER_MAX;
const MAX_NON_GENRE_ON_GENRE_PROMPT = W_TASTE_MAX + W_RECENCY_MAX + W_JITTER_MAX;
check("I1 primary artist outranks any non-artist track", W_ARTIST_PRIMARY - W_ARTIST_CREDIT > MAX_BELOW_ARTIST, `gap ${W_ARTIST_PRIMARY - W_ARTIST_CREDIT} vs ${MAX_BELOW_ARTIST}`);
check("I2 credited artist outranks any non-artist track", W_ARTIST_CREDIT > MAX_BELOW_ARTIST, `${W_ARTIST_CREDIT} vs ${MAX_BELOW_ARTIST}`);
check("I3 in-era outranks unknown-year", W_ERA_IN - W_ERA_UNKNOWN > MAX_BELOW_ERA, `gap ${W_ERA_IN - W_ERA_UNKNOWN} vs ${MAX_BELOW_ERA}`);
check("I4 unknown-year outranks out-of-era", W_ERA_UNKNOWN - W_ERA_OUT > MAX_BELOW_ERA, `gap ${W_ERA_UNKNOWN - W_ERA_OUT} vs ${MAX_BELOW_ERA}`);
check("I5 embedding neighbour outranks soft-only match", W_NEIGHBOUR_MAX > MAX_SOFT_ONLY, `${W_NEIGHBOUR_MAX} vs ${MAX_SOFT_ONLY}`);
check("I6 genre match outranks non-match on a genre-only prompt", W_GENRE_CAP > MAX_NON_GENRE_ON_GENRE_PROMPT, `${W_GENRE_CAP} vs ${MAX_NON_GENRE_ON_GENRE_PROMPT}`);

// --------------------------------------------------- 5. Bug 1 regression: "90s hiphop"
section('5. Bug 1 — "90s hiphop" must not return a 2014 track');
{
  const filter = resolve("90s hiphop");
  eq("era is hard", filter.era, { min: 1990, max: 1999 });
  eq("genre resolved", filter.genres, ["Hip Hop"]);
  eq("genre is HARD -- the prompt names it outright", filter.hardGenres, ["Hip Hop"]);
  check("has a hard constraint", filter.hasHardConstraint);

  const ranked = score(filter);
  // Effective year throughout: a reissue whose MusicBrainz original year is in the 90s IS a 90s
  // track, and is exactly what Part B exists to make reachable (Notorious B.I.G.'s "Big Poppa",
  // tagged 2007, original 1994).
  const in90s = (c: ScoringRow) => {
    const y = effectiveYear(c);
    return y != null && y >= 1990 && y <= 1999;
  };
  const inEra = rows.filter(in90s).length;
  const top = ranked.slice(0, inEra);
  check(`all top ${inEra} are in-era`, top.every(in90s), top.filter((c) => !in90s(c)).map(describe).join("; "));

  // The old ladder collapsed to 153 hip hop tracks of ANY era; these are the specific modern
  // hip hop tracks that used to win. None may appear before the genuine 90s ones.
  const modernHipHop = ranked.filter((c) => (effectiveYear(c) ?? 0) > 2005 && canonicalizeGenreCell(c.genre).includes("Hip Hop"));
  check("a modern hip hop track exists to be wrongly picked", modernHipHop.length > 0);
  const firstModernRank = ranked.indexOf(modernHipHop[0]);
  check("no modern hip hop track ranks above the in-era ones", firstModernRank >= inEra, `first modern at rank ${firstModernRank}, in-era count ${inEra}`);

  // The three genuine 90s hip hop tracks are each tagged "Hip Hop" first; the Spice Girls tracks
  // carry it further down their list, behind Pop and Rock. Genre precision plus the leading-token
  // gate must put the cleanly-tagged ones first. (Big Poppa only joins them once MusicBrainz
  // enrichment has supplied its 1994 original year -- before that it is invisible to the era.)
  const cleanlyTagged = ranked.filter((c) => in90s(c) && canonicalizeGenreCell(c.genre)[0] === "Hip Hop");
  check("the genuine 90s hip hop tracks lead", cleanlyTagged.every((c) => ranked.indexOf(c) < cleanlyTagged.length), cleanlyTagged.map((c) => `${describe(c)} @${ranked.indexOf(c)}`).join("; "));
  check("Dr. Dre is among them", cleanlyTagged.some((c) => c.artistName === "Dr. Dre"));
  console.log(`  top 6: ${ranked.slice(0, 6).map(describe).join(" | ")}`);

  // The reported "trails off after 4 songs" bug. 18 of this library's 25 1990s tracks are Spice
  // Girls, so an era-only hard constraint is satisfiable 25 times over and the queue used to fill
  // with 90s pop the moment the three genuine matches ran out. Being in the right decade is no
  // longer enough to qualify as an exact match.
  const exact = ranked.filter((c) => c.tier === "exact");
  check("exact tier is only in-era hip hop", exact.every((c) => in90s(c) && canonicalizeGenreCell(c.genre).includes("Hip Hop")), exact.filter((c) => !canonicalizeGenreCell(c.genre).includes("Hip Hop")).map(describe).join("; "));
  check("the exact pool is genuinely small", exact.length < 12, `${exact.length} exact`);

  const spiceIn90s = ranked.filter((c) => c.artistName === "Spice Girls" && in90s(c));
  check("library has 90s Spice Girls tracks to be wrongly picked", spiceIn90s.length > 10, `${spiceIn90s.length}`);
  const offGenreSpice = spiceIn90s.filter((c) => !canonicalizeGenreCell(c.genre).includes("Hip Hop"));
  check("no off-genre Spice Girls track is tier=exact", offGenreSpice.every((c) => c.tier !== "exact"), offGenreSpice.filter((c) => c.tier === "exact").slice(0, 3).map(describe).join("; "));

  // ...and with the expansion supplying neighbours, those are what follow the exact pool, rather
  // than the rest of the decade. This is the whole point of sorting by tier before score: a
  // neighbour pays W_ERA_OUT and can never win on score alone.
  const seedIds = new Set(exact.map((c) => c.id));
  const neighbourIds = rows.filter((r) => !seedIds.has(r.id) && r.similarityReady && canonicalizeGenreCell(r.genre).includes("Hip Hop")).slice(0, 12).map((r) => r.id);
  check("there are out-of-era hip hop neighbours to reach", neighbourIds.length > 0);
  const withNeighbours = score(filter, { neighbours: rankNormalize(neighbourIds.map((id, i) => [id, 1 - i / neighbourIds.length] as [number, number])) });
  const batch = withNeighbours.slice(0, 12);
  check("a full batch contains no off-genre track", batch.every((c) => canonicalizeGenreCell(c.genre).includes("Hip Hop")), batch.filter((c) => !canonicalizeGenreCell(c.genre).includes("Hip Hop")).map(describe).join("; "));
  check("the exact matches still lead it", batch.slice(0, exact.length).every((c) => c.tier === "exact"), batch.slice(0, exact.length).map((c) => `${describe(c)}[${c.tier}]`).join("; "));
  check("positions after the exact pool are expansion neighbours", batch.slice(exact.length).every((c) => c.tier === "similar"), batch.slice(exact.length).map((c) => `${describe(c)}[${c.tier}]`).join("; "));
  console.log(`  with neighbours: ${batch.slice(0, 8).map((c) => `${describe(c)}[${c.tier}]`).join(" | ")}`);
}

// ------------------------------------------------ 6. Bug 2 regression: "justin bieber"
section('6. Bug 2 — "justin bieber" must play Justin Bieber');
{
  const filter = resolve("justin bieber");
  check("has a hard constraint", filter.hasHardConstraint);
  eq("one artist resolved", filter.artistIds.length, 1);

  const ranked = score(filter);
  const bieber = ranked.filter((c) => c.artistName === "Justin Bieber");
  check("library has exactly one Bieber track", bieber.length === 1, `got ${bieber.length}`);
  check("it ranks first", ranked.indexOf(bieber[0]) === 0, `ranked ${ranked.indexOf(bieber[0])}: ${describe(ranked[0])}`);
  check("it scores in the artist band", bieber[0].score >= W_ARTIST_PRIMARY, `${bieber[0].score}`);
  check("only it is tier=exact", ranked.filter((c) => c.tier === "exact").length === 1);
  console.log(`  top 3: ${ranked.slice(0, 3).map((c) => `${describe(c)} [${c.tier}]`).join(" | ")}`);

  // Batch 2: the only correct track is now excluded. Previously the ladder collapsed here and
  // served unrelated pop. Nothing may claim to be an exact match any more.
  const excluded = score(filter, { exclude: [bieber[0].id] });
  check("nothing is tier=exact once Bieber is used up", excluded.every((c) => c.tier !== "exact"), excluded.filter((c) => c.tier === "exact").slice(0, 3).map(describe).join("; "));

  // With embedding neighbours supplied, the expansion tier takes over rather than the score tail.
  const neighbourIds = rows.filter((r) => r.id !== bieber[0].id && r.similarityReady).slice(0, 10).map((r) => r.id);
  const neighbours = rankNormalize(neighbourIds.map((id, i) => [id, 1 - i / neighbourIds.length] as [number, number]));
  const expanded = score(filter, { exclude: [bieber[0].id], neighbours });
  check("neighbours lead the batch", expanded.slice(0, 5).every((c) => c.tier === "similar"), expanded.slice(0, 5).map((c) => `${describe(c)}[${c.tier}]`).join("; "));
}

// ------------------------------------------------------------------ 7. Batch continuity
section("7. Batch continuity over a session");
{
  const filter = resolve("justin bieber");
  const seen = new Set<number>();
  const order: string[] = [];
  const rank = { exact: 0, similar: 1, broader: 2 };
  for (let batch = 0; batch < 5; batch++) {
    const picks = score(filter, { exclude: [...seen] }).slice(0, 12);
    check(`batch ${batch} is full`, picks.length === 12, `got ${picks.length}`);
    for (const pick of picks) {
      check(`batch ${batch} has no repeat`, !seen.has(pick.id));
      seen.add(pick.id);
    }
    order.push(picks[0].tier);
  }
  const monotone = order.every((tier, i) => i === 0 || rank[tier as keyof typeof rank] >= rank[order[i - 1] as keyof typeof rank]);
  check("tier never improves across batches", monotone, order.join(" -> "));
  console.log(`  tiers: ${order.join(" -> ")}`);
}

// ------------------------------------------------------------------- 8. No-signal prompt
section("8. No-signal prompt still returns tracks");
{
  const filter = resolve("asdkjfh");
  check("no hard constraint", !filter.hasHardConstraint);
  eq("no genres", filter.genres, []);
  const ranked = score(filter);
  check("still returns a full batch", ranked.length >= 12);
  check("all tier=broader", ranked.slice(0, 12).every((c) => c.tier === "broader"), ranked.slice(0, 3).map((c) => `${describe(c)}[${c.tier}]`).join("; "));
}

// -------------------------------------------------------------------- 9. gateIfSatisfiable
section("9. gateIfSatisfiable");
eq("keeps compliant when enough", gateIfSatisfiable([1, 2, 3, 4], (n) => n % 2 === 0, 2), [2, 4]);
eq("fills from non-compliant when short", gateIfSatisfiable([1, 2, 3, 4], (n) => n % 2 === 0, 3), [2, 4, 1, 3]);
eq("compliant always lead", gateIfSatisfiable([1, 2, 3], (n) => n === 2, 3), [2, 1, 3]);

// ------------------------------------------------------- 10. MusicBrainz match (offline)
section("10. MusicBrainz matching");
// Stripping the edition suffix is what lets a reissue find its original recording at all.
eq("clean: Big Poppa - 2007 Remaster", cleanTitleForSearch("Big Poppa - 2007 Remaster"), "Big Poppa");
eq("clean: Roxanne - Remastered 2003", cleanTitleForSearch("Roxanne - Remastered 2003"), "Roxanne");
eq("clean: stacked suffixes", cleanTitleForSearch("Say You'll Be There - Single Mix - 2011 Remaster"), "Say Youll Be There");
eq("clean: yt-dlp id tag", cleanTitleForSearch("how sweet [PmVtDjLts84]"), "how sweet");
eq("clean: plain title untouched", cleanTitleForSearch("Still D.R.E."), "Still D.R.E.");
// A remix credit is NOT an edition suffix and must survive, or the wrong recording gets matched.
eq("clean: keeps remix info", cleanTitleForSearch("No Scrubs (SOULSTATE UK Garage Remix)"), "No Scrubs (SOULSTATE UK Garage Remix)");

const candidate = (over: Partial<MusicBrainzCandidate>): MusicBrainzCandidate => ({
  recordingId: "x",
  title: "Big Poppa",
  artistName: "The Notorious B.I.G.",
  years: [],
  genres: [],
  tags: [],
  ...over,
});
{
  // The earliest release across ALL matching recordings — not the top-scored one, which is usually
  // a later compilation appearance. This is what turns "Big Poppa - 2007 Remaster" back into 1994.
  const r = resolveFromCandidates(
    [candidate({ years: [2007] }), candidate({ years: [1994, 1995] }), candidate({ years: [1999] })],
    "Big Poppa - 2007 Remaster",
    "The Notorious B.I.G."
  );
  eq("takes earliest year across matches", r.originalYear, 1994);
  eq("counts all matches", r.matchCount, 3);
}
{
  // A different song by the same artist must not contribute its year.
  const r = resolveFromCandidates(
    [candidate({ title: "Juicy", years: [1994] }), candidate({ title: "Big Poppa", years: [2001] })],
    "Big Poppa",
    "The Notorious B.I.G."
  );
  eq("ignores a different song", r.originalYear, 2001);
  eq("only the real match counts", r.matchCount, 1);
}
{
  // Vote thresholds. These are the real aggregated tag counts for AC/DC's "Thunderstruck", which
  // without a threshold wrote "Rock, Dance, House" onto it — two single-user tags becoming genres.
  const r = resolveFromCandidates(
    [
      candidate({
        title: "Thunderstruck",
        artistName: "AC/DC",
        tags: [
          { name: "hard rock", count: 9 },
          { name: "rock", count: 5 },
          { name: "classic rock", count: 4 },
          { name: "dance", count: 1 },
          { name: "house", count: 1 },
        ],
      }),
    ],
    "Thunderstruck",
    "AC/DC"
  );
  check("junk tags dropped", !r.genres.includes("Dance") && !r.genres.includes("House"), JSON.stringify(r.genres));
  check("consensus tags kept", r.genres.includes("Rock"), JSON.stringify(r.genres));
}
{
  // Curated genres win outright over folksonomy tags, however many votes the tags have.
  const r = resolveFromCandidates(
    [candidate({ genres: [{ name: "hip hop", count: 3 }], tags: [{ name: "house", count: 50 }] })],
    "Big Poppa",
    "The Notorious B.I.G."
  );
  eq("curated genres beat tags", r.genres, ["Hip Hop"]);
}
eq("no candidates -> no match", resolveFromCandidates([], "Whatever", "Nobody"), { originalYear: null, genres: [], matchCount: 0 });

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
