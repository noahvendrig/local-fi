"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchOllamaStatus } from "@/lib/api/vibeClient";
import { useSettingsStore } from "@/lib/store/settings";

/** Local-LLM connection + model picker for the vibe-prompt features (prompt->crate, Vibe Radio) —
 *  modeled on SpotifySection's status-query/connect pattern. No base-URL field for v1: Ollama's
 *  address is env-var only (LOCALFI_OLLAMA_BASE_URL), same convention as the Python backend's port. */
export function OllamaSection() {
  const statusQuery = useQuery({ queryKey: ["ollama-status"], queryFn: fetchOllamaStatus, refetchInterval: 15_000 });
  const ollamaModel = useSettingsStore((s) => s.ollamaModel);
  const setOllamaModel = useSettingsStore((s) => s.setOllamaModel);

  const available = statusQuery.data?.available ?? false;
  const models = statusQuery.data?.models ?? [];

  return (
    <div className="lf-card mt-3 flex items-center justify-between gap-4 rounded-2xl px-5 py-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-t1">Local LLM (Ollama)</p>
        <p className="mt-0.5 text-sm text-t2">
          {available
            ? "Reachable — pick a model to power vibe-prompt crates and Vibe Radio."
            : "Run `ollama serve` locally to enable vibe-prompt crates and Vibe Radio."}
        </p>
      </div>
      {available ? (
        <select
          value={ollamaModel ?? ""}
          onChange={(e) => setOllamaModel(e.target.value || null)}
          disabled={models.length === 0}
          className="shrink-0 rounded-lg border border-line bg-surf-2 px-3 py-2 text-xs font-medium text-t1 disabled:opacity-50"
        >
          <option value="" disabled>
            {models.length === 0 ? "No models pulled" : "Choose a model…"}
          </option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      ) : (
        <span className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-medium text-t3">Unreachable</span>
      )}
    </div>
  );
}
