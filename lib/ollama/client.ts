import { getOllamaBaseUrl } from "./process";
import { OllamaMalformedResponseError, OllamaUnavailableError } from "./errors";

interface OllamaTagsResponse {
  models: { name: string }[];
}

/** GET /api/tags (Ollama-native — the OpenAI-compatible surface has no model-listing endpoint). */
export async function listOllamaModels(): Promise<string[]> {
  try {
    const res = await fetch(`${getOllamaBaseUrl()}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new OllamaUnavailableError(`Ollama rejected /api/tags (HTTP ${res.status}).`);
    const data = (await res.json()) as OllamaTagsResponse;
    return data.models.map((m) => m.name);
  } catch (err) {
    if (err instanceof OllamaUnavailableError) throw err;
    throw new OllamaUnavailableError("Could not reach Ollama.");
  }
}

interface JsonSchemaFormat {
  name: string;
  schema: Record<string, unknown>;
}

interface ChatJsonOptions<T> {
  model: string;
  system: string;
  user: string;
  /** When given, Ollama is asked to constrain output to this JSON schema (response_format:
   *  json_schema). Omit to fall back to Ollama's looser json_object mode. */
  schema?: JsonSchemaFormat;
  temperature?: number;
  timeoutMs?: number;
  /** Runtime shape check beyond "is this valid JSON" — return null to reject and trigger the
   *  one-retry-then-throw path in the caller. */
  validate: (value: unknown) => value is T;
}

interface OllamaChatResponse {
  message?: { content: string | null };
}

/** One non-streaming call to Ollama's NATIVE POST /api/chat, asking for a JSON object and
 *  validating the shape. Deliberately not the OpenAI-compatible /v1/chat/completions dialect —
 *  in testing, Node's built-in fetch (this app's runtime) reliably hung or took 10x longer against
 *  that endpoint while curl to the exact same URL was fast, whereas native /api/chat was
 *  consistently fast (~1s) via the same fetch client. Trades the "swap local servers via a
 *  base-URL change" portability of the OpenAI-compatible shape for actually working reliably.
 *  Retries once with a stricter reminder on malformed/invalid-shape output before giving up. */
export async function chatJson<T>(opts: ChatJsonOptions<T>): Promise<T> {
  const attempt = async (strict: boolean): Promise<T | null> => {
    const system = strict ? `${opts.system}\n\nRespond with valid JSON only — no prose, no markdown.` : opts.system;

    let res: Response;
    try {
      res = await fetch(`${getOllamaBaseUrl()}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
        body: JSON.stringify({
          model: opts.model,
          stream: false,
          // Reasoning models (qwen3.5, qwq, deepseek-r1, ...) default to an extended "thinking"
          // trace even for a trivial extraction task -- 25s+ and it can wander off the requested
          // JSON shape entirely. Disabling it made a 2B model both ~25x faster and correct.
          think: false,
          options: { temperature: opts.temperature ?? 0.3 },
          messages: [
            { role: "system", content: system },
            { role: "user", content: opts.user },
          ],
          format: opts.schema ? opts.schema.schema : "json",
        }),
      });
    } catch {
      throw new OllamaUnavailableError("Could not reach Ollama.");
    }
    if (!res.ok) throw new OllamaUnavailableError(`Ollama rejected the chat request (HTTP ${res.status}).`);

    const data = (await res.json().catch(() => null)) as OllamaChatResponse | null;
    const content = data?.message?.content;
    if (!content) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return null;
    }
    return opts.validate(parsed) ? parsed : null;
  };

  const first = await attempt(false);
  if (first !== null) return first;

  const retried = await attempt(true);
  if (retried !== null) return retried;

  throw new OllamaMalformedResponseError("Ollama did not return the expected JSON shape.");
}
