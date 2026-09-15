import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { mixtapes } from "@/lib/db/schema";
import { deleteMixtapeCascade } from "@/lib/mixtapes/delete";
import { loadMixtapeDetail } from "@/lib/mixtapes/detail";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Mixtape not found." } }, { status: 404 });

const PatchSchema = z.object({
  title: z.string().trim().min(1).max(500),
});

/** GET /api/v1/mixtapes/:id — full detail incl. segments joined with any matched local track. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mixtapeId = Number(id);
  if (!Number.isInteger(mixtapeId)) return NOT_FOUND;

  const detail = loadMixtapeDetail(mixtapeId);
  if (!detail) return NOT_FOUND;
  return NextResponse.json(detail);
}

/** PATCH /api/v1/mixtapes/:id — rename only; a mixtape has no other editable tag fields. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mixtapeId = Number(id);
  if (!Number.isInteger(mixtapeId)) return NOT_FOUND;

  const db = getDb();
  const existing = db.select().from(mixtapes).where(eq(mixtapes.id, mixtapeId)).get();
  if (!existing) return NOT_FOUND;

  const body = await request.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid update.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  db.update(mixtapes)
    .set({ title: parsed.data.title, updatedAt: new Date().toISOString() })
    .where(eq(mixtapes.id, mixtapeId))
    .run();

  return NextResponse.json(loadMixtapeDetail(mixtapeId));
}

/** DELETE /api/v1/mixtapes/:id — hard delete (a mixtape's *matching state* is a working artifact
 *  under review, not library content the Trash system needs to protect — see the schema comment
 *  on `mixtapes`). Removes the audio + waveform + cover art files, the companion library track
 *  (same shared audio file — see the schema comment), then the row (cascade-deletes jobs/segments). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mixtapeId = Number(id);
  if (!Number.isInteger(mixtapeId)) return NOT_FOUND;

  if (!deleteMixtapeCascade(mixtapeId)) return NOT_FOUND;

  return new NextResponse(null, { status: 204 });
}
