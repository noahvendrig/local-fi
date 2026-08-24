const CURVE_STEPS = 64;

/** Never fade longer than half the outgoing track, so short songs still have a body. */
export function fadeDurationSeconds(trackDuration: number, requested: number): number {
  if (requested <= 0 || trackDuration <= 0) return 0;
  return Math.min(requested, trackDuration / 2);
}

export function equalPowerOutCurve(loudness: number): Float32Array {
  const curve = new Float32Array(CURVE_STEPS);
  for (let i = 0; i < CURVE_STEPS; i++) {
    const t = i / (CURVE_STEPS - 1);
    curve[i] = Math.cos((t * Math.PI) / 2) * loudness;
  }
  return curve;
}

export function equalPowerInCurve(loudness: number): Float32Array {
  const curve = new Float32Array(CURVE_STEPS);
  for (let i = 0; i < CURVE_STEPS; i++) {
    const t = i / (CURVE_STEPS - 1);
    curve[i] = Math.sin((t * Math.PI) / 2) * loudness;
  }
  return curve;
}
