import { chatJson } from "@/lib/ollama/client";
import { OllamaMalformedResponseError } from "@/lib/ollama/errors";
import type { TrackSummary } from "@/lib/api-client";
import { getDb } from "@/lib/db/client";
import { getTrackSummariesByIds } from "@/lib/db/trackSummary";
import { getTasteScoreMap } from "@/lib/taste/tasteModel";
import { fetchSimilarToTrackSet } from "@/lib/pythonBackend/similarityClient";
import {
  VIBE_INTENT_SCHEMA,
  VIBE_SELECT_SCHEMA,
  formatVibeCandidate,
  isVibeIntent,
  isVibeSelection,
  normalizeVibeIntent,
  vibeIntentSystemPrompt,
  vibeSelectSystemPrompt,
  type VibeIntent,
} from "./vibePrompts";
import { fetchHardMatchSeedIds, fetchScoringRows, getGenreVocabulary, loadArtistIndex } from "./vibeCandidates";
import { resolveVibeIntent, type ResolvedVibeFilter } from "./vibeResolve";
import { gateIfSatisfiable, rankNormalize, scoreCandidates, type ScoredCandidate, type VibeTier } from "./vibeScore";

/** How many candidates Stage B is shown when it runs at all. Down from 120: the list is now score-
 *  ordered rather than date-ordered, so the tail was never going to be picked anyway, and a shorter
 *  prompt is both faster and less prone to a small model drifting. */
const STAGE_B_MAX_CANDIDATES = 60;
/** Hard-matching tracks used to seed the embedding expansion. */
const MAX_EXPANSION_SEEDS = 25;
/** The expansion runs inside the replenish loop, so it gets the same 3s budget fetchTasteScores uses. */
const EXPANSION_TIMEOUT_MS = 3_000;

export interface SelectVibeTracksResult {
  tracks: TrackSummary[];
  usedFallback: boolean;
  /** The interpretation this batch used. Cached by the caller and passed back on later batches of
   *  the same session so Stage A runs exactly once. */
  resolved: ResolvedVibeFilter;
  /** The broadest tier present in this batch — what the UI reports. */
  tier: VibeTier;
  tierCounts: Record<VibeTier, number>;
}

const TIER_ORDER: VibeTier[] = ["exact", "similar", "broader"];

function summarizeTiers(picks: ScoredCandidate[]): { tier: VibeTier; tierCounts: Record<VibeTier, number> } {
  const tierCounts: Record<VibeTier, number> = { exact: 0, similar: 0, broader: 0 };
  for (const pick of picks) tierCounts[pick.tier]++;
  const tier = [...TIER_ORDER].reverse().find((t) => tierCounts[t] > 0) ?? "broader";
  return { tier, tierCounts };
}

/**
 * The shared core behind both vibe features (prompt->crate and Vibe Radio): turns a free-text prompt
 * into a real, ordered track list from the user's own library.
 *
 * The pipeline is: interpret -> resolve -> score -> (expand) -> (curate).
 *
 *   INTERPRET (Stage A, Ollama) only EXTRACTS what the prompt says — artist names as written, genres
 *   from the library's real vocabulary, mood words. It does not choose tracks.
 *
 *   RESOLVE (lib/llm/vibeResolve.ts) turns that into checkable constraints: names into real artist
 *   ids, a decade into a year range. This also runs deterministically over the raw prompt, so an
 *   unambiguous request is answered correctly even with Ollama stopped.
 *
 *   SCORE (lib/llm/vibeScore.ts) ranks the library with hard constraints banded above soft ones.
 *   Replaces the old broadening ladder, which could discard a perfect small match in order to reach
 *   a minimum pool size, and dropped the year constraint before the far weaker keyword one.
 *
 *   EXPAND fills a short batch with audio-embedding neighbours of the hard matches, so a prompt with
 *   one matching track continues into things that sound like it rather than into unrelated filler.
 *
 *   CURATE (Stage B, Ollama) only runs for genuinely open-ended prompts. Once "justin bieber" is a
 *   real artist id there is nothing for a model to judge and every chance for it to wander, so that
 *   case is ranked deterministically instead.
 *
 * The LLM is never allowed to invent a track: every returned id is validated against the candidate
 * set, and any JSON/shape failure degrades to the deterministic path rather than erroring outright.
 */
export async function selectVibeTracks(
  prompt: string,
  opts: {
    excludeIds?: number[];
    limit?: number;
    model: string;
    applyTaste?: boolean;
    /** A filter resolved on an earlier batch of this session — skips Stage A entirely. */
    resolved?: ResolvedVibeFilter;
    /** false for Vibe Radio replenishment; see the Stage B note below. */
    useStageB?: boolean;
    /** Seeds the score jitter so a session's batches vary without reshuffling mid-queue. */
    sessionId?: string;
  }
): Promise<SelectVibeTracksResult> {
  const excludeIds = opts.excludeIds ?? [];
  const limit = opts.limit ?? 30;

  // --- Interpret + resolve ---------------------------------------------------------------------
  let resolved: ResolvedVibeFilter;
  let stageAFailed = false;

  if (opts.resolved) {
    resolved = opts.resolved;
  } else {
    let intent: VibeIntent | null = null;
    try {
      const raw = await chatJson({
        model: opts.model,
        system: vibeIntentSystemPrompt(getGenreVocabulary()),
        user: prompt,
        schema: VIBE_INTENT_SCHEMA,
        temperature: 0.2,
        validate: isVibeIntent,
      });
      intent = normalizeVibeIntent(raw);
    } catch (err) {
      if (!(err instanceof OllamaMalformedResponseError)) throw err; // unreachable -> propagate
      stageAFailed = true;
    }
    resolved = resolveVibeIntent({ prompt, intent, artistIndex: loadArtistIndex() });
  }

  // A failed Stage A is only a real fallback if the deterministic layer also came up empty. With
  // Ollama down, "justin bieber" still resolves to the right artist id and the result is exactly
  // what it would have been -- warning the user about "basic matching" there would be a lie.
  const usedFallback = stageAFailed && !resolved.hasHardConstraint && resolved.genres.length === 0;

  // --- Score -----------------------------------------------------------------------------------
  const rows = fetchScoringRows(resolved, excludeIds);
  if (rows.length === 0) {
    return { tracks: [], usedFallback, resolved, tier: "broader", tierCounts: { exact: 0, similar: 0, broader: 0 } };
  }

  const tasteScores =
    opts.applyTaste === false ? undefined : rankNormalize([...(await getTasteScoreMap(rows.map((r) => r.id)))].map(([id, s]) => [id, s] as [number, number]));

  let ranked = scoreCandidates(rows, resolved, { tasteScores, sessionId: opts.sessionId });

  // --- Expand ----------------------------------------------------------------------------------
  // Only when the prompt set a hard constraint and the library can't satisfy it `limit` times over.
  if (resolved.hasHardConstraint && ranked.filter((c) => c.satisfiesHard).length < limit) {
    const seeds = fetchHardMatchSeedIds(resolved, MAX_EXPANSION_SEEDS);
    if (seeds.length > 0) {
      const matches = await fetchSimilarToTrackSet(seeds, {
        excludeIds: [...excludeIds, ...seeds],
        topK: limit * 3,
        timeoutMs: EXPANSION_TIMEOUT_MS,
      });
      if (matches.length > 0) {
        const neighbourScores = rankNormalize(matches.map((m) => [m.track_id, m.score] as [number, number]));
        ranked = scoreCandidates(rows, resolved, { tasteScores, neighbourScores, sessionId: opts.sessionId });
      }
    }
  }

  // --- Curate ----------------------------------------------------------------------------------
  // Skipped when the prompt is already unambiguous, and on every Vibe Radio replenishment: re-asking
  // a model to re-pick from a different slice of the same library produces drift between batches,
  // and costs 1-2s inside the crossfade window useVibeRadio.ts is racing.
  const shouldCurate = opts.useStageB !== false && !resolved.hasHardConstraint && !stageAFailed;
  let picks = ranked.slice(0, limit);

  if (shouldCurate) {
    const shortlist = ranked.slice(0, STAGE_B_MAX_CANDIDATES);
    const byId = new Map(shortlist.map((c) => [c.id, c]));
    try {
      const selection = await chatJson({
        model: opts.model,
        system: vibeSelectSystemPrompt(limit),
        user: `"${prompt}"\n\nCandidates:\n${shortlist.map(formatVibeCandidate).join("\n")}`,
        schema: VIBE_SELECT_SCHEMA,
        temperature: 0.3,
        validate: isVibeSelection,
      });
      // Never trust an LLM id blindly -- resolve against the real candidate set and dedupe.
      const seen = new Set<number>();
      const chosen: ScoredCandidate[] = [];
      for (const id of selection.trackIds) {
        const candidate = byId.get(id);
        if (!candidate || seen.has(id)) continue;
        seen.add(id);
        chosen.push(candidate);
      }
      // A pick that breaks a hard constraint is dropped while compliant ones remain.
      const gated = gateIfSatisfiable(chosen, (c) => c.satisfiesHard, limit).slice(0, limit);
      if (gated.length > 0) {
        // Top up from score order if the model returned fewer than asked, so a terse model can't
        // shorten the queue.
        const used = new Set(gated.map((c) => c.id));
        picks = [...gated, ...ranked.filter((c) => !used.has(c.id))].slice(0, limit);
      }
    } catch (err) {
      if (!(err instanceof OllamaMalformedResponseError)) throw err; // unreachable -> propagate
      // Keep the score order -- which is already a good answer, not a degraded one.
    }
  }

  return {
    tracks: getTrackSummariesByIds(getDb(), picks.map((c) => c.id)),
    usedFallback,
    resolved,
    ...summarizeTiers(picks),
  };
}
