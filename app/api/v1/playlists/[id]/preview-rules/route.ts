import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { playlists } from "@/lib/db/schema";
import { evaluateSmartCrate } from "@/lib/crates/evaluateRules";
import { RuleGroupSchema } from "@/lib/crates/rules";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Playlist not found." } }, { status: 404 });

const PreviewSchema = z.object({
  rulesJson: RuleGroupSchema,
  sortField: z.string().optional(),
});

/** POST /api/v1/playlists/:id/preview-rules — live-evaluate a rule tree without saving (ARCHITECTURE.md §7). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playlistId = Number(id);
  if (!Number.isInteger(playlistId)) return NOT_FOUND;

  const db = getDb();
  const playlist = db.select({ id: playlists.id }).from(playlists).where(eq(playlists.id, playlistId)).get();
  if (!playlist) return NOT_FOUND;

  const body = await request.json().catch(() => null);
  const parsed = PreviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_rules", message: "Invalid rule tree.", details: parsed.error.flatten() } },
      { status: 422 }
    );
  }

  const items = evaluateSmartCrate(db, parsed.data.rulesJson, parsed.data.sortField ?? null);
  return NextResponse.json({ items, count: items.length });
}
