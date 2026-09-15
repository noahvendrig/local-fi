import { keyCompatibility, semitoneShiftBetweenKeys } from "./djMatch";
import type { LoopSection } from "./loopPointDetect";

/** Everything computeTransitionPlan needs about one side of a transition, in that track's own,
 *  untouched timeline (seconds from the start of the file). */
export interface TransitionTrackInfo {
  bpm: number;
  key: string | null;
  durationSeconds: number;
  /** Bar-1 timestamps — see lib/analysis/beatGrid.ts's estimateDownbeats. */
  downbeats: number[];
}

export interface FadeWindow {
  /** Seconds after `outgoingStartSec`. */
  offsetSec: number;
  durationSec: number;
}

export interface TransitionPlan {
  /** Applied to the incoming track's SoundTouch node, for the rest of its life (not just this
   *  transition) — every track in an AI DJ set is locked to the same session-wide target BPM (see
   *  useAiDjStore's targetBpm), so there's nothing to ramp back afterward. */
  incomingTempoRatio: number;
  /** Also permanent — chosen once per transition, not a transitional cosmetic shift. See
   *  chooseKeyShift. */
  incomingPitchSemitones: number;
  /** Bar-aligned position (seconds, in the outgoing track's own timeline) where the transition begins. */
  outgoingStartSec: number;
  /** How many seconds before `outgoingStartSec` the incoming stem sources must be started (from
   *  buffer offset 0) so incoming's first downbeat lands exactly on outgoingStartSec once
   *  time-stretched. Always >= 0. */
  incomingLeadInSec: number;
  /** Vocals swap: outgoing vocals fade out / incoming vocals fade in, over outgoing's still-playing beat. */
  vocalsFade: FadeWindow;
  /** Instrumental swap: outgoing instrumental fades out / incoming instrumental fades in, completing the handover. */
  instrumentalFade: FadeWindow;
  /** Total transition length in real (heard) seconds, from outgoingStartSec to full handover. */
  totalDurationSec: number;
  /** One bar in the outgoing track's own native timeline — the unit transition windows are aligned to. */
  barLengthSec: number;
  /** If set, the outgoing track's playback should natively loop [startSec, endSec) for the
   *  remainder of the transition — totalDurationSec can exceed one pass through this phrase, and
   *  looping it is how we avoid ever overlaying the incoming track onto unrepeated material
   *  (e.g. drifting into a chorus). Null when no safe loop point was found, in which case
   *  outgoingStartSec falls back to the last few bars of the track as before. */
  loopRegion: LoopSection | null;
}

const BAR_LENGTH_BEATS = 4;
const TRANSITION_BARS = 32;
const MIN_TRANSITION_BARS = 16;
const FALLBACK_BAR_SECONDS = 2; // ~120bpm, used only if bpm is somehow <= 0

function nearestDownbeat(target: number, downbeats: number[]): number {
  if (downbeats.length === 0) return target;
  let best = downbeats[0];
  let bestDiff = Math.abs(downbeats[0] - target);
  for (const d of downbeats) {
    const diff = Math.abs(d - target);
    if (diff < bestDiff) {
      best = d;
      bestDiff = diff;
    }
  }
  return best;
}

/** Only forces the incoming track onto the outgoing (effective) key when its own key doesn't
 *  already mix well with it — same/relative/adjacent Camelot positions ("ok") are left at their
 *  native pitch rather than being flattened to an identical key, so the AI DJ's key journey moves
 *  around the wheel instead of collapsing to one pitch and mangling every track equally. */
function chooseKeyShift(incomingKey: string | null, outgoingEffectiveKey: string | null): number {
  if (!incomingKey || !outgoingEffectiveKey) return 0;
  const compat = keyCompatibility(incomingKey, outgoingEffectiveKey);
  if (compat && compat.level === "ok") return 0;
  return semitoneShiftBetweenKeys(incomingKey, outgoingEffectiveKey);
}

/**
 * Computes a bar-aligned, beatmatched stem-mashup transition from `outgoing` into `incoming`.
 * Pure and synchronous — the caller (useAiDjEngine) is responsible for turning these
 * track-relative seconds into actual AudioContext schedule times.
 *
 * The transition is staggered in two halves: first the outgoing track's vocals are swapped for
 * incoming's (its instrumental keeps playing underneath — this is the "song 1 beat, song 2
 * vocals" mashup moment), then the instrumentals are swapped too, completing the handover.
 *
 * Both tracks are locked to `targetBpm` (a single tempo for the whole AI DJ set, chosen up front)
 * rather than to each other, so `incomingTempoRatio` and the outgoing side's own (already-applied,
 * unreturned) ratio are each independently targetBpm/bpm. `outgoingEffectiveKey` is the outgoing
 * track's *currently playing* key (its native key, shifted by whatever chooseKeyShift picked for
 * it when it started) — not necessarily outgoing's own stored key, since it may already have been
 * transposed for its own predecessor.
 */
export function computeTransitionPlan(
  outgoing: TransitionTrackInfo,
  incoming: TransitionTrackInfo,
  targetBpm: number,
  outgoingEffectiveKey: string | null,
  outgoingLoop?: LoopSection | null
): TransitionPlan {
  const outgoingTempoRatio = outgoing.bpm > 0 ? targetBpm / outgoing.bpm : 1;
  const incomingTempoRatio = incoming.bpm > 0 ? targetBpm / incoming.bpm : 1;
  const incomingPitchSemitones = chooseKeyShift(incoming.key, outgoingEffectiveKey);

  // Native (outgoing's own untouched timeline) bar length and transition span — downbeats and
  // durationSeconds are both native quantities, so this stays exactly the pre-single-bpm math.
  const barLengthSec = outgoing.bpm > 0 ? (60 / outgoing.bpm) * BAR_LENGTH_BEATS : FALLBACK_BAR_SECONDS;

  let outgoingStartSec: number;
  let nativeDurationSec: number;
  if (outgoingLoop) {
    outgoingStartSec = outgoingLoop.startSec;
    nativeDurationSec = barLengthSec * TRANSITION_BARS;
  } else {
    const maxDurationSec = Math.max(barLengthSec * MIN_TRANSITION_BARS, outgoing.durationSeconds * 0.5);
    nativeDurationSec = Math.min(barLengthSec * TRANSITION_BARS, maxDurationSec);
    const rawStart = Math.max(0, outgoing.durationSeconds - nativeDurationSec);
    const candidateDownbeats = outgoing.downbeats.filter((t) => t <= outgoing.durationSeconds);
    outgoingStartSec = nearestDownbeat(rawStart, candidateDownbeats);
  }

  // Real (heard) seconds the transition actually spans — differs from nativeDurationSec whenever
  // outgoing's stretched-to-target rate isn't 1.
  const totalDurationSec = outgoingTempoRatio > 0 ? nativeDurationSec / outgoingTempoRatio : nativeDurationSec;

  const incomingFirstDownbeat = incoming.downbeats[0] ?? 0;
  const incomingLeadInSec = incomingTempoRatio > 0 ? incomingFirstDownbeat / incomingTempoRatio : incomingFirstDownbeat;

  const half = totalDurationSec / 2;
  const vocalsFade: FadeWindow = { offsetSec: 0, durationSec: half };
  const instrumentalFade: FadeWindow = { offsetSec: half, durationSec: totalDurationSec - half };

  return {
    incomingTempoRatio,
    incomingPitchSemitones,
    outgoingStartSec,
    incomingLeadInSec,
    vocalsFade,
    instrumentalFade,
    totalDurationSec,
    barLengthSec,
    loopRegion: outgoingLoop ?? null,
  };
}
