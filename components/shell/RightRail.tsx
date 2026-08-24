"use client";

import { useRef, useState } from "react";
import { withAuthQuery } from "@/lib/api/http";
import { formatDuration } from "@/lib/format/track";
import { usePlayerStore } from "@/lib/store/player";

// 360px right-rail overlay slot — position: fixed, not a flex sibling, so it never
// reflows main content (§9). Hosts the Queue drawer: Now Playing summary + a
// reorderable Up Next list (ARCHITECTURE.md M5).
export function RightRail() {
  const isOpen = usePlayerStore((s) => s.isQueueOpen);
  const closeQueue = usePlayerStore((s) => s.closeQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const playFromQueue = usePlayerStore((s) => s.playFromQueue);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const reorderQueue = usePlayerStore((s) => s.reorderQueue);

  const upNext = queue.slice(currentIndex + 1);
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  return (
    <aside
      aria-hidden={!isOpen}
      className={`fixed inset-y-0 right-0 z-20 flex w-[360px] flex-col border-l border-line bg-surf pb-[88px] shadow-[var(--lf-shadow)] transition-transform duration-200 ${
        isOpen ? "translate-x-0" : "pointer-events-none translate-x-full"
      }`}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">
        <span className="text-sm font-medium text-t1">Queue</span>
        <button
          type="button"
          onClick={closeQueue}
          aria-label="Close queue"
          className="flex h-6 w-6 items-center justify-center rounded-md text-t3 hover:bg-surf-2 hover:text-t1"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {currentTrack ? (
          <div className="border-b border-line px-5 py-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-t3">Now Playing</p>
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-surf-2">
                {currentTrack.coverArtUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- local-only images
                  <img src={withAuthQuery(currentTrack.coverArtUrl)} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0">
                <p className={`truncate text-sm font-medium ${isPlaying ? "text-playing" : "text-t1"}`}>
                  {currentTrack.title ?? "Untitled"}
                </p>
                <p className="truncate text-xs text-t2">{currentTrack.artistName ?? "Unknown artist"}</p>
              </div>
            </div>
          </div>
        ) : (
          <p className="px-5 py-6 text-center text-sm text-t3">Nothing playing.</p>
        )}

        <p className="px-5 pt-3 text-xs font-medium uppercase tracking-wide text-t3">
          Up Next{upNext.length > 0 ? ` (${upNext.length})` : ""}
        </p>

        {upNext.length === 0 ? (
          <p className="px-5 py-3 text-sm text-t3">Queue is empty.</p>
        ) : (
          <ul className="py-1">
            {upNext.map((track, i) => {
              const absoluteIndex = currentIndex + 1 + i;
              return (
                <li
                  key={`${track.id}-${absoluteIndex}`}
                  draggable
                  onDragStart={() => {
                    dragIndexRef.current = absoluteIndex;
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverIndex(absoluteIndex);
                  }}
                  onDragLeave={() => setDragOverIndex((cur) => (cur === absoluteIndex ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = dragIndexRef.current;
                    dragIndexRef.current = null;
                    setDragOverIndex(null);
                    if (from != null) reorderQueue(from, absoluteIndex);
                  }}
                  onDragEnd={() => {
                    dragIndexRef.current = null;
                    setDragOverIndex(null);
                  }}
                  className={`group flex items-center gap-2 px-5 py-2 hover:bg-surf-2 ${
                    dragOverIndex === absoluteIndex ? "bg-[var(--lf-tint)]" : ""
                  }`}
                >
                  <span className="cursor-grab text-t3" aria-hidden>
                    <DragHandleIcon />
                  </span>
                  <button type="button" onClick={() => playFromQueue(absoluteIndex)} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm text-t1">{track.title ?? "Untitled"}</p>
                    <p className="truncate text-xs text-t2">{track.artistName ?? "Unknown artist"}</p>
                  </button>
                  <span className="shrink-0 font-mono text-xs text-t3">{formatDuration(track.durationSeconds)}</span>
                  <button
                    type="button"
                    onClick={() => removeFromQueue(absoluteIndex)}
                    aria-label="Remove from queue"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-t3 opacity-0 hover:bg-surf hover:text-err group-hover:opacity-100"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
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
