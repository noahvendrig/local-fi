import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { findDuplicateGroups } from "@/lib/health/duplicates";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

/** GET /api/v1/health/duplicates — probable-duplicate groups (ARCHITECTURE.md §3.6/§7/M10). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid query parameters.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }
  const { limit, cursor } = parsed.data;

  // Groups are a computed, in-memory resource (no natural sort key to build a keyset cursor
  // from) — an opaque index-into-the-computed-list cursor keeps the same {items, nextCursor}
  // shape as every other list endpoint without pretending this is a real DB-backed cursor.
  const startIndex = cursor ? Number(Buffer.from(cursor, "base64url").toString("utf8")) || 0 : 0;
  const groups = findDuplicateGroups(getDb());
  const page = groups.slice(startIndex, startIndex + limit);
  const nextCursor = startIndex + limit < groups.length ? Buffer.from(String(startIndex + limit)).toString("base64url") : null;

  return NextResponse.json({
    items: page.map((g) => ({ key: g.key, keeperId: g.keeperId, tracks: g.tracks })),
    nextCursor,
  });
}
