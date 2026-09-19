import { NextResponse } from "next/server";
import { listOllamaModels } from "@/lib/ollama/client";
import { isOllamaAvailable } from "@/lib/ollama/process";

/** GET /api/v1/ollama/status — reachability + installed models, for Settings' Ollama section and
 *  gating the vibe features' UI. Never throws, same soft-check style as app/api/v1/health/route.ts. */
export async function GET() {
  const available = await isOllamaAvailable();
  if (!available) return NextResponse.json({ available: false, models: [] });

  try {
    const models = await listOllamaModels();
    return NextResponse.json({ available: true, models });
  } catch {
    return NextResponse.json({ available: true, models: [] });
  }
}
