import { camelotKeyName, camelotKeyToSemitone, camelotWheelDistance, parseCamelotKey } from "@/lib/tags/camelotKey";

export type MatchLevel = "ok" | "warn" | "err";

/** Position on the wheel's color ring, matching the Camelot wheel's traditional hue assignment. */
function camelotHue(n: number): number {
  return (150 - (n - 1) * 30 + 360) % 360;
}

export interface CamelotColor {
  bg: string;
  fg: string;
  border: string;
}

/** Fixed-contrast chip colors for a Camelot key, independent of the app's light/dark theme. */
export function camelotColor(camelot: string): CamelotColor {
  const parsed = parseCamelotKey(camelot);
  if (!parsed) return { bg: "var(--lf-surf-2)", fg: "var(--lf-t3)", border: "var(--lf-line)" };
  const hue = camelotHue(parsed.number);
  if (parsed.mode === "B") {
    return { bg: `hsl(${hue} 62% 62%)`, fg: "#14120F", border: `hsl(${hue} 50% 50%)` };
  }
  return { bg: `hsl(${hue} 46% 40%)`, fg: "#FBF7F0", border: `hsl(${hue} 44% 52%)` };
}

export interface KeyCompatibility {
  level: MatchLevel;
  hint: string;
}

/** How well `key` mixes with `target` on the Camelot wheel (same/adjacent/relative = ok, two steps = warn, else clashing). */
export function keyCompatibility(key: string | null, target: string | null): KeyCompatibility | null {
  if (!key || !target) return null;
  const a = parseCamelotKey(key);
  const b = parseCamelotKey(target);
  if (!a || !b) return null;
  const distance = camelotWheelDistance(a.number, b.number);
  const sameMode = a.mode === b.mode;
  if (distance === 0 && sameMode) return { level: "ok", hint: "same key" };
  if (distance === 0) return { level: "ok", hint: "relative" };
  if (distance === 1 && sameMode) return { level: "ok", hint: "adjacent" };
  if (distance === 1) return { level: "warn", hint: "one step off" };
  if (distance === 2 && sameMode) return { level: "warn", hint: "two steps" };
  return { level: "err", hint: "clashing" };
}

export interface TempoDelta {
  pct: number;
  label: string;
  level: MatchLevel;
}

/** Tempo delta of `bpm` from `targetBpm`, as a signed percentage. */
export function tempoDelta(bpm: number | null, targetBpm: number | null): TempoDelta | null {
  if (bpm == null || targetBpm == null) return null;
  const pct = ((bpm - targetBpm) / targetBpm) * 100;
  const abs = Math.abs(pct);
  const level: MatchLevel = abs <= 3 ? "ok" : abs <= 6 ? "warn" : "err";
  const label = `${pct >= 0 ? "+" : "−"}${abs.toFixed(1)}%`;
  return { pct, label, level };
}

export const MATCH_LEVEL_COLOR: Record<MatchLevel, string> = {
  ok: "var(--lf-ok)",
  warn: "var(--lf-warn)",
  err: "var(--lf-err)",
};

/** Shortest signed semitone distance (-6..+6) to transpose `from`'s tonic onto `to`'s tonic. */
export function semitoneShiftBetweenKeys(from: string, to: string): number {
  const fromSemitone = camelotKeyToSemitone(from);
  const toSemitone = camelotKeyToSemitone(to);
  if (fromSemitone == null || toSemitone == null) return 0;
  let diff = (toSemitone - fromSemitone + 12) % 12;
  if (diff > 6) diff -= 12;
  return diff;
}

export interface DjAdjustment {
  /** Playback rate to apply to the source (and mirror onto the SoundTouch node) for tempo matching. */
  tempoRatio: number;
  /** Extra semitone shift (on top of SoundTouch's automatic tempo/pitch decoupling) to land on the target key. */
  pitchSemitones: number;
}

/**
 * Computes the live playback adjustment for a track against the DJ session's target BPM/key/octave.
 * Tempo always follows the target when both are known. Key and octave only shift when key lock is
 * on — with it off, pitch is left to follow tempo naturally (vinyl-style), matching the
 * transport's "Pitch follows tempo" copy. `targetOctave` is relative to the track's original
 * pitch (0 = original, +1 = one octave up, etc.) and stacks on top of any key transpose.
 */
export function computeDjAdjustment(
  track: { bpm: number | null; key: string | null },
  targetBpm: number | null,
  targetKey: string | null,
  keyLockEnabled: boolean,
  targetOctave = 0
): DjAdjustment {
  const tempoRatio = targetBpm && track.bpm ? targetBpm / track.bpm : 1;
  if (!keyLockEnabled) return { tempoRatio, pitchSemitones: 0 };
  const keyShift = targetKey && track.key ? semitoneShiftBetweenKeys(track.key, targetKey) : 0;
  const pitchSemitones = keyShift + targetOctave * 12;
  return { tempoRatio, pitchSemitones };
}

export interface WheelPosition {
  key: string;
  label: string;
  title: string;
  /** CSS custom properties for absolute positioning within a centered wheel container. */
  style: { width: string; height: string; margin: string; transform: string };
}

/** The 24 Camelot wheel positions (major ring outer, minor ring inner) for a picker control. */
export function camelotWheelPositions(): WheelPosition[] {
  const positions: WheelPosition[] = [];
  for (let n = 1; n <= 12; n++) {
    for (const mode of ["B", "A"] as const) {
      const key = `${n}${mode}`;
      const angle = (n - 1) * 30;
      const radius = mode === "B" ? 102 : 58;
      const w = mode === "B" ? 28 : 24;
      const h = mode === "B" ? 20 : 18;
      positions.push({
        key,
        label: key,
        title: `${key} · ${camelotKeyName(key)}`,
        style: {
          width: `${w}px`,
          height: `${h}px`,
          margin: `${-h / 2}px 0 0 ${-w / 2}px`,
          transform: `rotate(${angle}deg) translateY(-${radius}px) rotate(${-angle}deg)`,
        },
      });
    }
  }
  return positions;
}
