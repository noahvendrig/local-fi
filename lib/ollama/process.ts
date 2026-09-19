/** Base URL of the user's own local Ollama instance — never spawned/managed by this app (unlike
 *  lib/pythonBackend/process.ts's uvicorn child process), the user runs `ollama serve` themselves.
 *  Override with LOCALFI_OLLAMA_BASE_URL (same env-var-with-fallback convention as
 *  LOCALFI_PYTHON_BACKEND_PORT). */
export function getOllamaBaseUrl(): string {
  return process.env.LOCALFI_OLLAMA_BASE_URL || "http://127.0.0.1:11434";
}

/** Short-timeout reachability check, mirroring isPythonBackendAvailable(). Ollama's /api/tags
 *  (list installed models) doubles as a cheap health check — no dedicated /health endpoint. */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${getOllamaBaseUrl()}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}
