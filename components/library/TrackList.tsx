"use client";

import Link from "next/link";
import { formatDuration, formatRate } from "@/lib/format/track";
import type { TrackSummary } from "@/lib/api-client";
import { usePlayerStore } from "@/lib/store/player";
import { useTagEditorStore } from "@/lib/store/tagEditor";
import { PlayingIcon } from "@/components/shell/PlayerIcons";
import { FormatBadge } from "./FormatBadge";

export function TrackList({ tracks }: { tracks: TrackSummary[] }) {
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const openTagEditor = useTagEditorStore((s) => s.open);

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-line text-left text-xs text-t3">
          <th className="w-10 py-2 pr-2 font-normal">#</th>
          <th className="py-2 pr-4 font-normal">Title</th>
          <th className="py-2 pr-4 font-normal">Album</th>
          <th className="w-20 py-2 pr-4 font-normal">Format</th>
          <th className="w-24 py-2 pr-4 font-normal">Rate</th>
          <th className="w-16 py-2 pr-2 text-right font-normal">Time</th>
          <th className="w-8 py-2 pr-2 font-normal" aria-hidden />
        </tr>
      </thead>
      <tbody>
        {tracks.map((track, i) => {
          const isCurrent = track.id === currentTrackId;
          return (
            <tr
              key={track.id}
              onClick={() => !track.missing && playTrack(track, tracks)}
              className={`group border-b border-line last:border-b-0 hover:bg-surf-2 ${track.missing ? "cursor-not-allowed opacity-40" : "cursor-pointer"} ${isCurrent ? "bg-[var(--lf-tint)]" : ""}`}
              title={track.missing ? "File missing on disk" : undefined}
            >
              <td className="py-2 pr-2 font-mono text-xs text-t3">{isCurrent && isPlaying ? <PlayingIcon /> : i + 1}</td>
              <td className={`min-w-0 max-w-0 truncate py-2 pr-4 ${isCurrent ? "text-playing" : "text-t1"}`}>
                {track.title ?? "Untitled"}
                {track.artistId ? (
                  <Link
                    href={`/artists/${track.artistId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="ml-2 truncate text-t3 hover:text-acc-text hover:underline"
                  >
                    {track.artistName}
                  </Link>
                ) : (
                  <span className="ml-2 truncate text-t3">{track.artistName}</span>
                )}
              </td>
              <td className="min-w-0 max-w-0 truncate py-2 pr-4 text-t2">
                {track.albumId ? (
                  <Link
                    href={`/albums/${track.albumId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="hover:text-acc-text hover:underline"
                  >
                    {track.albumTitle ?? "—"}
                  </Link>
                ) : (
                  (track.albumTitle ?? "—")
                )}
              </td>
              <td className="py-2 pr-4">
                <FormatBadge format={track.format} lossless={track.lossless} />
              </td>
              <td className="py-2 pr-4 font-mono text-xs text-t2">{formatRate(track)}</td>
              <td className="py-2 pr-2 text-right font-mono text-xs text-t2">{formatDuration(track.durationSeconds)}</td>
              <td className="py-2 pr-2 text-right">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openTagEditor(track.id);
                  }}
                  aria-label="Edit tags"
                  title="Edit tags"
                  className="rounded-md p-1 text-t3 opacity-0 hover:bg-surf hover:text-t1 group-hover:opacity-100 focus:opacity-100"
                >
                  <EditIcon />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
