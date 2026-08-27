"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createPlaylist, type PlaylistType } from "@/lib/api/playlistsClient";
import { useHasCredentials } from "@/lib/api/http";
import { createLocalCrate } from "@/lib/offline/localCrates";

// The standalone PWA ships no /crates/[id] route — there's no crate-detail screen at all, so it
// can neither host the smart-rules builder nor navigate to a crate after creating it. There, a
// new crate is always manual and we just drop back to the list (it refreshes via the query
// invalidation below) rather than pushing to a route that would 404.
const STANDALONE = process.env.NEXT_PUBLIC_STANDALONE === "true";

export function NewCrateModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const hasCredentials = useHasCredentials();
  const [name, setName] = useState("");
  const [type, setType] = useState<PlaylistType>("manual");

  // With no PC to POST to, the standalone build makes the crate in IndexedDB instead — a
  // phone-only crate the user edits entirely client-side (lib/offline/localCrates.ts).
  const localMode = STANDALONE && !hasCredentials;

  const createMutation = useMutation({
    mutationFn: async () => {
      if (localMode) {
        await createLocalCrate(name.trim());
        return;
      }
      const playlist = await createPlaylist({
        name: name.trim(),
        type,
        rulesJson: type === "smart" ? { match: "all", conditions: [] } : undefined,
      });
      if (!STANDALONE) router.push(`/crates/${playlist.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      queryClient.invalidateQueries({ queryKey: ["offline", "crates"] });
      onClose();
    },
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New crate"
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ backgroundColor: "var(--lf-glass, rgba(18,16,22,.6))" }}
      onClick={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) createMutation.mutate();
        }}
        className="w-full max-w-sm rounded-3xl border border-line bg-surf p-6 shadow-[var(--lf-shadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-t1">New crate</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-t3 hover:bg-surf-2 hover:text-t1"
          >
            ×
          </button>
        </div>

        <label className="mt-4 flex flex-col gap-1 text-xs text-t2">
          Name
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-line bg-surf-2 px-2 py-1.5 text-sm text-t1"
          />
        </label>

        {!STANDALONE && (
          <div className="mt-4 flex gap-2">
            <TypeOption
              label="Manual"
              description="Pick tracks yourself, drag to reorder."
              value="manual"
              selected={type === "manual"}
              onSelect={setType}
            />
            <TypeOption
              label="Smart"
              description="Auto-populated from rules."
              value="smart"
              selected={type === "smart"}
              onSelect={setType}
            />
          </div>
        )}

        {localMode ? (
          <p className="mt-3 text-xs text-t3">
            This crate stays on your phone. Pair with a computer later to sync crates from it.
          </p>
        ) : null}

        {createMutation.isError ? (
          <p className="mt-4 text-xs text-err">{(createMutation.error as Error).message}</p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-line px-3 py-1.5 text-sm text-t1 hover:bg-surf-2">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || createMutation.isPending}
            className="rounded-lg bg-acc px-3 py-1.5 text-sm font-medium text-on-acc hover:bg-acc-2 disabled:opacity-50"
          >
            {createMutation.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

function TypeOption({
  label,
  description,
  value,
  selected,
  onSelect,
}: {
  label: string;
  description: string;
  value: PlaylistType;
  selected: boolean;
  onSelect: (v: PlaylistType) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={`flex-1 rounded-lg border px-3 py-2 text-left ${selected ? "border-acc bg-[var(--lf-tint)]" : "border-line hover:bg-surf-2"}`}
    >
      <p className="text-sm font-medium text-t1">{label}</p>
      <p className="mt-0.5 text-xs text-t3">{description}</p>
    </button>
  );
}
