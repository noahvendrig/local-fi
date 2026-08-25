"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PLAYLIST_COVER_ACCEPT,
  PLAYLIST_COVER_MAX_BYTES,
  removePlaylistCover,
  uploadPlaylistCover,
} from "@/lib/api/playlistsClient";
import { withAuthQuery } from "@/lib/api/http";

export function CrateCoverEditor({
  playlistId,
  coverArtUrl,
}: {
  playlistId: number;
  coverArtUrl: string | null;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function invalidateCovers() {
    queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });
    queryClient.invalidateQueries({ queryKey: ["playlists"] });
  }

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadPlaylistCover(playlistId, file),
    onSuccess: () => {
      setError(null);
      invalidateCovers();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Could not upload cover.");
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => removePlaylistCover(playlistId),
    onSuccess: () => {
      setError(null);
      invalidateCovers();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Could not remove cover.");
    },
  });

  const isPending = uploadMutation.isPending || removeMutation.isPending;

  function handleFile(file: File | undefined) {
    if (!file || isPending) return;
    if (file.size > PLAYLIST_COVER_MAX_BYTES) {
      setError("Cover image is too large (max 10 MB).");
      return;
    }
    uploadMutation.mutate(file);
  }

  return (
    <div className="group relative shrink-0">
      <input
        ref={inputRef}
        type="file"
        accept={PLAYLIST_COVER_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={isPending}
        aria-label={coverArtUrl ? "Change cover art" : "Add cover art"}
        title={coverArtUrl ? "Click to change cover art" : "Click to add cover art"}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          handleFile(e.dataTransfer.files[0]);
        }}
        aria-busy={isPending}
        className={`lf-hatch relative h-[260px] w-[260px] cursor-pointer overflow-hidden rounded-[20px] shadow-[var(--lf-art-shadow)] ${
          isDragging ? "ring-2 ring-acc" : ""
        } ${coverArtUrl ? "" : "transition-transform duration-200 hover:scale-[1.03] focus-visible:scale-[1.03]"} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {coverArtUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- local-only images
          <img src={withAuthQuery(coverArtUrl)} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center" aria-hidden>
            <CoverPlaceholderIcon />
            <span className="text-sm text-t3">Add cover</span>
          </div>
        )}
      </button>
      {coverArtUrl ? (
        <button
          type="button"
          disabled={isPending}
          onClick={() => removeMutation.mutate()}
          aria-label="Remove cover"
          title="Remove cover"
          className="absolute right-2.5 top-2.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-black/55 text-white opacity-0 transition-opacity duration-150 hover:bg-err group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <TrashIcon />
        </button>
      ) : null}
      {error ? <p className="mt-2 max-w-[260px] text-xs text-err">{error}</p> : null}
    </div>
  );
}

function CoverPlaceholderIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-t3">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}
