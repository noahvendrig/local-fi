import { createHash } from "node:crypto";

/** Lowercases, trims, and collapses whitespace so "The Beatles" / " the  beatles " dedup together. */
export function normalizeForFingerprint(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

export function artistFingerprint(name: string): string {
  return normalizeForFingerprint(name);
}

/** Albums are keyed by title + the *id* of their (already-upserted) album artist, not by name string. */
export function albumFingerprint(title: string, albumArtistId: number | null): string {
  return `${normalizeForFingerprint(title)}|${albumArtistId ?? "none"}`;
}

/** ARCHITECTURE.md §3.6 — a fast composite key, not a full content hash. */
export function trackFingerprint(relativePath: string, fileSizeBytes: number, fileMtimeEpochMs: number): string {
  return createHash("sha1").update(`${relativePath}|${fileSizeBytes}|${fileMtimeEpochMs}`).digest("hex");
}

/** "The Beatles" -> "Beatles, The" (ARCHITECTURE.md §3.3 note). Returns null when there's no article to move. */
export function computeSortName(name: string): string | null {
  const match = name.match(/^(the|a|an)\s+(.+)$/i);
  if (!match) return null;
  const [, article, rest] = match;
  return `${rest}, ${article}`;
}
