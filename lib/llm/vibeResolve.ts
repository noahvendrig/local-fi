/**
 * Merges what the prompt literally says (deterministic) with what the Stage A model reported (LLM)
 * into one resolved filter, and decides which parts of it are HARD.
 *
 * The deterministic extractors run UNCONDITIONALLY, not just as an LLM-failure fallback. For a large
 * share of real prompts the model adds nothing over a regex and an index lookup, and running them
 * always means "justin bieber" and "90s hiphop" are answered correctly even with Ollama stopped --
 * where the old code fell back to splitting the prompt into keywords and searching titles for them.
 *
 * Hard vs soft is the whole point of the rewrite. A hard constraint is something checkable against a
 * column: a resolved artist id, or an era the prompt actually names. Everything else -- genre (which
 * is mostly a noisy CNN14 guess), mood words, the model's own era hunch -- is soft, and the scorer
 * (vibeScore.ts) is not allowed to let any pile of soft signal outvote a hard one.
 */
import { detectEra, type Era } from "./vibeEra";
import { canonicalizeGenreQuery } from "./vibeVocabulary";
import { resolveArtistName, scanPromptForArtists, type ArtistIndexEntry } from "./vibeArtistIndex";
import { normalizeLoose } from "../text/fuzzy";
import type { VibeIntent } from "./vibePrompts";

export interface ResolvedVibeFilter {
  /** HARD. Real `artists.id` values — an artist not in the library simply doesn't resolve. */
  artistIds: number[];
  /** normalizeLoose'd names of those artists, for spotting "(feat. X)" credits in a title/album. */
  artistNames: string[];
  /** HARD. The era the prompt explicitly names. */
  era: Era | null;
  /** SOFT. The model's era hunch, used only when the prompt named none outright. */
  softEra: Era | null;
  /** Canonical genre tokens from every source, scored softly. */
  genres: string[];
  /**
   * HARD. The subset of `genres` the prompt NAMES OUTRIGHT, as opposed to ones the model inferred
   * from a mood.
   *
   * Genre is a weak signal in the abstract -- most of this library's values are a CNN14 guess -- but
   * when someone writes the word "hiphop" they have stated a requirement, not a preference, and
   * scoring it softly meant it got silently dropped the moment it became inconvenient. With only
   * three genuine 90s hip hop tracks in this library, "90s hiphop" satisfied its era constraint 25
   * times over and filled the rest of the queue with the 18 Spice Girls tracks that happen to be
   * from the 90s. A named genre is now checkable in the same way an era is.
   *
   * Only the prompt-scan feeds this. A genre the MODEL volunteered for "songs for a rainy 2am drive"
   * is a guess about what the listener might like, and hard-filtering on a guess is how you get an
   * empty queue.
   */
  hardGenres: string[];
  /** SOFT. Mood/activity words, matched against title/artist/album text. */
  keywords: string[];
  hasHardConstraint: boolean;
  /** Whether the Stage A model contributed anything, for the caller's usedFallback reporting. */
  source: "llm" | "deterministic";
}

const MAX_ARTISTS = 3;
const MAX_GENRES = 4;
const MAX_KEYWORDS = 6;

/** Words too generic to be worth matching against a title. Mirrors the old fallback's stopword set,
 *  widened with the filler that shows up in vibe prompts specifically. */
const KEYWORD_STOPWORDS = new Set([
  "a", "an", "the", "for", "of", "to", "and", "or", "in", "on", "at", "by", "with", "from",
  "songs", "song", "music", "track", "tracks", "playlist", "radio", "mix", "some", "me", "my",
  "play", "like", "stuff", "things", "something", "anything", "vibe", "vibes", "era", "sounding",
]);

/** Tokenized so genre words survive: keeps "&" and "-" inside a token, so "r&b", "d&b", "hip-hop"
 *  and "lo-fi" stay intact rather than being split into meaningless halves. Deliberately NOT
 *  normalizeLoose, which would turn "r&b" into "r b". */
function genreScanTokens(prompt: string): string[] {
  return prompt
    .toLowerCase()
    .split(/[^a-z0-9&'-]+/)
    .filter(Boolean);
}

/** Canonical genres named anywhere in the raw prompt, without the LLM. n-grams up to 3 so
 *  multi-word genres ("drum and bass", "uk garage") resolve as well as single words. */
function scanPromptForGenres(prompt: string): string[] {
  const tokens = genreScanTokens(prompt);
  const found: string[] = [];
  for (let size = Math.min(3, tokens.length); size >= 1; size--) {
    for (let start = 0; start + size <= tokens.length; start++) {
      for (const genre of canonicalizeGenreQuery(tokens.slice(start, start + size).join(" "))) {
        if (!found.includes(genre)) found.push(genre);
      }
    }
  }
  return found;
}

/** Fills in the open side of a one-ended range the model reported, so "after 2010" becomes a span
 *  rather than a half-constraint the scorer would have to special-case. */
function softEraFrom(intent: VibeIntent | null): Era | null {
  if (!intent) return null;
  const { yearMin, yearMax } = intent;
  if (yearMin == null && yearMax == null) return null;
  const min = yearMin ?? (yearMax as number) - 9;
  const max = yearMax ?? (yearMin as number) + 9;
  return min <= max ? { min, max } : { min: max, max: min };
}

export function resolveVibeIntent(args: { prompt: string; intent: VibeIntent | null; artistIndex: ArtistIndexEntry[] }): ResolvedVibeFilter {
  const { prompt, intent, artistIndex } = args;

  // 1. Era. The regex is the authority; the model's guess is demoted to a soft bonus, and is
  //    ignored outright when the prompt named an era itself.
  const era = detectEra(prompt);
  const softEra = era ? null : softEraFrom(intent);

  // 2. Artists. Both paths are confident by construction: the prompt scan applies its own
  //    common-word guard, and a name the model nominated has been asserted to BE a name.
  const resolvedArtists: ArtistIndexEntry[] = [];
  const seenArtistIds = new Set<number>();
  const addArtist = (entry: { id: number; name: string } | null) => {
    if (!entry || seenArtistIds.has(entry.id) || resolvedArtists.length >= MAX_ARTISTS) return;
    seenArtistIds.add(entry.id);
    resolvedArtists.push(entry as ArtistIndexEntry);
  };
  for (const hit of scanPromptForArtists(prompt, artistIndex)) if (hit.confident) addArtist(hit);
  for (const name of intent?.artists ?? []) addArtist(resolveArtistName(name, artistIndex));

  // 3. Genres. The prompt scan is listed first because it is also the HARD set: a genre the listener
  //    wrote down outranks one the model inferred, in the same way detectEra outranks intent.yearMin.
  const promptGenres = scanPromptForGenres(prompt);
  const genres: string[] = [...promptGenres];
  for (const term of intent?.genres ?? []) {
    for (const genre of canonicalizeGenreQuery(term)) if (!genres.includes(genre)) genres.push(genre);
  }

  // 4. Keywords, minus anything already accounted for as an artist or a genre -- leaving those in
  //    would double-count the same word in the score and, worse, let a genre name earn title-text
  //    credit from an unrelated track that happens to have it in its title.
  const artistWords = new Set(resolvedArtists.flatMap((a) => normalizeLoose(a.name).split(" ")));
  const genreWords = new Set(genres.flatMap((g) => g.toLowerCase().split(" ")));
  const keywords: string[] = [];
  for (const raw of intent?.keywords ?? []) {
    const keyword = raw.toLowerCase().trim();
    if (!keyword || keyword.length < 3) continue;
    if (KEYWORD_STOPWORDS.has(keyword) || artistWords.has(keyword) || genreWords.has(keyword)) continue;
    if (canonicalizeGenreQuery(keyword).length > 0) continue;
    if (!keywords.includes(keyword)) keywords.push(keyword);
    if (keywords.length >= MAX_KEYWORDS) break;
  }

  return {
    artistIds: resolvedArtists.map((a) => a.id),
    artistNames: resolvedArtists.map((a) => normalizeLoose(a.name)),
    era,
    softEra,
    genres: genres.slice(0, MAX_GENRES),
    hardGenres: promptGenres.slice(0, MAX_GENRES),
    keywords,
    hasHardConstraint: resolvedArtists.length > 0 || era != null || promptGenres.length > 0,
    source: intent ? "llm" : "deterministic",
  };
}
