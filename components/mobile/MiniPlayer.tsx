"use client";

import { withAuthQuery } from "@/lib/api/http";
import { usePlayerStore } from "@/lib/store/player";
import { AlbumPlaceholderIcon, PauseIcon, PlayIcon } from "@/components/shell/PlayerIcons";

// Floating mini-player docked 92px above the bottom tab bar (design board 1c, m2 "Library
// grid" frame) — a lighter-weight sibling of TransportBar's footer, not a second engine:
// it only reads/dispatches usePlayerStore, the same store TransportBar's hooks already
// drive the real <audio> elements from.
export function MiniPlayer() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const openNowPlaying = usePlayerStore((s) => s.openNowPlaying);

  if (!currentTrack) return null;

  return (
    <div className="fixed inset-x-3 bottom-[92px] z-20 flex h-16 items-center gap-2.5 rounded-2xl border border-line bg-surf px-3 shadow-[var(--lf-shadow)] md:hidden">
      <button
        type="button"
        onClick={openNowPlaying}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        aria-label="Open Now Playing"
      >
        <div className="lf-hatch h-11 w-11 shrink-0 overflow-hidden rounded-[10px]">
          {currentTrack.coverArtUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local-only images
            <img src={withAuthQuery(currentTrack.coverArtUrl)} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-t3" aria-hidden>
              <AlbumPlaceholderIcon />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className={`truncate text-sm ${isPlaying ? "text-playing" : "text-t1"}`}>{currentTrack.title ?? "Untitled"}</p>
          <p className="truncate font-mono text-xs text-t3">{currentTrack.artistName ?? "Unknown artist"}</p>
        </div>
      </button>
      <button
        type="button"
        onClick={togglePlay}
        aria-label={isPlaying ? "Pause" : "Play"}
        className="flex h-9 w-9 shrink-0 items-center justify-center text-t1"
      >
        {isPlaying ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
      </button>
    </div>
  );
}
