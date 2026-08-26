"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TrackSummary } from "@/lib/api-client";
import { deleteTrack } from "@/lib/api/tracksClient";
import { invalidateLibraryQueries } from "@/lib/query/invalidateLibrary";
import { usePlayerStore } from "@/lib/store/player";
import { useTagEditorStore } from "@/lib/store/tagEditor";
import { ConfirmDialog } from "@/components/shell/ConfirmDialog";
import { DEFAULT_TRASH_GRACE_DAYS } from "@/lib/library/trashConfig";

export function TrackRowActions({ track, alwaysVisible }: { track: TrackSummary; alwaysVisible?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const openTagEditor = useTagEditorStore((s) => s.open);
  const removeTrackById = usePlayerStore((s) => s.removeTrackById);
  const queryClient = useQueryClient();

  const removeMutation = useMutation({
    mutationFn: async () => {
      removeTrackById(track.id);
      await new Promise((resolve) => setTimeout(resolve, 80));
      await deleteTrack(track.id);
    },
    onSuccess: () => {
      setConfirmOpen(false);
      invalidateLibraryQueries(queryClient);
    },
  });

  function handleEditTags() {
    setMenuOpen(false);
    openTagEditor(track.id);
  }

  function handleRemoveFromLibrary() {
    setMenuOpen(false);
    setConfirmOpen(true);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((open) => !open);
        }}
        aria-label={`Actions for ${track.title ?? "Untitled"}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="Track actions"
        className={`rounded-md p-1 text-t3 hover:bg-surf hover:text-t1 focus:opacity-100 ${
          alwaysVisible ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <MoreIcon />
      </button>

      {menuOpen ? (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
            }}
          />
          <div
            role="menu"
            className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-xl border border-line bg-surf py-1 shadow-[var(--lf-shadow)]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={handleEditTags}
              className="flex w-full items-center px-3 py-2 text-left text-sm text-t1 hover:bg-surf-2"
            >
              Edit tags
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={handleRemoveFromLibrary}
              className="flex w-full items-center px-3 py-2 text-left text-sm text-err hover:bg-surf-2"
            >
              Remove from library
            </button>
          </div>
        </>
      ) : null}

      {confirmOpen ? (
        <ConfirmDialog
          title="Remove from library"
          message={`“${track.title ?? "Untitled"}” will move to Trash. You can restore it for ${DEFAULT_TRASH_GRACE_DAYS} days.`}
          confirmLabel="Remove from library"
          danger
          isPending={removeMutation.isPending}
          onConfirm={() => removeMutation.mutate()}
          onClose={() => setConfirmOpen(false)}
        />
      ) : null}

      {removeMutation.isError ? (
        <p className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-err bg-surf px-2 py-1.5 text-xs text-err">
          {(removeMutation.error as Error).message}
        </p>
      ) : null}
    </div>
  );
}

function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}
