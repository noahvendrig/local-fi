/**
 * Camelot wheel (DJ mixing notation) helpers. Canonical spelling per position matches the
 * standard wheel: minor (A) ring uses flats except F#, major (B) ring uses B/F#/Db then flats.
 */
const MINOR_NOTE_BY_CAMELOT = ["Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "Db"];
const MAJOR_NOTE_BY_CAMELOT = ["B", "F#", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E"];

const NOTE_TO_SEMITONE: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

const SEMITONE_BY_NOTE_MINOR = MINOR_NOTE_BY_CAMELOT.map((note) => NOTE_TO_SEMITONE[note]);
const SEMITONE_BY_NOTE_MAJOR = MAJOR_NOTE_BY_CAMELOT.map((note) => NOTE_TO_SEMITONE[note]);

const CAMELOT_PATTERN = /^(1[0-2]|[1-9])([AB])$/i;

export type CamelotMode = "A" | "B";

export function parseCamelotKey(key: string): { number: number; mode: CamelotMode } | null {
  const match = CAMELOT_PATTERN.exec(key.trim());
  if (!match) return null;
  return { number: Number(match[1]), mode: match[2].toUpperCase() as CamelotMode };
}

export function isCamelotKey(key: string): boolean {
  return CAMELOT_PATTERN.test(key.trim());
}

/** "8a" -> "8A". Assumes `key` already passed `isCamelotKey`. */
export function normalizeCamelotCasing(key: string): string {
  const parsed = parseCamelotKey(key)!;
  return `${parsed.number}${parsed.mode}`;
}

/** Camelot position -> display name, e.g. "8A" -> "A min", "8B" -> "C maj". */
export function camelotKeyName(camelot: string): string | null {
  const parsed = parseCamelotKey(camelot);
  if (!parsed) return null;
  const note = parsed.mode === "A" ? MINOR_NOTE_BY_CAMELOT[parsed.number - 1] : MAJOR_NOTE_BY_CAMELOT[parsed.number - 1];
  return `${note} ${parsed.mode === "A" ? "min" : "maj"}`;
}

/** Camelot position -> compact tag-writeable key string, e.g. "8A" -> "Am", "8B" -> "C". */
export function camelotToWriteableKey(camelot: string): string | null {
  const parsed = parseCamelotKey(camelot);
  if (!parsed) return null;
  const note = parsed.mode === "A" ? MINOR_NOTE_BY_CAMELOT[parsed.number - 1] : MAJOR_NOTE_BY_CAMELOT[parsed.number - 1];
  return parsed.mode === "A" ? `${note}m` : note;
}

/**
 * Parses a freeform key string (as found in ID3 TKEY / music-metadata's `common.key`, or typed by
 * a user) into canonical Camelot notation. Accepts already-Camelot strings ("8A") as a passthrough,
 * and standard notation ("Am", "A minor", "F#", "Gb major", ...). Returns null if unparseable —
 * callers should treat that as "no key", not throw, since tags are free text in practice.
 */
export function normalizeToCamelot(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (isCamelotKey(trimmed)) return normalizeCamelotCasing(trimmed);

  const match = /^([A-Ga-g])\s*([#♯b♭]?)\s*(.*)$/.exec(trimmed);
  if (!match) return null;

  const letter = match[1].toUpperCase();
  const accidentalRaw = match[2];
  const accidental = accidentalRaw === "♯" ? "#" : accidentalRaw === "♭" ? "b" : accidentalRaw;
  const noteKey = `${letter}${accidental}`;
  const semitone = NOTE_TO_SEMITONE[noteKey];
  if (semitone == null) return null;

  const rest = match[3].trim().toLowerCase();
  const isMinor = rest === "m" || rest === "min" || rest === "minor" || rest === "-";
  const isMajor = rest === "" || rest === "maj" || rest === "major";
  if (!isMinor && !isMajor) return null;

  const semitones = isMinor ? SEMITONE_BY_NOTE_MINOR : SEMITONE_BY_NOTE_MAJOR;
  const index = semitones.indexOf(semitone);
  if (index < 0) return null;
  return `${index + 1}${isMinor ? "A" : "B"}`;
}

/** Pitch class (0=C .. 11=B) + major/minor -> Camelot notation. Used by the key detector, whose output is a tonic/mode pair rather than tag text. */
export function semitoneToCamelotKey(semitone: number, mode: "major" | "minor"): string | null {
  const semitones = mode === "minor" ? SEMITONE_BY_NOTE_MINOR : SEMITONE_BY_NOTE_MAJOR;
  const index = semitones.indexOf(((semitone % 12) + 12) % 12);
  if (index < 0) return null;
  return `${index + 1}${mode === "minor" ? "A" : "B"}`;
}

/** Camelot notation -> absolute pitch class (0=C .. 11=B) of its tonic. Inverse of semitoneToCamelotKey. */
export function camelotKeyToSemitone(camelot: string): number | null {
  const parsed = parseCamelotKey(camelot);
  if (!parsed) return null;
  return parsed.mode === "A" ? SEMITONE_BY_NOTE_MINOR[parsed.number - 1] : SEMITONE_BY_NOTE_MAJOR[parsed.number - 1];
}

/** Shortest distance around the 12-position wheel, ignoring A/B mode. */
export function camelotWheelDistance(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 12 - diff);
}
