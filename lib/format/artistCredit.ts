/**
 * Joins credited-artist names into a display label. album_artists/track_artists is the
 * source of truth for the multi-artist case (ARCHITECTURE.md §3.3) — this is what turns
 * that join into text instead of falling back to a single denormalized name.
 */
export function formatArtistCredit(names: string[]): string {
  if (names.length === 0) return "Unknown artist";
  if (names.length <= 2) return names.join(" & ");
  return "Various Artists";
}
