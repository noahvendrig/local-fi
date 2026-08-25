import FFT from "fft.js";
import { semitoneToCamelotKey } from "../tags/camelotKey";

const WINDOW_SIZE = 4096;
const MIN_FREQ_HZ = 60;
const MAX_FREQ_HZ = 4000;
const MIN_SAMPLES_FOR_ANALYSIS_SECONDS = 5;
/** Below this Krumhansl-Schmuckler correlation, treat the track as having no confident tonal center. */
const MIN_CORRELATION = 0.15;

// Krumhansl-Kessler probe-tone key profiles (1982), indexed by scale degree from the tonic.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function hannWindow(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  return w;
}

/** A4 = 440Hz = MIDI 69, pitch class 9 (C=0). */
function pitchClassForFrequency(freq: number): number {
  const midi = 69 + 12 * Math.log2(freq / 440);
  return ((Math.round(midi) % 12) + 12) % 12;
}

function pearsonCorrelation(a: number[], b: number[]): number {
  const n = a.length;
  const meanA = a.reduce((s, x) => s + x, 0) / n;
  const meanB = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

/** Rotates a tonic-relative profile into absolute-pitch-class order for a candidate tonic. */
function profileForTonic(profile: number[], tonic: number): number[] {
  return Array.from({ length: 12 }, (_, pc) => profile[(pc - tonic + 12) % 12]);
}

/**
 * Chroma + Krumhansl-Schmuckler key estimation — implemented directly (no third-party MIR
 * library; see DJ view plan's AGPL note) using fft.js (MIT) for the underlying FFT. Samples the
 * track roughly once a second rather than continuously, since a track's key is normally stable
 * throughout and a sparse average is enough to find its tonal center.
 */
export function detectKey(samples: Float32Array, sampleRate: number): string | null {
  if (samples.length < sampleRate * MIN_SAMPLES_FOR_ANALYSIS_SECONDS) return null;

  const fft = new FFT(WINDOW_SIZE);
  const window = hannWindow(WINDOW_SIZE);
  const complexOut = fft.createComplexArray();
  const frame = new Array<number>(WINDOW_SIZE);
  const chroma = new Array(12).fill(0);

  const hop = sampleRate;
  let framesUsed = 0;
  for (let start = 0; start + WINDOW_SIZE <= samples.length; start += hop) {
    for (let i = 0; i < WINDOW_SIZE; i++) frame[i] = samples[start + i] * window[i];
    fft.realTransform(complexOut, frame);

    for (let bin = 1; bin <= WINDOW_SIZE / 2; bin++) {
      const freq = (bin * sampleRate) / WINDOW_SIZE;
      if (freq < MIN_FREQ_HZ || freq > MAX_FREQ_HZ) continue;
      const re = complexOut[2 * bin];
      const im = complexOut[2 * bin + 1];
      chroma[pitchClassForFrequency(freq)] += Math.sqrt(re * re + im * im);
    }
    framesUsed++;
  }

  if (framesUsed === 0) return null;

  let best: { tonic: number; mode: "major" | "minor"; score: number } | null = null;
  for (let tonic = 0; tonic < 12; tonic++) {
    const majorScore = pearsonCorrelation(chroma, profileForTonic(MAJOR_PROFILE, tonic));
    const minorScore = pearsonCorrelation(chroma, profileForTonic(MINOR_PROFILE, tonic));
    if (!best || majorScore > best.score) best = { tonic, mode: "major", score: majorScore };
    if (!best || minorScore > best.score) best = { tonic, mode: "minor", score: minorScore };
  }

  if (!best || best.score < MIN_CORRELATION) return null;
  return semitoneToCamelotKey(best.tonic, best.mode);
}
