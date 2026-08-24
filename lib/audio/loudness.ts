/** Typical well-mastered pop sits around here on waveform_avg_level's 0–1 mean-abs scale. */
export const LOUDNESS_TARGET_LEVEL = 0.18;
export const LOUDNESS_MIN_DB = -12;
export const LOUDNESS_MAX_DB = 8;

/**
 * Linear gain that brings a track's stored mean-abs level toward LOUDNESS_TARGET_LEVEL.
 * Missing/tiny levels pass through unchanged so we don't boost silence or failed waveforms.
 */
export function loudnessGain(avgLevel: number | null | undefined, enabled: boolean): number {
  if (!enabled || avgLevel == null || !(avgLevel > 0.001)) return 1;
  const db = 20 * Math.log10(LOUDNESS_TARGET_LEVEL / avgLevel);
  const clamped = Math.min(LOUDNESS_MAX_DB, Math.max(LOUDNESS_MIN_DB, db));
  return Math.pow(10, clamped / 20);
}
