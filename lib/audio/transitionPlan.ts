import { semitoneShiftBetweenKeys } from "./djMatch";

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
  /** Applied to the incoming track's SoundTouch node so its beat grid matches the outgoing
   *  track's for the mashup — the outgoing track is already playing at tempoRatio 1/pitch 0 and
   *  is left alone. */
  incomingTempoRatio: number;
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
  /** Total transition length, from outgoingStartSec to full handover. */
  totalDurationSec: number;
  /** One bar at the outgoing track's tempo — the unit transition windows are aligned to. */
  barLengthSec: number;
}

const BAR_LENGTH_BEATS = 4;
const TRANSITION_BARS = 8;
const MIN_TRANSITION_BARS = 2;
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

/**
 * Computes a bar-aligned, beatmatched stem-mashup transition from `outgoing` into `incoming`.
 * Pure and synchronous — the caller (useAiDjEngine) is responsible for turning these
 * track-relative seconds into actual AudioContext schedule times.
 *
 * The transition is staggered in two halves: first the outgoing track's vocals are swapped for
 * incoming's (its instrumental keeps playing underneath — this is the "song 1 beat, song 2
 * vocals" mashup moment), then the instrumentals are swapped too, completing the handover.
 * Incoming's tempo/pitch is warped to match outgoing for the whole window; the engine is expected
 * to ramp it back to incoming's native tempo/pitch by the end of instrumentalFade, since it's the
 * only track still playing at that point.
 */
export function computeTransitionPlan(outgoing: TransitionTrackInfo, incoming: TransitionTrackInfo): TransitionPlan {
  const barLengthSec = outgoing.bpm > 0 ? (60 / outgoing.bpm) * BAR_LENGTH_BEATS : FALLBACK_BAR_SECONDS;
  const incomingTempoRatio = outgoing.bpm > 0 && incoming.bpm > 0 ? outgoing.bpm / incoming.bpm : 1;
  const incomingPitchSemitones = incoming.key && outgoing.key ? semitoneShiftBetweenKeys(incoming.key, outgoing.key) : 0;

  const maxDurationSec = Math.max(barLengthSec * MIN_TRANSITION_BARS, outgoing.durationSeconds * 0.5);
  const totalDurationSec = Math.min(barLengthSec * TRANSITION_BARS, maxDurationSec);

  const rawStart = Math.max(0, outgoing.durationSeconds - totalDurationSec);
  const candidateDownbeats = outgoing.downbeats.filter((t) => t <= outgoing.durationSeconds);
  const outgoingStartSec = nearestDownbeat(rawStart, candidateDownbeats);

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
  };
}
