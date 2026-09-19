"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bulkAddTracksToPlaylist, createPlaylist } from "@/lib/api/playlistsClient";
import { fetchOllamaStatus, selectVibeTracks, VibeSelectError } from "@/lib/api/vibeClient";
import type { TrackSummary } from "@/lib/api-client";
import { useSettingsStore } from "@/lib/store/settings";

const PREVIEW_LIMIT = 30;

/** "From a prompt" flow for New Crate — a two-step preview-then-commit UX (modeled on
 *  SmartCrateBuilder's debounced preview) since a vibe-prompt crate needs the user to see and
 *  prune the LLM's picks before they're real playlist rows, unlike the single-field blank/Spotify
 *  paths NewCrateModal otherwise handles. Renders in place of NewCrateModal's <form> for this
 *  source, so it owns its own submit/cancel buttons. */
export function PromptCratePanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const ollamaModel = useSettingsStore((s) => s.ollamaModel);
  const statusQuery = useQuery({ queryKey: ["ollama-status"], queryFn: fetchOllamaStatus });
  const models = statusQuery.data?.models ?? [];

  // Per-panel override for A/B testing models without changing the Settings default -- defaults
  // to whatever's picked there, but switching here doesn't persist.
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const activeModel = modelOverride ?? ollamaModel;

  const [prompt, setPrompt] = useState("");
  const [tracks, setTracks] = useState<TrackSummary[] | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [usedFallback, setUsedFallback] = useState(false);

  const previewMutation = useMutation({
    // applyTaste: false -- prompt->crate stays purely theme-driven, unlike Vibe Radio, which
    // wants results biased by the user's personal taste model (see vibeSelector.ts).
    mutationFn: () => selectVibeTracks(prompt.trim(), { model: activeModel!, limit: PREVIEW_LIMIT, applyTaste: false }),
    onSuccess: (result) => {
      setTracks(result.tracks);
      setCheckedIds(new Set(result.tracks.map((t) => t.id)));
      setUsedFallback(result.usedFallback);
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const selected = (tracks ?? []).filter((t) => checkedIds.has(t.id)).map((t) => t.id);
      const playlist = await createPlaylist({ name: prompt.trim().slice(0, 80), type: "manual" });
      await bulkAddTracksToPlaylist(playlist.id, selected);
      return playlist;
    },
    onSuccess: (playlist) => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      router.push(`/crates/${playlist.id}`);
      onClose();
    },
  });

  const toggleChecked = (id: number) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const previewError =
    previewMutation.error instanceof VibeSelectError ? previewMutation.error.message : previewMutation.isError ? "Something went wrong." : null;
  const createError =
    createMutation.error instanceof VibeSelectError ? createMutation.error.message : createMutation.isError ? "Something went wrong." : null;

  return (
    <div className="w-full max-w-lg rounded-3xl border border-line bg-surf p-6 shadow-[var(--lf-shadow)]" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-t1">New crate from a prompt</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-7 w-7 items-center justify-center rounded-md text-t3 hover:bg-surf-2 hover:text-t1"
        >
          ×
        </button>
      </div>

      {!activeModel ? (
        <p className="mt-4 text-xs text-t2">
          Choose a local LLM model in{" "}
          <Link href="/settings" className="text-acc-text hover:underline" onClick={onClose}>
            Settings
          </Link>{" "}
          first.
        </p>
      ) : (
        <>
          {models.length > 1 ? (
            <label className="mt-4 flex items-center gap-2 text-xs text-t2">
              Model (testing)
              <select
                value={activeModel}
                onChange={(e) => {
                  // Clear a stale preview so a leftover list from a different model doesn't get
                  // mistaken for the newly-selected one's output.
                  setModelOverride(e.target.value);
                  setTracks(null);
                  setCheckedIds(new Set());
                }}
                className="rounded-md border border-line bg-surf-2 px-2 py-1 text-xs text-t1"
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="mt-4 flex flex-col gap-1 text-xs text-t2">
            Describe the vibe
            <textarea
              autoFocus
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="songs for a rainy 2am drive"
              className="resize-none rounded-md border border-line bg-surf-2 px-2 py-1.5 text-sm text-t1 placeholder:text-t3"
            />
          </label>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => previewMutation.mutate()}
              disabled={!prompt.trim() || previewMutation.isPending}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-t1 hover:border-acc hover:bg-surf-2 disabled:opacity-50"
            >
              {previewMutation.isPending ? "Thinking…" : tracks ? "Regenerate" : "Preview"}
            </button>
            {tracks ? <span className="text-xs text-t3">{checkedIds.size} of {tracks.length} selected</span> : null}
          </div>

          {previewError ? <p className="mt-3 text-xs text-err">{previewError}</p> : null}

          {tracks ? (
            tracks.length === 0 ? (
              <p className="mt-3 text-xs text-t3">Nothing in your library matches yet — try a different description.</p>
            ) : (
              <>
                {usedFallback ? (
                  <p className="mt-3 text-xs text-t3">Picked using basic matching — the LLM&rsquo;s ranking wasn&rsquo;t available for this preview.</p>
                ) : null}
                <ul className="mt-3 max-h-[45vh] space-y-0.5 overflow-y-auto rounded-lg border border-line p-1">
                  {tracks.map((t) => (
                    <li key={t.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surf-2">
                        <input type="checkbox" checked={checkedIds.has(t.id)} onChange={() => toggleChecked(t.id)} className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-sm text-t1">{t.title ?? "Untitled"}</span>
                        <span className="shrink-0 truncate text-xs text-t3">{t.artistName ?? "Unknown"}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )
          ) : null}

          {createError ? <p className="mt-3 text-xs text-err">{createError}</p> : null}
        </>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md border border-line px-3 py-1.5 text-sm text-t1 hover:bg-surf-2">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={!tracks || checkedIds.size === 0 || createMutation.isPending}
          className="rounded-lg bg-acc px-3 py-1.5 text-sm font-medium text-on-acc hover:bg-acc-2 disabled:opacity-50"
        >
          {createMutation.isPending ? "Creating…" : "Create crate"}
        </button>
      </div>
    </div>
  );
}
