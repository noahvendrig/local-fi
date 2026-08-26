"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { setLibraryRootSync } from "@/lib/api/libraryRootsClient";
import { deletePlaylist, downloadPlaylistExport, fetchPlaylist, updatePlaylist } from "@/lib/api/playlistsClient";
import { getOfflineCrate, getOfflineTrack } from "@/lib/offline/db";
import { offlineTrackToSummary } from "@/lib/offline/trackSummary";
import { usePlayerStore } from "@/lib/store/player";
import { DownloadIcon, PlayIcon } from "@/components/shell/PlayerIcons";
import { CrateCoverEditor } from "./CrateCoverEditor";
import { MobileOfflineButton } from "./MobileOfflineButton";
import { ManualCrateTracklist } from "./ManualCrateTracklist";
import { SmartCrateBuilder } from "./SmartCrateBuilder";

export function CrateDetailView({ playlistId }: { playlistId: number }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    data: playlist,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["playlist", playlistId],
    queryFn: () => fetchPlaylist(playlistId),
  });

  const playContext = usePlayerStore((s) => s.playContext);
  const enqueue = usePlayerStore((s) => s.enqueue);

  // Fallback for landing here (a bookmark, browser history) while offline: fetchPlaylist has no
  // offline path of its own (rename/delete/export/sync below it all assume a live server), but
  // if this crate was copied to the phone (mobile plan Phase C), it can at least still play.
  const offlineFallbackQuery = useQuery({
    queryKey: ["offline", "crate", "playable", playlistId],
    queryFn: async () => {
      const crate = await getOfflineCrate(playlistId);
      if (!crate) return null;
      const tracks = await Promise.all(crate.trackIds.map((id) => getOfflineTrack(id)));
      return { name: crate.name, tracks: tracks.filter((t) => t != null) };
    },
    enabled: isLoading === false && (error != null || playlist == null),
  });

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const renameMutation = useMutation({
    mutationFn: (name: string) => updatePlaylist(playlistId, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });
      setIsEditingName(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deletePlaylist(playlistId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      goBackToCrates();
    },
  });

  // Prefer returning to wherever the user came from (the mobile Library "Crates" segment
  // or the desktop /crates grid) over hardcoding /crates, which would bounce mobile users
  // into the desktop grid view. Falls back to /crates only when there's no in-app history
  // (e.g. a direct link).
  function goBackToCrates() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/crates");
    }
  }

  const syncMutation = useMutation({
    mutationFn: (sync: boolean) => setLibraryRootSync(playlist!.librarySync!.rootId, sync),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });
      queryClient.invalidateQueries({ queryKey: ["library-roots"] });
    },
  });

  if (isLoading) return null;

  if (error || !playlist) {
    const offlineCopy = offlineFallbackQuery.data;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <h1 className="font-serif text-2xl text-t1">{offlineCopy ? offlineCopy.name : "Crate not found"}</h1>
        {offlineCopy ? (
          <>
            <p className="max-w-xs text-sm text-t2">Can&rsquo;t reach the server right now, but this crate is available offline.</p>
            <button
              type="button"
              onClick={() => playContext(offlineCopy.tracks.map(offlineTrackToSummary))}
              className="lf-top mt-1 flex items-center gap-2 rounded-lg border border-acc bg-acc px-5 py-2.5 text-[13px] font-semibold text-on-acc hover:border-acc-2 hover:bg-acc-2"
            >
              <PlayIcon /> Play offline copy
            </button>
          </>
        ) : null}
        <Link href="/crates" className="text-sm font-medium text-acc-text hover:underline">
          Back to crates
        </Link>
      </div>
    );
  }

  const crateName = playlist.name;
  const hasExportableTracks = playlist.tracks.some((t) => !t.missing);

  async function handleExport() {
    setExportError(null);
    setIsExporting(true);
    try {
      await downloadPlaylistExport(playlistId, `${crateName}.zip`);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setExportError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-10 py-8">
      <button type="button" onClick={goBackToCrates} className="w-fit text-xs font-medium text-t3 hover:text-t1">
        ← Crates
      </button>

      <div className="mt-4 flex flex-col gap-8 sm:flex-row">
        <CrateCoverEditor playlistId={playlistId} coverArtUrl={playlist.coverArtUrl} />

        <div className="min-w-0 flex-1 pt-1.5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-t3">{playlist.type === "smart" ? "Smart crate" : "Crate"}</p>
              {isEditingName ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (nameDraft.trim()) renameMutation.mutate(nameDraft.trim());
                  }}
                  className="mt-1"
                >
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={() => setIsEditingName(false)}
                    className="rounded-md border border-line bg-surf px-2 py-1 font-serif text-2xl text-t1"
                  />
                </form>
              ) : (
                <h1
                  className="mt-1 w-fit cursor-text truncate font-serif text-[40px] font-medium leading-[1.1] text-t1"
                  onClick={() => {
                    setNameDraft(playlist.name);
                    setIsEditingName(true);
                  }}
                  title="Click to rename"
                >
                  {playlist.name}
                </h1>
              )}
              <p className="mt-2 font-mono text-xs text-t3">
                {playlist.tracks.length} track{playlist.tracks.length === 1 ? "" : "s"}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {playlist.librarySync ? (
                <button
                  type="button"
                  onClick={() => syncMutation.mutate(!playlist.librarySync!.syncToCrate)}
                  disabled={syncMutation.isPending}
                  title={
                    playlist.librarySync.syncToCrate
                      ? `Synced from "${playlist.librarySync.rootName}" — click to pause`
                      : `Sync paused for "${playlist.librarySync.rootName}" — click to resume`
                  }
                  className={`hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium disabled:opacity-50 md:flex ${
                    playlist.librarySync.syncToCrate
                      ? "border-acc text-acc hover:bg-[var(--lf-tint)]"
                      : "border-line text-t3 hover:border-acc hover:text-t1"
                  }`}
                >
                  <SyncIcon />
                  {syncMutation.isPending ? "…" : playlist.librarySync.syncToCrate ? "Synced" : "Sync paused"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete "${playlist.name}"? This can't be undone.`)) deleteMutation.mutate();
                }}
                className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-t2 hover:border-err hover:text-err"
              >
                Delete crate
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => playContext(playlist.tracks)}
              disabled={playlist.tracks.length === 0}
              className="lf-top flex items-center gap-2 rounded-lg border border-acc bg-acc px-5 py-2.5 text-[13px] font-semibold text-on-acc hover:border-acc-2 hover:bg-acc-2 disabled:opacity-50"
            >
              <PlayIcon /> Play
            </button>
            <button
              type="button"
              onClick={() => enqueue(playlist.tracks)}
              disabled={playlist.tracks.length === 0}
              className="rounded-lg border border-line px-4 py-2.5 text-[13px] font-medium text-t1 hover:border-acc hover:bg-surf-2 disabled:opacity-50"
            >
              Queue
            </button>
            <button
              type="button"
              onClick={() => {
                void handleExport();
              }}
              disabled={isExporting || !hasExportableTracks}
              aria-busy={isExporting}
              title="Download a zip folder of this crate's audio files"
              className="flex items-center gap-2 rounded-lg border border-line px-4 py-2.5 text-[13px] font-medium text-t1 hover:border-acc hover:bg-surf-2 disabled:opacity-50"
            >
              <DownloadIcon />
              {isExporting ? "Exporting…" : "Export zip"}
            </button>
            <Link
              href={`/crates/${playlistId}/dj`}
              className="flex items-center gap-2 rounded-lg border border-line px-4 py-2.5 text-[13px] font-medium text-t1 hover:border-acc hover:bg-surf-2"
            >
              DJ view
            </Link>
          </div>
          {exportError ? <p className="mt-2 text-xs text-err">{exportError}</p> : null}

          <div className="mt-3">
            <MobileOfflineButton crateId={playlistId} crateName={crateName} />
          </div>
        </div>
      </div>

      <div className="mt-8">
        {playlist.type === "manual" ? <ManualCrateTracklist playlist={playlist} /> : <SmartCrateBuilder playlist={playlist} />}
      </div>
    </div>
  );
}

function SyncIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" />
      <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}
