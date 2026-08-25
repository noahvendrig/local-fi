"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { withAuthQuery } from "@/lib/api/http";
import { updateTrack, uploadAlbumCover, uploadTrackCover, type TrackTagPatch } from "@/lib/api/tracksClient";
import { invalidateLibraryQueries } from "@/lib/query/invalidateLibrary";
import { usePlayerStore } from "@/lib/store/player";
import { AlbumPlaceholderIcon } from "@/components/shell/PlayerIcons";

interface TagEditorValues {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  albumArtist?: string | null;
  trackNumber?: number | null;
  discNumber?: number | null;
  year?: number | null;
  genre?: string | null;
}

interface TagEditorModalProps {
  title: string;
  /** "track" edits one track's full field set; "album" bulk-applies album/albumArtist/year
   *  across every track in `trackIds` — renaming the album this way regroups all of them under
   *  the (upserted) renamed album rather than orphaning a duplicate (ARCHITECTURE.md §5/M9). */
  mode: "track" | "album";
  trackIds: number[];
  albumId?: number;
  initialValues: TagEditorValues;
  coverArtUrl?: string | null;
  /** Shown when some or all of the files cannot store an embedded picture. */
  coverEmbedWarning?: string | null;
  onClose: () => void;
}

type FieldDef = { key: keyof TagEditorValues; label: string; type: "text" | "number"; wide?: boolean };

const TRACK_FIELDS: FieldDef[] = [
  { key: "title", label: "Title", type: "text", wide: true },
  { key: "artist", label: "Artist", type: "text" },
  { key: "album", label: "Album", type: "text" },
  { key: "albumArtist", label: "Album Artist", type: "text" },
  { key: "genre", label: "Genre", type: "text" },
  { key: "trackNumber", label: "Track #", type: "number" },
  { key: "discNumber", label: "Disc #", type: "number" },
  { key: "year", label: "Year", type: "number" },
];

const ALBUM_FIELDS: FieldDef[] = [
  { key: "album", label: "Album title", type: "text", wide: true },
  { key: "albumArtist", label: "Album Artist", type: "text" },
  { key: "year", label: "Year", type: "number" },
];

const COVER_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif";

// M9: live tag editor — save writes to the physical file first (node-taglib-sharp), then the
// DB, then re-upserts artist/album (ARCHITECTURE.md §5). Cover art is written into the file
// when the format can hold a picture; otherwise it is stored as a library sidecar only.
export function TagEditorModal({
  title,
  mode,
  trackIds,
  albumId,
  initialValues,
  coverArtUrl,
  coverEmbedWarning,
  onClose,
}: TagEditorModalProps) {
  const fields = mode === "track" ? TRACK_FIELDS : ALBUM_FIELDS;
  const [values, setValues] = useState<TagEditorValues>(initialValues);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const updateTrackCover = usePlayerStore((s) => s.updateTrackCover);

  useEffect(() => {
    return () => {
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    };
  }, [coverPreviewUrl]);

  function handleCoverChange(file: File | null) {
    setCoverPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
    setCoverFile(file);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const patch: Record<string, string | number | null> = {};
      for (const field of fields) {
        const raw = values[field.key];
        if (field.type === "number") {
          patch[field.key] = raw === "" || raw == null ? null : Number(raw);
        } else {
          const str = typeof raw === "string" ? raw.trim() : "";
          patch[field.key] = field.key === "title" || field.key === "artist" ? str : str === "" ? null : str;
        }
      }
      if (mode === "track") {
        await updateTrack(trackIds[0], patch as TrackTagPatch);
      } else {
        await Promise.all(trackIds.map((id) => updateTrack(id, patch as TrackTagPatch)));
      }
      if (coverFile) {
        if (mode === "album" && albumId != null) {
          await uploadAlbumCover(albumId, coverFile);
        } else {
          await Promise.all(trackIds.map((id) => uploadTrackCover(id, coverFile)));
        }
      }
    },
    onSuccess: () => {
      invalidateLibraryQueries(queryClient);
      const bust = Date.now();
      for (const id of trackIds) {
        updateTrackCover(id, `/api/v1/tracks/${id}/cover?v=${bust}`);
      }
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to save tags."),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "track" && !String(values.title ?? "").trim()) return setError("Title is required.");
    if (mode === "track" && !String(values.artist ?? "").trim()) return setError("Artist is required.");
    if (mode === "album" && !String(values.album ?? "").trim()) return setError("Album title is required.");
    mutation.mutate();
  }

  const displayedCover = coverPreviewUrl ?? (coverArtUrl ? withAuthQuery(coverArtUrl) : null);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ backgroundColor: "var(--lf-glass, rgba(18,16,22,.6))" }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-3xl border border-line bg-surf p-6 shadow-[var(--lf-shadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-t1">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-t3 hover:bg-surf-2 hover:text-t1"
          >
            ×
          </button>
        </div>

        {mode === "album" && (
          <p className="mt-1 text-xs text-t3">
            Applies to all {trackIds.length} track{trackIds.length === 1 ? "" : "s"} in this album.
          </p>
        )}

        <div className="mt-4 flex items-start gap-3">
          <div className="lf-hatch h-20 w-20 shrink-0 overflow-hidden rounded-xl">
            {displayedCover ? (
              // eslint-disable-next-line @next/next/no-img-element -- local-only images
              <img src={displayedCover} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-t3" aria-hidden>
                <AlbumPlaceholderIcon />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <input
              ref={fileInputRef}
              type="file"
              accept={COVER_ACCEPT}
              className="sr-only"
              onChange={(e) => handleCoverChange(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label={coverFile || coverArtUrl ? "Replace cover art" : "Add cover art"}
              className="rounded-lg border border-line px-3 py-1.5 text-sm text-t1 hover:bg-surf-2"
            >
              {coverFile || coverArtUrl ? "Replace cover" : "Add cover"}
            </button>
            {coverFile ? (
              <button
                type="button"
                onClick={() => {
                  handleCoverChange(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="ml-2 text-xs text-t3 hover:text-t1"
              >
                Clear
              </button>
            ) : null}
            <p className="mt-1.5 text-xs text-t3">JPEG, PNG, WebP, or GIF. Written into the audio file when the format allows it.</p>
            {coverEmbedWarning ? <p className="mt-1 text-xs text-warn">{coverEmbedWarning}</p> : null}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {fields.map((field) => (
            <label key={field.key} className={`flex flex-col gap-1 text-xs text-t2 ${field.wide ? "col-span-2" : ""}`}>
              {field.label}
              <input
                type={field.type}
                value={values[field.key] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    [field.key]: field.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value,
                  }))
                }
                className="rounded-lg border border-line bg-surf-2 px-2 py-1.5 text-sm text-t1 focus:border-acc focus:outline-none"
              />
            </label>
          ))}
        </div>

        {error && <p className="mt-3 text-xs text-err">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-line px-3 py-1.5 text-sm text-t1 hover:bg-surf-2">
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-lg bg-acc px-3 py-1.5 text-sm font-medium text-on-acc hover:bg-acc-2 disabled:opacity-50"
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
