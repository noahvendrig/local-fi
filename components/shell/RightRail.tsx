"use client";

import { withAuthQuery } from "@/lib/api/http";
import { usePlayerStore } from "@/lib/store/player";
import { UpNextList } from "./UpNextList";

// 360px right-rail overlay slot — position: fixed, not a flex sibling, so it never
// reflows main content (§9). Hosts the Queue drawer: Now Playing summary + a
// reorderable Up Next list (ARCHITECTURE.md M5). Hidden while the full-screen
// Now Playing overlay is open — that view hosts the same list so it stays visible.
export function RightRail() {
  const isQueueOpen = usePlayerStore((s) => s.isQueueOpen);
  const isNowPlayingOpen = usePlayerStore((s) => s.isNowPlayingOpen);
  const closeQueue = usePlayerStore((s) => s.closeQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const isOpen = isQueueOpen && !isNowPlayingOpen;

  return (
    <aside
      aria-hidden={!isOpen}
      className={`fixed inset-y-0 right-0 z-20 hidden w-[360px] flex-col border-l border-line bg-surf pb-[88px] transition-transform duration-200 md:flex ${
        isOpen ? "translate-x-0" : "pointer-events-none translate-x-full"
      }`}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-4">
        <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-t1">Queue</span>
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
          <div className="px-3 py-3">
            <p className="mb-2.5 px-2 text-[11px] font-medium uppercase tracking-[0.04em] text-t3">Now playing</p>
            <div className="flex items-center gap-3 rounded-lg bg-surf-2 p-2">
              <div className="lf-hatch h-12 w-12 shrink-0 overflow-hidden rounded-[10px]">
                {currentTrack.coverArtUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- local-only images
                  <img src={withAuthQuery(currentTrack.coverArtUrl)} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0">
                <p className={`truncate text-sm ${isPlaying ? "text-playing" : "text-t1"}`}>
                  {currentTrack.title ?? "Untitled"}
                </p>
                <p className="truncate font-mono text-xs text-t3">{currentTrack.artistName ?? "Unknown artist"}</p>
              </div>
            </div>
          </div>
        ) : (
          <p className="px-5 py-6 text-center text-sm text-t3">Nothing playing.</p>
        )}

        <UpNextList />
      </div>
    </aside>
  );
}
