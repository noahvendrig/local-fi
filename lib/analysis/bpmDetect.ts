import MusicTempo from "music-tempo";

const MIN_SAMPLES_FOR_ANALYSIS_SECONDS = 5;

/** Wraps music-tempo's Beatroot algorithm (MIT). Returns null for tracks too short or too irregular to get a confident read. */
export function detectBpm(samples: Float32Array, sampleRate: number): number | null {
  if (samples.length < sampleRate * MIN_SAMPLES_FOR_ANALYSIS_SECONDS) return null;

  try {
    const result = new MusicTempo(samples);
    const tempo = Number(result.tempo);
    if (!Number.isFinite(tempo) || tempo <= 0) return null;
    return Math.round(tempo * 10) / 10;
  } catch {
    return null;
  }
}
