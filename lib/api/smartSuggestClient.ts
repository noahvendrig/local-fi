import type { TrackSummary } from "@/lib/api-client";
import type { QueueSource } from "@/lib/store/player";
import { apiUrl, authHeaders } from "./http";

/** Calls app/api/v1/smart-suggest/route.ts — resolves the most similar-sounding track to
 *  `trackId` within `queueSource`'s scope (a crate) or the whole library (any other scope, or
 *  null), excluding `excludeIds`. Returns null when no eligible candidate exists (not yet
 *  analyzed, empty scope, etc.) rather than throwing -- Smart Shuffle degrades to "play normally"
 *  on any of these, not an error state. */
export async function fetchSmartSuggestion(
  trackId: number,
  queueSource: QueueSource | null,
  excludeIds: number[]
): Promise<TrackSummary | null> {
  try {
    const res = await fetch(apiUrl("/api/v1/smart-suggest"), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ trackId, queueSource, excludeIds }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { track: TrackSummary | null };
    return data.track;
  } catch {
    return null; // best-effort -- playback should never block on this
  }
}
