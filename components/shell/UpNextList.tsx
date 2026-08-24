"use client";

import { useRef, useState } from "react";
import { formatDuration } from "@/lib/format/track";
import { getUpNextItems } from "@/lib/player/upNext";
import { usePlayerStore } from "@/lib/store/player";

// Shared upcoming-queue list used by the right-rail drawer and the Now Playing overlay.
export function UpNextList() {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const playFromQueue = usePlayerStore((s) => s.playFromQueue);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const reorderQueue = usePlayerStore((s) => s.reorderQueue);

  const upNext = getUpNextItems(queue, currentIndex, repeatMode);
  const canReorder = upNext.length > 1 && upNext.every((item) => !item.isLoop);
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const upNextLabel =
    repeatMode === "one"
      ? "Up next · looping"
      : canReorder
        ? `Up next · drag to reorder${upNext.length > 0 ? ` · ${upNext.length}` : ""}`
        : `Up next${upNext.length > 0 ? ` · ${upNext.length}` : ""}`;

  return (
    <>
      <p className="px-5 pt-3 text-[11px] font-medium uppercase tracking-[0.04em] text-t3">{upNextLabel}</p>

      {upNext.length === 0 ? (
        <p className="px-5 py-3 text-sm text-t3">Queue is empty.</p>
      ) : (
        <ul className="px-3 py-1">
          {upNext.map((item) => {
            const { track, queueIndex, isLoop } = item;
            return (
              <li
                key={`${track.id}-${queueIndex}-${isLoop ? "loop" : "q"}`}
                draggable={canReorder}
                onDragStart={() => {
                  if (!canReorder) return;
                  dragIndexRef.current = queueIndex;
                }}
                onDragOver={(e) => {
                  if (!canReorder) return;
                  e.preventDefault();
                  setDragOverIndex(queueIndex);
                }}
                onDragLeave={() => setDragOverIndex((cur) => (cur === queueIndex ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = dragIndexRef.current;
                  dragIndexRef.current = null;
                  setDragOverIndex(null);
                  if (from != null) reorderQueue(from, queueIndex);
                }}
                onDragEnd={() => {
                  dragIndexRef.current = null;
                  setDragOverIndex(null);
                }}
                className={`group flex items-center gap-2.5 rounded-lg px-2 py-2.5 hover:bg-surf-2 ${
                  dragOverIndex === queueIndex ? "bg-[var(--lf-tint)]" : ""
                }`}
              >
                {canReorder ? (
                  <span className="cursor-grab text-t3" aria-hidden>
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
