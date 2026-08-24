import type { RepeatMode } from "@/lib/api/playbackClient";
import type { TrackSummary } from "@/lib/api-client";

export interface UpNextItem {
  track: TrackSummary;
  queueIndex: number;
  isLoop: boolean;
}

/** Upcoming plays from the current queue, including wrap for repeat-all and the current song for repeat-one. */
export function getUpNextItems(queue: TrackSummary[], currentIndex: number, repeatMode: RepeatMode): UpNextItem[] {
  if (queue.length === 0 || currentIndex < 0 || currentIndex >= queue.length) return [];

  if (repeatMode === "one") {
    return [{ track: queue[currentIndex], queueIndex: currentIndex, isLoop: true }];
  }

  const items: UpNextItem[] = [];
  for (let i = currentIndex + 1; i < queue.length; i++) {
    items.push({ track: queue[i], queueIndex: i, isLoop: false });
  }

  if (repeatMode === "all") {
    for (let i = 0; i < currentIndex; i++) {
      items.push({ track: queue[i], queueIndex: i, isLoop: false });
    }
    if (items.length === 0 && queue.length === 1) {
      items.push({ track: queue[0], queueIndex: 0, isLoop: true });
    }
  }

  return items;
}

/** Next queue entry that should play after the current one. Repeat-one loops in-place, so it returns null. */
export function getUpcomingTrack(
  queue: TrackSummary[],
  currentIndex: number,
  repeatMode: RepeatMode,
): { track: TrackSummary; index: number } | null {
  if (queue.length === 0 || currentIndex < 0 || currentIndex >= queue.length) return null;
  if (repeatMode === "one") return null;
  const nextIndex = currentIndex + 1;
  if (nextIndex < queue.length) return { track: queue[nextIndex], index: nextIndex };
  if (repeatMode === "all") return { track: queue[0], index: 0 };
  return null;
}
