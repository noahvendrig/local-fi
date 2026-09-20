/**
 * Deterministic era extraction from a vibe prompt.
 *
 * A decade ("90s", "early 80s", "1995-2005") is the most explicit and most machine-checkable thing
 * a prompt can say, so TypeScript — not the LLM — is the authority on it. The Stage A model's
 * yearMin/yearMax is demoted to a soft hint used only when this returns null (see vibeResolve.ts).
 *
 * This is why the "90s hiphop" bug is fixed even with Ollama down: the era becomes a hard constraint
 * that the scorer (vibeScore.ts) will not let any amount of genre/keyword signal outvote. Previously
 * the year was the FIRST thing dropped when the old broadening ladder needed more candidates, which
 * is precisely how a 2014 track won a "90s" prompt.
 *
 * Zero imports on purpose — see the note at the top of lib/text/fuzzy.ts.
 */

export interface Era {
  min: number;
  max: number;
}

/** Decade names people write out instead of digits, mapped to the decade's first year. "tens" is
 *  deliberately absent: nobody says it unambiguously, and "the tens" would collide with "teens". */
const WORD_DECADES: Record<string, number> = {
  fifties: 1950,
  sixties: 1960,
  seventies: 1970,
  eighties: 1980,
  nineties: 1990,
  noughties: 2000,
  aughts: 2000,
};

/** Narrowing applied by an "early"/"mid"/"late" qualifier on a decade. Deliberately overlapping —
 *  "mid 90s" genuinely includes 1993 and 1997, and an over-tight window would exclude real matches
 *  in a small library. */
function applyModifier(start: number, modifier: string | undefined): Era {
  switch (modifier) {
    case "early":
      return { min: start, max: start + 4 };
    case "mid":
      return { min: start + 3, max: start + 7 };
    case "late":
      return { min: start + 5, max: start + 9 };
    default:
      return { min: start, max: start + 9 };
  }
}

/** A bare two-digit decade has to be assigned a century. 30-99 reads as 19xx ("the 70s", "the 90s")
 *  and 00-29 as 20xx ("the 00s", "the 20s") -- the crossover sits just past the current decade, so
 *  "20s" means the 2020s rather than the 1920s. Revisit if this app is somehow still running in 2030. */
function centuryFor(twoDigit: number): number {
  return twoDigit >= 30 ? 1900 + twoDigit : 2000 + twoDigit;
}

// Order matters: a range contains two bare years, and a 4-digit decade contains a 2-digit one, so
// the more specific pattern has to be tried first.
//
// These are regex LITERALS rather than new RegExp("...") on purpose: the optional
// (early|mid|late) prefix is shared by all three decade patterns, and building them from a shared
// string template means every backslash has to survive a second round of string escaping. Written
// out literally, group 1 is always the modifier and group 2 always the decade.
const RANGE_RE = /\b((?:19|20)\d{2})\s*(?:-|–|—|to|through|until|thru)\s*((?:19|20)\d{2})\b/i;
const DECADE_4_RE = /\b(?:(early|mid|late)[\s-]*)?((?:19|20)\d0)'?s\b/i;
const DECADE_2_RE = /\b(?:(early|mid|late)[\s-]*)?(\d0)'?s\b/i;
const WORD_DECADE_RE = /\b(?:(early|mid|late)[\s-]*)?(fifties|sixties|seventies|eighties|nineties|noughties|aughts)\b/i;
const Y2K_RE = /\by2k\b/i;
const SINGLE_YEAR_RE = /\b((?:19|20)\d{2})\b/;

/**
 * Returns the hard era a prompt explicitly names, or null when it names none.
 *
 * Returns null — deliberately — for vague-but-era-ish language ("old school", "throwback",
 * "classic", "retro"). Those carry no checkable year range, so forcing one would exclude correct
 * tracks; they stay soft and are left to the LLM and the genre/keyword signals.
 */
export function detectEra(prompt: string): Era | null {
  const range = prompt.match(RANGE_RE);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }

  const decade4 = prompt.match(DECADE_4_RE);
  if (decade4) return applyModifier(Number(decade4[2]), decade4[1]?.toLowerCase());

  const decade2 = prompt.match(DECADE_2_RE);
  if (decade2) return applyModifier(centuryFor(Number(decade2[2])), decade2[1]?.toLowerCase());

  const word = prompt.match(WORD_DECADE_RE);
  if (word) return applyModifier(WORD_DECADES[word[2].toLowerCase()], word[1]?.toLowerCase());

  // The Y2K era as people use it musically straddles the century line rather than meaning the
  // single year 2000, so it gets its own span instead of going through the decade path.
  if (Y2K_RE.test(prompt)) return { min: 1999, max: 2003 };

  const single = prompt.match(SINGLE_YEAR_RE);
  if (single) {
    const year = Number(single[1]);
    return { min: year, max: year };
  }

  return null;
}
