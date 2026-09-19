import { NextResponse } from "next/server";
import { z } from "zod";
import { selectVibeTracks } from "@/lib/llm/vibeSelector";
import { OllamaMalformedResponseError, OllamaUnavailableError } from "@/lib/ollama/errors";

const BodySchema = z.object({
  prompt: z.string().trim().min(1).max(500),
  model: z.string().trim().min(1),
  excludeIds: z.array(z.number().int()).max(20000).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

/** POST /api/v1/vibe/select — the one endpoint behind both vibe features (prompt->crate preview
 *  and Vibe Radio's replenishment loop): turns a free-text prompt into a real, ordered track list
 *  from the library via lib/llm/vibeSelector.ts. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid vibe-select request.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  try {
    const result = await selectVibeTracks(parsed.data.prompt, {
      excludeIds: parsed.data.excludeIds,
      limit: parsed.data.limit,
      model: parsed.data.model,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof OllamaUnavailableError) {
      return NextResponse.json(
        { error: { code: "ollama_unavailable", message: "Can't reach Ollama — make sure it's running." } },
        { status: 503 }
      );
    }
    if (err instanceof OllamaMalformedResponseError) {
      return NextResponse.json(
        { error: { code: "ollama_bad_response", message: "Ollama didn't return a usable response." } },
        { status: 502 }
      );
    }
    throw err;
  }
}
