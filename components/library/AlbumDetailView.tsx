"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchAlbum, type AlbumDetailTrack } from "@/lib/api-client";
import { withAuthQuery } from "@/lib/api/http";
import { formatDuration, formatRate } from "@/lib/format/track";
import { formatSupportsEmbeddedPictures } from "@/lib/tags/coverFormats";
import { usePlayerStore } from "@/lib/store/player";
import { useSettingsStore } from "@/lib/store/settings";
import { AlbumPlaceholderIcon, PlayIcon, PlayingIcon } from "@/components/shell/PlayerIcons";
import { TagEditorModal } from "./TagEditorModal";
import { TrackRowActions } from "./TrackRowActions";

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
  const playContext = usePlayerStore((s) => s.playContext);
  const enqueue = usePlayerStore((s) => s.enqueue);
  const showFormatBadges = useSettingsStore((s) => s.showFormatBadges);

  if (isLoading) return null;

  if (error || !album) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
        <h1 className="font-serif text-2xl text-t1">Album not found</h1>
        <Link href="/library" className="text-sm font-medium text-acc-text hover:underline">
          Back to library
        </Link>
      </div>
    );
  }

  const hasMultipleDiscs = album.tracks.some((t) => (t.discNumber ?? 1) !== 1);

  return (
    <div className="flex h-full flex-col overflow-y-auto px-10 py-8">
      <Link href="/library" className="w-fit text-xs font-medium text-t3 hover:text-t1">
        ← Library
      </Link>

      <div className="mt-4 flex flex-col gap-8 sm:flex-row">
        <div className="lf-hatch h-[260px] w-[260px] shrink-0 overflow-hidden rounded-[20px] shadow-[var(--lf-art-shadow)]">
          {album.coverArtUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local-only images
            <img src={withAuthQuery(album.coverArtUrl)} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-t3" aria-hidden>
              <AlbumPlaceholderIcon />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 pt-1.5">
          <p className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.04em] text-t3">
            {album.isCompilation ? "Compilation" : "Album"}
            {album.year ? ` · ${album.year}` : ""}
          </p>
          <h1 className="mb-2.5 font-serif text-[40px] font-medium leading-[1.1] text-t1" title={album.title}>
            {album.title}
          </h1>
          <p className="mb-4 text-sm leading-[1.5] text-t2">
            {album.artists.length > 0 ? (
              album.artists.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && ", "}
                  <Link href={`/artists/${a.id}`} className="hover:text-acc-text">
                    {a.name}
                  </Link>
                </span>
              ))
            ) : (
              <span>Unknown artist</span>
            )}
          </p>
          <p className="mb-6 flex flex-wrap gap-3.5 font-mono text-xs text-t3">
            <span>
              {album.tracks.length} track{album.tracks.length === 1 ? "" : "s"}
            </span>
            {showFormatBadges && album.tracks[0] ? (
              <span className="text-ok">
                {album.tracks[0].format.toUpperCase()}
                {album.tracks[0].lossless ? ` ${formatRate(album.tracks[0])}` : ""}
              </span>
            ) : null}
          </p>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => playContext(album.tracks)}
              disabled={album.tracks.length === 0}
              className="lf-top flex items-center gap-2 rounded-lg border border-acc bg-acc px-5 py-2.5 text-[13px] font-semibold text-on-acc hover:border-acc-2 hover:bg-acc-2 disabled:opacity-50"
            >
              <PlayIcon /> Play album
            </button>
            <button
              type="button"
              onClick={() => enqueue(album.tracks)}
              disabled={album.tracks.length === 0}
              className="rounded-lg border border-line px-4 py-2.5 text-[13px] font-medium text-t1 hover:border-acc hover:bg-surf-2 disabled:opacity-50"
            >
              Add to queue
            </button>
            <button
              type="button"
              onClick={() => setIsEditingTags(true)}
              className="rounded-lg border border-line px-4 py-2.5 text-[13px] font-medium text-t1 hover:border-acc hover:bg-surf-2"
            >
              Edit tags
            </button>
          </div>
        </div>
      </div>

      {album.tracks.length === 0 ? (
        <p className="mt-10 text-sm text-t3">No tracks in this album.</p>
      ) : (
        <div className="mt-6">
          {album.tracks.map((track) => {
              const isCurrent = track.id === currentTrackId;
              const num = hasMultipleDiscs
                ? `${track.discNumber ?? 1}.${(track.trackNumber ?? 0).toString().padStart(2, "0")}`
                : String(track.trackNumber ?? album.tracks.indexOf(track) + 1).padStart(2, "0");
              return (
                <div
                  key={track.id}
                  onClick={() => !track.missing && playTrack(track, album.tracks)}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && !track.missing) {
                      e.preventDefault();
                      playTrack(track, album.tracks);
                    }
                  }}
                  role="button"
                  tabIndex={track.missing ? -1 : 0}
                  aria-label={`Play ${track.title ?? "Untitled"}`}
                  className={`lf-track-row group grid grid-cols-[32px_1fr_120px_64px_32px] items-center gap-4 rounded-lg border border-transparent px-3 py-3 ${
                    track.missing ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:border-line hover:bg-surf-2"
                  } ${isCurrent ? "bg-[var(--lf-tint)]" : ""}`}
                  title={track.missing ? "File missing on disk" : undefined}
                >
                  <span className={`font-mono text-xs ${isCurrent ? "text-playing" : "text-t3"}`}>
                    {isCurrent && isPlaying ? <PlayingIcon /> : num}
                  </span>
                  <span className={`truncate text-sm ${isCurrent ? "text-playing" : "text-t1"}`}>
                    {track.title ?? "Untitled"}
                  </span>
                  <span className="font-mono text-xs text-t3">{formatRate(track)}</span>
                  <span className="text-right font-mono text-xs text-t2">{formatDuration(track.durationSeconds)}</span>
                  <TrackRowActions track={track} />
                </div>
              );
            })}
        </div>
      )}

      {isEditingTags && (
        <TagEditorModal
          title="Edit album tags"
          mode="album"
          albumId={album.id}
          trackIds={album.tracks.map((t) => t.id)}
          initialValues={{
            album: album.title,
            albumArtist: album.artists.map((a) => a.name).join(", "),
            year: album.year,
          }}
          coverArtUrl={album.coverArtUrl}
          coverEmbedWarning={albumCoverEmbedWarning(album.tracks)}
          onClose={() => setIsEditingTags(false)}
        />
      )}
    </div>
  );
}

function albumCoverEmbedWarning(tracks: AlbumDetailTrack[]): string | null {
  const skipped = tracks.filter((track) => !formatSupportsEmbeddedPictures(track.format));
  if (skipped.length === 0) return null;
  if (skipped.length === tracks.length) {
    return "These files can't store cover art in the file. The image will be kept in the library only.";
  }
  return `${skipped.length} track${skipped.length === 1 ? "" : "s"} can't store cover art in the file. Those will keep the image in the library only.`;
}
