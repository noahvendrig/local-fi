"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchAlbum } from "@/lib/api-client";
import { withAuthQuery } from "@/lib/api/http";
import { formatDuration, formatRate } from "@/lib/format/track";
import { usePlayerStore } from "@/lib/store/player";
import { AlbumPlaceholderIcon, PlayIcon, PlayingIcon } from "@/components/shell/PlayerIcons";
import { FormatBadge } from "./FormatBadge";
import { TagEditorModal } from "./TagEditorModal";

export function AlbumDetailView({ albumId }: { albumId: number }) {
  const {
    data: album,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["album", albumId],
    queryFn: () => fetchAlbum(albumId),
  });

  const [isEditingTags, setIsEditingTags] = useState(false);
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const enqueue = usePlayerStore((s) => s.enqueue);

  if (isLoading) return null;

  if (error || !album) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
        <h1 className="font-serif text-2xl text-t1">Album not found</h1>
        <Link href="/" className="text-sm font-medium text-acc-text hover:underline">
          Back to library
        </Link>
      </div>
    );
  }

  const hasMultipleDiscs = album.tracks.some((t) => (t.discNumber ?? 1) !== 1);

  return (
    <div className="flex h-full flex-col overflow-y-auto px-8 py-8">
      <Link href="/" className="w-fit text-xs font-medium text-t3 hover:text-t1">
        ← Library
      </Link>

      <div className="mt-4 flex flex-col gap-6 sm:flex-row sm:items-end">
        <div className="h-48 w-48 shrink-0 overflow-hidden rounded-xl bg-surf-2 shadow-[var(--lf-shadow)]">
          {album.coverArtUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local-only images
            <img src={withAuthQuery(album.coverArtUrl)} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-t3" aria-hidden>
              <AlbumPlaceholderIcon />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-t3">{album.isCompilation ? "Compilation" : "Album"}</p>
          <h1 className="mt-1 truncate font-serif text-3xl text-t1" title={album.title}>
            {album.title}
          </h1>
          <p className="mt-2 text-sm text-t2">
            {album.artists.length > 0 ? (
              album.artists.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && ", "}
                  <Link href={`/artists/${a.id}`} className="hover:text-acc-text hover:underline">
                    {a.name}
                  </Link>
                </span>
              ))
            ) : (
              <span>Unknown artist</span>
            )}
            {album.year && <span className="text-t3"> · {album.year}</span>}
            <span className="text-t3">
              {" "}
              · {album.tracks.length} track{album.tracks.length === 1 ? "" : "s"}
            </span>
          </p>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => album.tracks.length > 0 && playTrack(album.tracks[0], album.tracks)}
              disabled={album.tracks.length === 0}
              className="flex items-center gap-2 rounded-full bg-acc px-4 py-2 text-sm font-medium text-[var(--lf-on-acc)] hover:bg-acc-2 disabled:opacity-50"
            >
              <PlayIcon /> Play
            </button>
            <button
              type="button"
              onClick={() => enqueue(album.tracks)}
              disabled={album.tracks.length === 0}
              className="rounded-full border border-line px-4 py-2 text-sm font-medium text-t1 hover:bg-surf-2 disabled:opacity-50"
            >
              Queue
            </button>
            <button
              type="button"
              onClick={() => setIsEditingTags(true)}
              className="rounded-full border border-line px-4 py-2 text-sm font-medium text-t1 hover:bg-surf-2"
            >
              Edit tags
            </button>
          </div>
        </div>
      </div>

      {album.tracks.length === 0 ? (
        <p className="mt-10 text-sm text-t3">No tracks in this album.</p>
      ) : (
        <table className="mt-8 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-t3">
              <th className="w-12 py-2 pr-2 font-normal">#</th>
              <th className="py-2 pr-4 font-normal">Title</th>
              <th className="w-20 py-2 pr-4 font-normal">Format</th>
              <th className="w-24 py-2 pr-4 font-normal">Rate</th>
              <th className="w-16 py-2 pr-2 text-right font-normal">Time</th>
            </tr>
          </thead>
          <tbody>
            {album.tracks.map((track) => {
              const isCurrent = track.id === currentTrackId;
              const num = hasMultipleDiscs
                ? `${track.discNumber ?? 1}.${(track.trackNumber ?? 0).toString().padStart(2, "0")}`
                : (track.trackNumber ?? "—");
              return (
                <tr
                  key={track.id}
                  onClick={() => !track.missing && playTrack(track, album.tracks)}
                  className={`border-b border-line last:border-b-0 hover:bg-surf-2 ${track.missing ? "cursor-not-allowed opacity-40" : "cursor-pointer"} ${isCurrent ? "bg-[var(--lf-tint)]" : ""}`}
                  title={track.missing ? "File missing on disk" : undefined}
                >
                  <td className="py-2 pr-2 font-mono text-xs text-t3">{isCurrent && isPlaying ? <PlayingIcon /> : num}</td>
                  <td className={`min-w-0 max-w-0 truncate py-2 pr-4 ${isCurrent ? "text-playing" : "text-t1"}`}>
                    {track.title ?? "Untitled"}
                    <span className="ml-2 truncate text-t3">{track.artistCredit}</span>
                  </td>
                  <td className="py-2 pr-4">
                    <FormatBadge format={track.format} lossless={track.lossless} />
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-t2">{formatRate(track)}</td>
                  <td className="py-2 pr-2 text-right font-mono text-xs text-t2">{formatDuration(track.durationSeconds)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {isEditingTags && (
        <TagEditorModal
          title="Edit album tags"
          mode="album"
          trackIds={album.tracks.map((t) => t.id)}
          initialValues={{
            album: album.title,
            albumArtist: album.artists.map((a) => a.name).join(", "),
            year: album.year,
          }}
          onClose={() => setIsEditingTags(false)}
        />
      )}
    </div>
  );
}
