/**
 * Debug tooling: overlays audible clicks on a track's own audio at every detected beat (and a
 * higher-pitched click on downbeats), so the current beat-grid detector's output can be heard
 * directly instead of only inspected as numbers. See app/api/v1/tracks/[id]/beat-click/route.ts.
 */

const CLICK_DURATION_SEC = 0.03;
const CLICK_DECAY_RATE = 45; // higher = shorter, snappier click
const BEAT_CLICK_HZ = 1500;
const DOWNBEAT_CLICK_HZ = 2600;
const MUSIC_GAIN = 0.55; // ducked so clicks cut through
const CLICK_GAIN = 0.9;

function synthesizeClick(sampleRate: number, freq: number, gain: number): Float32Array {
  const n = Math.round(sampleRate * CLICK_DURATION_SEC);
  const click = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    click[i] = gain * Math.exp(-t * CLICK_DECAY_RATE) * Math.sin(2 * Math.PI * freq * t);
  }
  return click;
}

/**
 * Mixes `samples` (ducked) with a click at every entry of `beats`, using a distinct pitch for
 * entries that also appear in `downbeats` — exact float equality is safe here since downbeats are
 * always a subset of the same beat-timestamp array (see estimateDownbeats), never recomputed.
 */
export function renderBeatClickOverlay(samples: Float32Array, sampleRate: number, beats: number[], downbeats: number[]): Float32Array {
  const downbeatSet = new Set(downbeats);
  const beatClick = synthesizeClick(sampleRate, BEAT_CLICK_HZ, CLICK_GAIN);
  const downbeatClick = synthesizeClick(sampleRate, DOWNBEAT_CLICK_HZ, CLICK_GAIN);

  const mixed = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) mixed[i] = samples[i] * MUSIC_GAIN;

  for (const beatTime of beats) {
    const click = downbeatSet.has(beatTime) ? downbeatClick : beatClick;
    const startSample = Math.round(beatTime * sampleRate);
    for (let i = 0; i < click.length && startSample + i < mixed.length; i++) {
      mixed[startSample + i] += click[i];
    }
  }

  for (let i = 0; i < mixed.length; i++) mixed[i] = Math.max(-1, Math.min(1, mixed[i]));
  return mixed;
}
