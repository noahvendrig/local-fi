/** A bar-aligned region (native, unstretched file-seconds) where a track's own audio repeats
 *  itself near-identically — see findLoopSection. */
export interface LoopSection {
  startSec: number;
  endSec: number;
}

const ENVELOPE_WINDOW_SEC = 0.05;
const PHRASE_BARS = 4;
/** How closely two phrases' energy envelopes must correlate to count as "the same" — real loops
 *  are rarely bit-exact (mastering/limiter dither, tails), so this is a near-identity threshold
 *  rather than 1.0. */
const SIMILARITY_THRESHOLD = 0.92;
const MAX_ENERGY_RATIO_DIFF = 0.25;

function monoSamples(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const out = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) out[i] += data[i] / buffer.numberOfChannels;
  }
  return out;
}

function rmsEnvelope(samples: Float32Array, sampleRate: number, fromSec: number, toSec: number): Float32Array {
  const fromIdx = Math.max(0, Math.floor(fromSec * sampleRate));
  const toIdx = Math.min(samples.length, Math.ceil(toSec * sampleRate));
  const windowSamples = Math.max(1, Math.round(ENVELOPE_WINDOW_SEC * sampleRate));
  const windowCount = Math.max(0, Math.floor((toIdx - fromIdx) / windowSamples));
  const envelope = new Float32Array(windowCount);
  for (let w = 0; w < windowCount; w++) {
    const start = fromIdx + w * windowSamples;
    let sumSq = 0;
    for (let i = start; i < start + windowSamples; i++) sumSq += samples[i] * samples[i];
    envelope[w] = Math.sqrt(sumSq / windowSamples);
  }
  return envelope;
}

/** Cosine similarity of two envelope slices, plus how different their average loudness is —
 *  a phrase that's shape-similar but much quieter/louder (e.g. a filtered breakdown vs. the drop)
 *  isn't a safe loop point even if the correlation looks high. */
function compareEnvelopes(a: Float32Array, b: Float32Array): { correlation: number; energyRatioDiff: number } | null {
  const len = Math.min(a.length, b.length);
  if (len < 8) return null;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
    sumA += a[i];
    sumB += b[i];
  }
  if (magA === 0 || magB === 0) return null;
  const correlation = dot / Math.sqrt(magA * magB);
  const meanA = sumA / len;
  const meanB = sumB / len;
  const energyRatioDiff = Math.abs(meanA - meanB) / Math.max(meanA, meanB, 1e-6);
  return { correlation, energyRatioDiff };
}

/**
 * Scans the second half of a track for the earliest 4-bar phrase that repeats itself near-
 * identically right afterward (a stable instrumental loop/outro/breakdown), so the AI DJ can begin
 * a transition there instead of wherever the last N bars happen to land — which can otherwise cut
 * across unrepeated material like a chorus's vocal line. `downbeats` and `durationSeconds` are in
 * the track's own native (unstretched) file-seconds, matching transitionPlan.ts's convention.
 * Returns null if no such phrase is found in the back half of the track, so the caller can fall
 * back to its default (end-of-track) transition point.
 */
export function findLoopSection(buffer: AudioBuffer, bpm: number, downbeats: number[], durationSeconds: number): LoopSection | null {
  if (bpm <= 0 || downbeats.length === 0) return null;
  const barLengthSec = (60 / bpm) * 4;
  const phraseLengthSec = barLengthSec * PHRASE_BARS;
  const halfDuration = durationSeconds / 2;

  const samples = monoSamples(buffer);
  const envelope = rmsEnvelope(samples, buffer.sampleRate, halfDuration, durationSeconds);
  const windowsPerPhrase = Math.round(phraseLengthSec / ENVELOPE_WINDOW_SEC);
  if (windowsPerPhrase < 8) return null;

  const candidates = downbeats.filter((d) => d >= halfDuration && d + 2 * phraseLengthSec <= durationSeconds);

  for (const start of candidates) {
    const aFrom = Math.round((start - halfDuration) / ENVELOPE_WINDOW_SEC);
    const bFrom = aFrom + windowsPerPhrase;
    if (bFrom + windowsPerPhrase > envelope.length) continue;
    const a = envelope.subarray(aFrom, aFrom + windowsPerPhrase);
    const b = envelope.subarray(bFrom, bFrom + windowsPerPhrase);
    const result = compareEnvelopes(a, b);
    if (result && result.correlation >= SIMILARITY_THRESHOLD && result.energyRatioDiff <= MAX_ENERGY_RATIO_DIFF) {
      return { startSec: start, endSec: start + phraseLengthSec };
    }
  }
  return null;
}

/** Sums two same-source buffers (e.g. separated vocals + instrumental) back into an approximation
 *  of the original mix, so loop detection can see vocal content too — an instrumental loop that
 *  keeps repeating while vocal ad-libs vary (a chorus, typically) must NOT look like a safe loop. */
export function sumAudioBuffers(a: AudioBuffer, b: AudioBuffer, ctx: AudioContext | BaseAudioContext): AudioBuffer {
  const numberOfChannels = Math.max(a.numberOfChannels, b.numberOfChannels);
  const length = Math.min(a.length, b.length);
  const out = ctx.createBuffer(numberOfChannels, length, a.sampleRate);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const aData = a.getChannelData(Math.min(ch, a.numberOfChannels - 1));
    const bData = b.getChannelData(Math.min(ch, b.numberOfChannels - 1));
    const outData = out.getChannelData(ch);
    for (let i = 0; i < length; i++) outData[i] = aData[i] + bData[i];
  }
  return out;
}
