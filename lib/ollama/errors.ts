/** Ollama unreachable, or the request itself failed (network error, non-2xx, timeout). Callers
 *  should surface this as a clear "can't reach Ollama" state, not retry silently — this is an
 *  explicit opt-in feature, so failure should be visible rather than swallowed. */
export class OllamaUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OllamaUnavailableError";
  }
}

/** Ollama answered, but its response wasn't parseable/valid JSON for what we asked of it — even
 *  after chatJson's one retry with a stricter reminder. Distinct from OllamaUnavailableError so
 *  callers can fall back to a non-LLM default instead of treating it as "Ollama is down". */
export class OllamaMalformedResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OllamaMalformedResponseError";
  }
}
