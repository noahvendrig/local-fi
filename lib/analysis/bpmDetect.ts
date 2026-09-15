import MusicTempo from "music-tempo";

const MIN_SAMPLES_FOR_ANALYSIS_SECONDS = 5;

export interface BeatGridResult {
  tempo: number;
  /** Beat timestamps in seconds, in track-playback order (Beatroot's chosen agent's event train). */
  beats: number[];
}

/**
 * Wraps music-tempo's Beatroot algorithm (MIT). Returns both the scalar tempo and the beat grid
 * (`result.beats`) the algorithm already computes internally — previously only `tempo` was read
 * here and the beat grid was discarded. Returns null for tracks too short or too irregular to get
 * a confident read.
 */
export function detectBeatGrid(samples: Float32Array, sampleRate: number): BeatGridResult | null {
  if (samples.length < sampleRate * MIN_SAMPLES_FOR_ANALYSIS_SECONDS) return null;

  try {
    const result = new MusicTempo(samples);
    const tempo = Number(result.tempo);
    if (!Number.isFinite(tempo) || tempo <= 0) return null;
    return { tempo: Math.round(tempo * 10) / 10, beats: result.beats };
  } catch {
    return null;
  }
}

/** Thin wrapper over {@link detectBeatGrid} for callers that only need the scalar tempo. */
export function detectBpm(samples: Float32Array, sampleRate: number): number | null {
  return detectBeatGrid(samples, sampleRate)?.tempo ?? null;
}
