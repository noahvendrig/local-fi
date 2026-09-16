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
  /** Vocals swap: incoming vocals fade in (and outgoing's — silent by this point whenever a
   *  loopRegion was found, see loopPointDetect's vocal-end check — fade out alongside them as a
   *  no-op safety net) over the outgoing instrumental's still-looping beat. Starts only after the
   *  solo loop passage (see loopRegion doc below), so there is never a moment with two audible
   *  vocal takes at once. */
  vocalsFade: FadeWindow;
  /** Instrumental handover: a short (not musically-timed) equal-power ramp — long enough to avoid
   *  a sample-discontinuity click, short enough to read as a hard "turn song 1 off, turn song 2
   *  on" cut rather than a crossfade — so the two instrumentals are never both audibly playing at
   *  meaningful volume at once. Fires once incoming's vocals have fully faded in. */
  instrumentalFade: FadeWindow;
  /** Total transition length in real (heard) seconds, from outgoingStartSec to full handover. */
  totalDurationSec: number;
  /** One bar in the outgoing track's own native timeline — the unit transition windows are aligned to. */
  barLengthSec: number;
  /** If set, the outgoing track's playback should natively loop [startSec, endSec) for the
   *  remainder of the transition — totalDurationSec spans several passes through this phrase, and
   *  looping it is how we avoid ever overlaying the incoming track onto unrepeated material (e.g.
   *  drifting into a chorus). findLoopSection only ever returns a phrase that starts after this
   *  track's own vocals have finished, so the "solo" pass and the vocals-fade pass that follows it
   *  are both guaranteed vocal-free on the outgoing side. Null when no safe loop point was found,
   *  in which case outgoingStartSec falls back to the last bars of the track as before, played
   *  forward (not looped) — the same solo/vocals-fade/instrumental-swap shape, just without the
   *  safety margin repetition buys. */
  loopRegion: LoopSection | null;
}

const BAR_LENGTH_BEATS = 4;
const PHRASE_LENGTH_BARS = 4;
/** How many bars the outgoing track's loop plays completely by itself — no incoming audio audible
 *  yet — before incoming's vocals start fading in. Establishes the loop as the new "groove" before
 *  anything is layered onto it. One pass of the 4-bar loop phrase. */
const SOLO_LOOP_BARS = 8;
/** How many bars incoming's vocals take to fade all the way in, over the outgoing instrumental's
 *  still-looping beat. Two more passes of the 4-bar loop phrase. */
const VOCALS_FADE_BARS = 16;
/** Total bars from the transition's start to the instrumental handover — solo loop + vocals fade
 *  — exactly PHRASE_LENGTH_BARS * 3, so a found loopRegion repeats a whole number of times. */
const TRANSITION_BARS = SOLO_LOOP_BARS + VOCALS_FADE_BARS;
/** Fixed (not bar-scaled) real-time length of the instrumental handover ramp — just enough to
 *  avoid an audible sample-discontinuity click on the hard cut; see TransitionPlan.instrumentalFade. */
const INSTRUMENTAL_SWAP_SEC = 0.06;
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
 * Every 4th bar's downbeat — i.e. the start of each 4-bar phrase — on the assumption that
 * `downbeats` (already exactly one bar apart; see estimateDownbeats) counts bars from the very
 * start of the track, so index 0, 4, 8, ... land on phrase boundaries. This is an approximation
 * like the rest of the beat grid: an intro whose length isn't a whole number of 4-bar phrases
 * shifts every later phrase boundary by a constant offset. Cheap to get "mostly right" though,
 * since it needs no new detection — just different indexing into a grid we already compute.
 */
function phraseDownbeats(downbeats: number[]): number[] {
  return downbeats.filter((_, i) => i % PHRASE_LENGTH_BARS === 0);
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
 * The transition has three stages, all riding on the outgoing track's own bar-aligned, verified-
 * loopable 4-bar phrase (see loopRegion / findLoopSection): first that phrase plays solo for
 * SOLO_LOOP_BARS bars (establishing the loop — nothing from incoming is audible yet), then
 * incoming's vocals fade in over VOCALS_FADE_BARS more bars while the outgoing instrumental keeps
 * looping underneath (the "song 1 beat, song 2 vocals" mashup moment — outgoing's own vocals are
 * silent throughout, since findLoopSection only picks phrases after they've finished), and finally
 * the instrumentals are hard-swapped (a click-avoiding ramp of a fraction of a second, not a
 * musical crossfade) to complete the handover. At no point are both tracks' vocals or both tracks'
 * instrumentals audible at meaningful volume simultaneously.
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
    // No verified loop: fall back to playing the outgoing track's own tail forward (not repeated),
    // capped so a short track never has more than half of itself consumed by the transition.
    nativeDurationSec = Math.min(barLengthSec * TRANSITION_BARS, outgoing.durationSeconds * 0.5);
    const rawStart = Math.max(0, outgoing.durationSeconds - nativeDurationSec);
    const candidateDownbeats = outgoing.downbeats.filter((t) => t <= outgoing.durationSeconds);
    // Prefer a phrase (4-bar) boundary so the incoming track's own phrase-1 (its downbeats[0],
    // trivially index 0 under the same counting-from-start assumption) lands on outgoing's phrase
    // boundary too, not just on some arbitrary bar of an in-progress phrase. Falls back to any bar
    // when the track is too short to have a phrase-aligned candidate near the transition point.
    const phraseCandidates = phraseDownbeats(candidateDownbeats);
    outgoingStartSec = nearestDownbeat(rawStart, phraseCandidates.length > 0 ? phraseCandidates : candidateDownbeats);
  }

  // Real (heard) seconds the solo-loop + vocals-fade portion spans — differs from nativeDurationSec
  // whenever outgoing's stretched-to-target rate isn't 1. The instrumental swap ramp tacks on
  // afterward as a fixed real-time length, not a bar-scaled one (see INSTRUMENTAL_SWAP_SEC).
  const musicalDurationSec = outgoingTempoRatio > 0 ? nativeDurationSec / outgoingTempoRatio : nativeDurationSec;
  const totalDurationSec = musicalDurationSec + INSTRUMENTAL_SWAP_SEC;

  const incomingFirstDownbeat = incoming.downbeats[0] ?? 0;
  const incomingLeadInSec = incomingTempoRatio > 0 ? incomingFirstDownbeat / incomingTempoRatio : incomingFirstDownbeat;

  const soloDurationSec = musicalDurationSec * (SOLO_LOOP_BARS / TRANSITION_BARS);
  const vocalsFadeDurationSec = musicalDurationSec - soloDurationSec;
  const vocalsFade: FadeWindow = { offsetSec: soloDurationSec, durationSec: vocalsFadeDurationSec };
  const instrumentalFade: FadeWindow = { offsetSec: musicalDurationSec, durationSec: INSTRUMENTAL_SWAP_SEC };

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
