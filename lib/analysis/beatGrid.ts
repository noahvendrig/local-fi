import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import FFT from "fft.js";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { tracks } from "../db/schema";
import { beatGridPathFor, toDataDirRelative } from "../import/paths";
import { resolveTrackAbsPath } from "../storage/resolveTrackPath";
import { getDataDir } from "../storage/dataDir";
import { detectBeatGrid } from "./bpmDetect";
import { ANALYSIS_SAMPLE_RATE, decodeMonoPcmF32 } from "./pcmDecode";

const DOWNBEAT_WINDOW_SIZE = 2048;
const DOWNBEAT_MAX_FREQ_HZ = 150;
const BAR_LENGTH_BEATS = 4;

function hannWindow(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  return w;
}

/** Low-frequency (kick-drum-band) energy in a short window centered on `sampleIndex`, as a proxy for downbeat strength. */
function lowFrequencyEnergyAt(samples: Float32Array, sampleIndex: number, sampleRate: number, window: Float32Array): number {
  const half = Math.floor(DOWNBEAT_WINDOW_SIZE / 2);
  const start = Math.max(0, Math.min(samples.length - DOWNBEAT_WINDOW_SIZE, sampleIndex - half));
  if (start < 0) return 0;

  const fft = new FFT(DOWNBEAT_WINDOW_SIZE);
  const complexOut = fft.createComplexArray();
  const frame = new Array<number>(DOWNBEAT_WINDOW_SIZE);
  for (let i = 0; i < DOWNBEAT_WINDOW_SIZE; i++) {
    const sample = samples[start + i] ?? 0;
    frame[i] = sample * window[i];
  }
  fft.realTransform(complexOut, frame);

  let energy = 0;
  for (let bin = 1; bin <= DOWNBEAT_WINDOW_SIZE / 2; bin++) {
    const freq = (bin * sampleRate) / DOWNBEAT_WINDOW_SIZE;
    if (freq > DOWNBEAT_MAX_FREQ_HZ) break;
    const re = complexOut[2 * bin];
    const im = complexOut[2 * bin + 1];
    energy += Math.sqrt(re * re + im * im);
  }
  return energy;
}

/** Average low-frequency (kick-band) energy across a set of timestamps — the same score used for
 *  both phase-correction and downbeat voting below, so both share one notion of "where's the kick". */
function averageLowFrequencyEnergy(times: number[], samples: Float32Array, sampleRate: number, window: Float32Array): number {
  if (times.length === 0) return -Infinity;
  let sum = 0;
  for (const t of times) sum += lowFrequencyEnergyAt(samples, Math.round(t * sampleRate), sampleRate, window);
  return sum / times.length;
}

/**
 * Onset-based beat tracking can lock onto a track's strongest *off-beat* pulse rather than the
 * underlying on-beat kick — same tempo and spacing, just shifted by half a beat. This is common in
 * UK garage/2-step and similar genres, where a shuffled hi-hat/snare pattern is often as regular
 * (or more so) as the kick itself, and Beatroot has no prior for "the kick is the true beat".
 * Tests the midpoints between each pair of consecutive detected beats against the same kick-band
 * energy score used for downbeat voting: if the midpoints average more kick energy than the beats
 * themselves, the whole detected grid is half a beat off, and swapping to the midpoints corrects
 * every beat at once (rather than requiring a separate per-bar realignment).
 */
function correctBeatPhase(beats: number[], samples: Float32Array, sampleRate: number, window: Float32Array): number[] {
  if (beats.length < 2) return beats;
  const midpoints: number[] = [];
  for (let i = 0; i < beats.length - 1; i++) midpoints.push((beats[i] + beats[i + 1]) / 2);

  const beatEnergy = averageLowFrequencyEnergy(beats, samples, sampleRate, window);
  const midpointEnergy = averageLowFrequencyEnergy(midpoints, samples, sampleRate, window);
  return midpointEnergy > beatEnergy ? midpoints : beats;
}

export interface BeatGridEstimate {
  /** Phase-corrected beat timestamps (see correctBeatPhase) — may differ from detectBeatGrid's raw
   *  output by a uniform half-beat shift when that scores better against kick-band energy. */
  beats: number[];
  downbeats: number[];
}

/**
 * v1 beat-grid heuristic: first corrects a systematic half-beat phase error (see correctBeatPhase),
 * then assumes 4/4 time and picks whichever of the 4 beat-grid phases has the strongest average
 * low-frequency (kick-drum-band) energy, on the theory that "beat 1" of a bar is usually where the
 * kick lands hardest. This is an approximation, not true ML meter-tracking (no such model exists in
 * this repo) — good enough for choosing a bar-aligned transition point, not guaranteed to match a
 * human's sense of "one" for every genre/arrangement.
 */
export function estimateBeatGrid(rawBeats: number[], samples: Float32Array, sampleRate: number): BeatGridEstimate {
  if (rawBeats.length < BAR_LENGTH_BEATS) return { beats: rawBeats, downbeats: rawBeats };

  const window = hannWindow(DOWNBEAT_WINDOW_SIZE);
  const beats = correctBeatPhase(rawBeats, samples, sampleRate, window);
  const scores = beats.map((beatTime) => lowFrequencyEnergyAt(samples, Math.round(beatTime * sampleRate), sampleRate, window));

  let bestPhase = 0;
  let bestAvg = -Infinity;
  for (let phase = 0; phase < BAR_LENGTH_BEATS; phase++) {
    let sum = 0;
    let count = 0;
    for (let i = phase; i < scores.length; i += BAR_LENGTH_BEATS) {
      sum += scores[i];
      count++;
    }
    const avg = count > 0 ? sum / count : -Infinity;
    if (avg > bestAvg) {
      bestAvg = avg;
      bestPhase = phase;
    }
  }

  const downbeats: number[] = [];
  for (let i = bestPhase; i < beats.length; i += BAR_LENGTH_BEATS) downbeats.push(beats[i]);
  return { beats, downbeats };
}

export interface BeatGridData {
  beats: number[];
  /** Bar-1 timestamps (seconds) — see estimateDownbeats. Persisted alongside beats so the AI DJ
   *  JIT prep pipeline (lib/store/aiDj.ts) never needs a fresh PCM decode just to bar-align a
   *  transition once a track's grid has already been computed once. */
  downbeats: number[];
}

function readBeatGridSidecar(relativePath: string): BeatGridData | null {
  const absPath = path.join(getDataDir(), relativePath);
  if (!existsSync(absPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(absPath, "utf8"));
    if (parsed && Array.isArray(parsed.beats) && Array.isArray(parsed.downbeats)) return parsed as BeatGridData;
    return null;
  } catch {
    return null;
  }
}

/** Writes the beat-grid sidecar for `trackUuid` and returns its data-dir-relative path. */
export function persistBeatGrid(trackUuid: string, beats: number[], downbeats: number[]): string {
  const absPath = beatGridPathFor(trackUuid);
  mkdirSync(path.dirname(absPath), { recursive: true });
  writeFileSync(absPath, JSON.stringify({ beats, downbeats } satisfies BeatGridData));
  return toDataDirRelative(absPath);
}

/**
 * Returns a track's beat grid (beats + estimated downbeats), computing and persisting it on
 * demand if it predates this feature (beatGridStatus not yet 'ready') — so existing crates don't
 * need a full re-analysis pass.
 */
export async function ensureBeatGrid(trackId: number): Promise<BeatGridData | null> {
  const db = getDb();
  const track = db.select().from(tracks).where(eq(tracks.id, trackId)).get();
  if (!track) return null;

  if (track.beatGridStatus === "ready" && track.beatGridPath) {
    const cached = readBeatGridSidecar(track.beatGridPath);
    if (cached) return cached;
  }

  const absPath = resolveTrackAbsPath(track);
  const samples = await decodeMonoPcmF32(absPath, ANALYSIS_SAMPLE_RATE);
  const detected = detectBeatGrid(samples, ANALYSIS_SAMPLE_RATE);
  if (!detected) {
    db.update(tracks).set({ beatGridStatus: "failed" }).where(eq(tracks.id, trackId)).run();
    return null;
  }

  const { beats, downbeats } = estimateBeatGrid(detected.beats, samples, ANALYSIS_SAMPLE_RATE);
  const relativePath = persistBeatGrid(track.uuid, beats, downbeats);
  db.update(tracks).set({ beatGridStatus: "ready", beatGridPath: relativePath }).where(eq(tracks.id, trackId)).run();
  return { beats, downbeats };
}
