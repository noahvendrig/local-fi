"use client";

import { usePlayerStore } from "@/lib/store/player";
import { getUpNextItems } from "@/lib/player/upNext";
import { formatDuration } from "@/lib/format/track";
import { UpNextList } from "@/components/shell/UpNextList";

// Bottom queue sheet (design board 1c, "m5 queue sheet" frame) — reuses UpNextList as-is,
// the same reorderable list the desktop right rail and Now Playing overlay already share.
export function QueueSheet() {
  const isOpen = usePlayerStore((s) => s.isQueueOpen);
  const closeQueue = usePlayerStore((s) => s.closeQueue);
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const repeatMode = usePlayerStore((s) => s.repeatMode);

  if (!isOpen) return null;

  const upNext = getUpNextItems(queue, currentIndex, repeatMode);
  const totalSeconds = upNext.reduce((sum, item) => sum + item.track.durationSeconds, 0);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end md:hidden">
      <div
        className="absolute inset-0"
        onClick={closeQueue}
        style={{
          background: "radial-gradient(110% 50% at 30% 10%, var(--lf-glow-a), transparent 60%), var(--lf-glass)",
        }}
      />
      <div className="relative flex max-h-[76vh] flex-col rounded-t-3xl border border-line border-b-0 bg-surf shadow-[var(--lf-shadow)]">
        <button type="button" onClick={closeQueue} aria-label="Close queue" className="mx-auto mb-2 mt-3 block h-1 w-11 rounded-sm bg-line" />
        <div className="flex items-baseline gap-2.5 px-4 pb-3.5">
          <h2 className="text-lg font-semibold text-t1">Up next</h2>
          <span className="font-mono text-xs text-t3">
            {upNext.length} track{upNext.length === 1 ? "" : "s"} · {formatDuration(totalSeconds)}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          <UpNextList />
        </div>
      </div>
    </div>
  );
}
