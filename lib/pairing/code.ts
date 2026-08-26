import { randomInt } from "node:crypto";

export { normalizePairingCode } from "./codeFormat";

// Unambiguous Crockford-ish alphabet: no 0/O, 1/I/L, so a code read off a screen (or typed
// from memory after a glance) can't be misread. 8 symbols, hyphenated 4-4 for readability —
// matches the design's "4K7Q-91TB" shape.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generatePairingCode(): string {
  let raw = "";
  for (let i = 0; i < 8; i++) {
    raw += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}
