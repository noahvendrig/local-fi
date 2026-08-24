"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deletePlaylist, fetchPlaylist, updatePlaylist } from "@/lib/api/playlistsClient";
import { usePlayerStore } from "@/lib/store/player";
import { PlayIcon } from "@/components/shell/PlayerIcons";
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

  const playTrack = usePlayerStore((s) => s.playTrack);
  const enqueue = usePlayerStore((s) => s.enqueue);

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

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
      router.push("/crates");
    },
  });

  if (isLoading) return null;

  if (error || !playlist) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
        <h1 className="font-serif text-2xl text-t1">Crate not found</h1>
        <Link href="/crates" className="text-sm font-medium text-acc-text hover:underline">
          Back to crates
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-10 py-8">
      <Link href="/crates" className="w-fit text-xs font-medium text-t3 hover:text-t1">
        ← Crates
      </Link>

      <div className="mt-4 flex items-start justify-between gap-4">
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

        <button
          type="button"
          onClick={() => {
            if (confirm(`Delete "${playlist.name}"? This can't be undone.`)) deleteMutation.mutate();
          }}
          className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-t2 hover:border-err hover:text-err"
        >
          Delete crate
        </button>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => playlist.tracks.length > 0 && playTrack(playlist.tracks[0], playlist.tracks)}
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
      </div>

      <div className="mt-8">
        {playlist.type === "manual" ? <ManualCrateTracklist playlist={playlist} /> : <SmartCrateBuilder playlist={playlist} />}
      </div>
    </div>
  );
}
