export const EQ_BAND_HZ = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const EQ_BAND_COUNT = EQ_BAND_HZ.length;
export const EQ_Q = Math.SQRT2;
export const EQ_GAIN_MIN = -12;
export const EQ_GAIN_MAX = 12;

export const EQ_BAND_LABELS = ["32", "64", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"] as const;

export const EQ_PRESET_IDS = [
  "flat",
  "vinylWarmth",
  "bassBoost",
  "vocalForward",
  "lateNight",
  "acoustic",
  "loudness",
  "headphones",
  "custom",
] as const;

export type EqPresetId = (typeof EQ_PRESET_IDS)[number];

export interface EqState {
  enabled: boolean;
  gains: number[];
  preamp: number;
  preset: EqPresetId;
}

export interface EqPreset {
  id: Exclude<EqPresetId, "custom">;
  label: string;
  gains: number[];
}

const FLAT_GAINS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

export const EQ_PRESETS: EqPreset[] = [
  { id: "flat", label: "Flat", gains: [...FLAT_GAINS] },
  { id: "vinylWarmth", label: "Vinyl warmth", gains: [4, 3, 2, 0.5, -1, -1.5, -1, 0, -1, -2] },
  { id: "bassBoost", label: "Bass boost", gains: [7, 6, 4.5, 2.5, 0.5, 0, 0, 0, 0, 0] },
  { id: "vocalForward", label: "Vocal forward", gains: [-2, -2, -1, 0, 2, 3.5, 3, 1.5, 0, -1] },
  { id: "lateNight", label: "Late night", gains: [-3, -2.5, -1.5, 0, 1.5, 2, 1.5, 0.5, -1.5, -3] },
  { id: "acoustic", label: "Acoustic", gains: [2, 1.5, 0.5, 0, 1, 1.5, 2, 2.5, 2, 1] },
  { id: "loudness", label: "Loudness", gains: [6, 4.5, 1, -1, -2, -1.5, 0, 1.5, 4, 5.5] },
  { id: "headphones", label: "Headphones", gains: [4, 3, 1, -1, -1.5, -0.5, 1, 2.5, 3, 2] },
];

export const DEFAULT_EQ_STATE: EqState = {
  enabled: true,
  gains: [...FLAT_GAINS],
  preamp: 0,
  preset: "flat",
};

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

export function clampEqGain(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(EQ_GAIN_MAX, Math.max(EQ_GAIN_MIN, value));
}

export function snapEqGain(value: number): number {
  return clampEqGain(Math.round(value * 2) / 2);
}

export function presetById(id: Exclude<EqPresetId, "custom">): EqPreset {
  const preset = EQ_PRESETS.find((item) => item.id === id);
  return preset ?? EQ_PRESETS[0];
}

export function matchPresetId(gains: number[]): EqPresetId {
  for (const preset of EQ_PRESETS) {
    const gainsMatch = preset.gains.every((gain, index) => Math.abs(gain - (gains[index] ?? 0)) < 0.05);
    if (gainsMatch) return preset.id;
  }
  return "custom";
}

/** Coerces stored JSON (or a PUT body) into a valid 10-band EQ state. */
export function parseEqState(input: unknown): EqState {
  if (!input || typeof input !== "object") return { ...DEFAULT_EQ_STATE, gains: [...DEFAULT_EQ_STATE.gains] };
  const raw = input as Record<string, unknown>;
  const gainsIn = Array.isArray(raw.gains) ? raw.gains : DEFAULT_EQ_STATE.gains;
  const gains = DEFAULT_EQ_STATE.gains.map((_, index) => clampEqGain(Number(gainsIn[index] ?? 0)));
  const preamp = clampEqGain(Number(raw.preamp ?? 0));
  const enabled = raw.enabled !== false;
  return { enabled, gains, preamp, preset: matchPresetId(gains) };
}

export function parseEqJson(raw: string | null | undefined): EqState {
  if (!raw) return { ...DEFAULT_EQ_STATE, gains: [...DEFAULT_EQ_STATE.gains] };
  try {
    return parseEqState(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_EQ_STATE, gains: [...DEFAULT_EQ_STATE.gains] };
  }
}
