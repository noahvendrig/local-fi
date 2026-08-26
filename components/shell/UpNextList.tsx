"use client";

import { useState } from "react";
import { formatDuration } from "@/lib/format/track";
import { getUpNextItems } from "@/lib/player/upNext";
import { usePlayerStore } from "@/lib/store/player";

interface DragState {
  /** Position of the dragged item within `upNext` (not the raw queue index) when the drag began. */
  startDisplayIndex: number;
  /** Raw queue index of the dragged item — what reorderQueue actually operates on. */
  fromQueueIndex: number;
  pointerId: number;
  startY: number;
  currentY: number;
  rowHeight: number;
}

// Shared upcoming-queue list used by the right-rail drawer, the Now Playing overlay, and the
// mobile QueueSheet. Reordering uses the Pointer Events API (not HTML5 drag-and-drop, which has
// no touch support) so the same drag handle works with mouse, touch, and pen alike.
export function UpNextList() {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const playFromQueue = usePlayerStore((s) => s.playFromQueue);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const reorderQueue = usePlayerStore((s) => s.reorderQueue);

  const upNext = getUpNextItems(queue, currentIndex, repeatMode);
  const canReorder = upNext.length > 1 && upNext.every((item) => !item.isLoop);
  const [drag, setDrag] = useState<DragState | null>(null);

  const upNextLabel =
    repeatMode === "one"
      ? "Up next · looping"
      : canReorder
        ? `Up next · drag to reorder${upNext.length > 0 ? ` · ${upNext.length}` : ""}`
        : `Up next${upNext.length > 0 ? ` · ${upNext.length}` : ""}`;

  // How far (in whole rows) the pointer has moved from where the drag started, clamped to the list bounds.
  function targetDisplayIndex(d: DragState): number {
    const rows = Math.round((d.currentY - d.startY) / d.rowHeight);
    return Math.max(0, Math.min(upNext.length - 1, d.startDisplayIndex + rows));
  }

  function handlePointerDown(e: React.PointerEvent<HTMLSpanElement>, startDisplayIndex: number, fromQueueIndex: number) {
    if (!canReorder) return;
    e.preventDefault();
    const rowHeight = e.currentTarget.closest("li")?.getBoundingClientRect().height || 1;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ startDisplayIndex, fromQueueIndex, pointerId: e.pointerId, startY: e.clientY, currentY: e.clientY, rowHeight });
  }

  function handlePointerMove(e: React.PointerEvent<HTMLSpanElement>) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    setDrag((d) => (d ? { ...d, currentY: e.clientY } : d));
  }

  function handlePointerEnd(e: React.PointerEvent<HTMLSpanElement>, commit: boolean) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (commit) {
      const toQueueIndex = upNext[targetDisplayIndex(drag)]?.queueIndex;
      if (toQueueIndex != null && toQueueIndex !== drag.fromQueueIndex) reorderQueue(drag.fromQueueIndex, toQueueIndex);
    }
    setDrag(null);
  }

  return (
    <>
      <p className="px-5 pt-3 text-[11px] font-medium uppercase tracking-[0.04em] text-t3">{upNextLabel}</p>

      {upNext.length === 0 ? (
        <p className="px-5 py-3 text-sm text-t3">Queue is empty.</p>
      ) : (
        <ul className={`px-3 py-1 ${drag ? "select-none" : ""}`}>
          {upNext.map((item, displayIndex) => {
            const { track, queueIndex, isLoop } = item;
            const isDragged = drag?.fromQueueIndex === queueIndex;

            // Rows between the dragged item's original slot and the pointer's current slot slide
            // out of the way by one row height, so the list previews the drop before it happens.
            let offsetY = 0;
            if (drag && !isDragged) {
              const target = targetDisplayIndex(drag);
              if (target > drag.startDisplayIndex && displayIndex > drag.startDisplayIndex && displayIndex <= target) {
                offsetY = -drag.rowHeight;
              } else if (target < drag.startDisplayIndex && displayIndex >= target && displayIndex < drag.startDisplayIndex) {
                offsetY = drag.rowHeight;
              }
            }

            const transform = isDragged
              ? `translateY(${drag.currentY - drag.startY}px) scale(1.015)`
              : offsetY
                ? `translateY(${offsetY}px)`
                : undefined;

            return (
              <li
                key={`${track.id}-${queueIndex}-${isLoop ? "loop" : "q"}`}
                style={{
                  transform,
                  transition: isDragged ? "none" : "transform 180ms ease",
                  zIndex: isDragged ? 10 : undefined,
                }}
                className={`group relative flex items-center gap-2.5 rounded-lg px-2 py-2.5 ${
                  isDragged ? "bg-surf-2 shadow-[var(--lf-shadow)]" : "hover:bg-surf-2"
                }`}
              >
                {canReorder ? (
                  <span
                    onPointerDown={(e) => handlePointerDown(e, displayIndex, queueIndex)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={(e) => handlePointerEnd(e, true)}
                    onPointerCancel={(e) => handlePointerEnd(e, false)}
                    role="button"
                    aria-label={`Drag to reorder ${track.title ?? "Untitled"}`}
                    className={`touch-none text-t3 ${isDragged ? "cursor-grabbing text-t1" : "cursor-grab"}`}
                  >
                    <DragHandleIcon />
                  </span>
                ) : null}
                <button type="button" onClick={() => playFromQueue(queueIndex)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm text-t1">{track.title ?? "Untitled"}</p>
                  <p className="truncate font-mono text-xs text-t3">{track.artistName ?? "Unknown artist"}</p>
                </button>
                <span className="shrink-0 font-mono text-xs text-t3">{formatDuration(track.durationSeconds)}</span>
                {isLoop ? null : (
                  <button
                    type="button"
                    onClick={() => removeFromQueue(queueIndex)}
                    aria-label="Remove from queue"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-t3 opacity-0 hover:bg-surf hover:text-err group-hover:opacity-100"
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function DragHandleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="8" cy="6" r="1.5" />
      <circle cx="16" cy="6" r="1.5" />
      <circle cx="8" cy="12" r="1.5" />
      <circle cx="16" cy="12" r="1.5" />
      <circle cx="8" cy="18" r="1.5" />
      <circle cx="16" cy="18" r="1.5" />
    </svg>
  );
}
