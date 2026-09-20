import { NextResponse } from "next/server";
import { z } from "zod";
import { selectVibeTracks } from "@/lib/llm/vibeSelector";
import { OllamaMalformedResponseError, OllamaUnavailableError } from "@/lib/ollama/errors";

const EraSchema = z.object({
  min: z.number().int().min(1000).max(2999),
  max: z.number().int().min(1000).max(2999),
});

/**
 * The filter a previous batch resolved, echoed back by the client so Stage A runs once per session
 * rather than once per batch (see lib/store/vibeRadio.ts).
 *
 * Validated strictly even though this app is local and single-user: it arrives over the wire and
 * feeds straight into the scorer, so a malformed one must be a 400 rather than an exception in the
 * middle of a replenishment.
 */
const ResolvedFilterSchema = z.object({
  artistIds: z.array(z.number().int()).max(5),
  artistNames: z.array(z.string().max(200)).max(5),
  era: EraSchema.nullable(),
  softEra: EraSchema.nullable(),
  genres: z.array(z.string().max(60)).max(8),
  hardGenres: z.array(z.string().max(60)).max(8),
  keywords: z.array(z.string().max(60)).max(8),
  hasHardConstraint: z.boolean(),
  source: z.enum(["llm", "deterministic"]),
});

const BodySchema = z.object({
  prompt: z.string().trim().min(1).max(500),
  model: z.string().trim().min(1),
  excludeIds: z.array(z.number().int()).max(20000).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  // Vibe Radio wants personal-taste re-ranking; prompt->crate opts out (false) to stay
  // purely theme-driven — see lib/llm/vibeSelector.ts's selectVibeTracks doc comment.
  applyTaste: z.boolean().optional(),
  resolved: ResolvedFilterSchema.optional(),
  // Vibe Radio replenishment passes false: the interpretation is already settled, and a second
  // Ollama round trip per batch only adds drift and latency inside the crossfade window.
  useStageB: z.boolean().optional(),
  sessionId: z.string().max(64).optional(),
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
      applyTaste: parsed.data.applyTaste,
      resolved: parsed.data.resolved,
      useStageB: parsed.data.useStageB,
      sessionId: parsed.data.sessionId,
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
