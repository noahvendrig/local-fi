import type { TrackSummary } from "@/lib/api-client";
import { apiUrl, authHeaders } from "./http";

export interface OllamaStatus {
  available: boolean;
  models: string[];
}

/** Calls app/api/v1/ollama/status/route.ts — reachability + installed models for Settings'
 *  Ollama section and for gating the vibe features' UI. */
export async function fetchOllamaStatus(): Promise<OllamaStatus> {
  const res = await fetch(apiUrl("/api/v1/ollama/status"), { headers: authHeaders() });
  if (!res.ok) return { available: false, models: [] };
  return res.json();
}

export class VibeSelectError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "VibeSelectError";
    this.code = code;
  }
}

/** Calls app/api/v1/vibe/select/route.ts — the shared core behind both prompt->crate and Vibe
 *  Radio: turns a free-text prompt into a real, ordered track list from the library. Throws
 *  VibeSelectError (not a best-effort null-return like smart-suggest) since this is an explicit
 *  opt-in action the caller should surface failures for. */
export async function selectVibeTracks(
  prompt: string,
  opts: { model: string; excludeIds?: number[]; limit?: number }
): Promise<{ tracks: TrackSummary[]; usedFallback: boolean }> {
  const res = await fetch(apiUrl("/api/v1/vibe/select"), {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, model: opts.model, excludeIds: opts.excludeIds, limit: opts.limit }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new VibeSelectError(body?.error?.code ?? "unknown", body?.error?.message ?? `Request failed (${res.status})`);
  }
  return res.json();
}
