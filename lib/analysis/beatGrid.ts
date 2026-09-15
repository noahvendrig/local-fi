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

/**
 * v1 downbeat heuristic: assumes 4/4 time and picks whichever of the 4 beat-grid phases has the
 * strongest average low-frequency (kick-drum-band) energy, on the theory that "beat 1" of a bar is
 * usually where the kick lands hardest. This is an approximation, not true ML meter-tracking (no
 * such model exists in this repo) — good enough for choosing a bar-aligned transition point, not
 * guaranteed to match a human's sense of "one" for every genre/arrangement.
 */
export function estimateDownbeats(beats: number[], samples: Float32Array, sampleRate: number): number[] {
  if (beats.length < BAR_LENGTH_BEATS) return beats;

  const window = hannWindow(DOWNBEAT_WINDOW_SIZE);
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
  return downbeats;
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

  const downbeats = estimateDownbeats(detected.beats, samples, ANALYSIS_SAMPLE_RATE);
  const relativePath = persistBeatGrid(track.uuid, detected.beats, downbeats);
  db.update(tracks).set({ beatGridStatus: "ready", beatGridPath: relativePath }).where(eq(tracks.id, trackId)).run();
  return { beats: detected.beats, downbeats };
}
