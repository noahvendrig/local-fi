"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TrackSummary } from "@/lib/api-client";
import { addTrackToPlaylist, fetchPlaylists, fetchTrackCrateIds } from "@/lib/api/playlistsClient";
import { deleteTrack } from "@/lib/api/tracksClient";
import { invalidateLibraryQueries } from "@/lib/query/invalidateLibrary";
import { usePlayerStore } from "@/lib/store/player";
import { useTagEditorStore } from "@/lib/store/tagEditor";
import { ConfirmDialog } from "@/components/shell/ConfirmDialog";
import { NewCrateModal } from "@/components/crates/NewCrateModal";
import { DEFAULT_TRASH_GRACE_DAYS } from "@/lib/library/trashConfig";

export function TrackRowActions({ track, alwaysVisible }: { track: TrackSummary; alwaysVisible?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [view, setView] = useState<"menu" | "crates">("menu");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [newCrateOpen, setNewCrateOpen] = useState(false);
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

  function closeMenu() {
    setMenuOpen(false);
    setView("menu");
  }

  function handleEditTags() {
    closeMenu();
    openTagEditor(track.id);
  }

  function handleRemoveFromLibrary() {
    closeMenu();
    setConfirmOpen(true);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((open) => {
            const next = !open;
            if (!next) setView("menu");
            return next;
          });
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
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); closeMenu(); }} />
          <div
            role="menu"
            className="absolute right-0 top-full z-50 mt-1 min-w-[220px] rounded-xl border border-line bg-surf py-1 shadow-[var(--lf-shadow)]"
            onClick={(e) => e.stopPropagation()}
          >
            {view === "menu" ? (
              <>
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
                  onClick={() => setView("crates")}
                  className="flex w-full items-center px-3 py-2 text-left text-sm text-t1 hover:bg-surf-2"
                >
                  Add to crate
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleRemoveFromLibrary}
                  className="flex w-full items-center px-3 py-2 text-left text-sm text-err hover:bg-surf-2"
                >
                  Remove from library
                </button>
              </>
            ) : (
              <AddToCratePanel
                track={track}
                onBack={() => setView("menu")}
                onRequestNewCrate={() => {
                  closeMenu();
                  setNewCrateOpen(true);
                }}
              />
            )}
          </div>
        </>
      ) : null}

      {newCrateOpen ? <NewCrateModal onClose={() => setNewCrateOpen(false)} /> : null}

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

function AddToCratePanel({
  track,
  onBack,
  onRequestNewCrate,
}: {
  track: TrackSummary;
  onBack: () => void;
  onRequestNewCrate: () => void;
}) {
  const queryClient = useQueryClient();
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());

  const cratesQuery = useQuery({
    queryKey: ["playlists", "manual"],
    queryFn: () => fetchPlaylists({ type: "manual" }),
  });
  const membershipQuery = useQuery({
    queryKey: ["track", track.id, "crates"],
    queryFn: () => fetchTrackCrateIds(track.id),
  });

  const addMutation = useMutation({
    mutationFn: (crateId: number) => addTrackToPlaylist(crateId, track.id),
    onSuccess: (_entry, crateId) => {
      setAddedIds((prev) => new Set(prev).add(crateId));
      queryClient.invalidateQueries({ queryKey: ["playlist", crateId] });
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      queryClient.invalidateQueries({ queryKey: ["track", track.id, "crates"] });
    },
  });

  const crates = cratesQuery.data?.items ?? [];
  const existingIds = membershipQuery.data?.playlistIds ?? [];

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm text-t2 hover:bg-surf-2"
      >
        <BackIcon />
        Add to crate
      </button>
      <div className="max-h-56 overflow-y-auto border-t border-line py-1">
        {cratesQuery.isLoading ? (
          <p className="px-3 py-2 text-xs text-t3">Loading…</p>
        ) : crates.length === 0 ? (
          <p className="px-3 py-2 text-xs text-t3">No crates yet.</p>
        ) : (
          crates.map((crate) => {
            const inCrate = existingIds.includes(crate.id) || addedIds.has(crate.id);
            return (
              <label
                key={crate.id}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-t1 hover:bg-surf-2"
              >
                <input
                  type="checkbox"
                  checked={inCrate}
                  disabled={inCrate || addMutation.isPending}
                  onChange={() => addMutation.mutate(crate.id)}
                  className="h-3.5 w-3.5 shrink-0 rounded border-line accent-[var(--lf-acc)]"
                />
                <span className="truncate">{crate.name}</span>
              </label>
            );
          })
        )}
      </div>
      <button
        type="button"
        onClick={onRequestNewCrate}
        className="flex w-full items-center border-t border-line px-3 py-2 text-left text-sm text-t2 hover:bg-surf-2"
      >
        + New crate
      </button>
    </div>
  );
}

function BackIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
