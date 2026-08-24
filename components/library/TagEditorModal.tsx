"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateTrack, type TrackTagPatch } from "@/lib/api/tracksClient";

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
  initialValues: TagEditorValues;
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

// M9: live tag editor — save writes to the physical file first (node-taglib-sharp), then the
// DB, then re-upserts artist/album (ARCHITECTURE.md §5). Same dialog shell as before; the
// fields are no longer read-only.
export function TagEditorModal({ title, mode, trackIds, initialValues, onClose }: TagEditorModalProps) {
  const fields = mode === "track" ? TRACK_FIELDS : ALBUM_FIELDS;
  const [values, setValues] = useState<TagEditorValues>(initialValues);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tracks"] });
      queryClient.invalidateQueries({ queryKey: ["albums"] });
      queryClient.invalidateQueries({ queryKey: ["artists"] });
      queryClient.invalidateQueries({ queryKey: ["album"] });
      queryClient.invalidateQueries({ queryKey: ["track"] });
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
