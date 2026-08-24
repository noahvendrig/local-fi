import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { playlistTracks, playlists } from "@/lib/db/schema";
import { evaluateSmartCrate } from "@/lib/crates/evaluateRules";
import { RuleGroupSchema } from "@/lib/crates/rules";
import { toPlaylistJson } from "@/lib/crates/serialize";

const QuerySchema = z.object({
  type: z.enum(["manual", "smart"]).optional(),
  q: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const CreateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: z.enum(["manual", "smart"]),
    description: z.string().trim().max(2000).optional(),
    rulesJson: RuleGroupSchema.optional(),
    sortField: z.string().optional(),
  })
  .refine((body) => body.type !== "smart" || body.rulesJson != null, {
    message: "rulesJson is required for a smart crate.",
    path: ["rulesJson"],
  });

/** GET /api/v1/playlists — list playlists/crates (ARCHITECTURE.md §7). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid query parameters.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const { type, q, limit } = parsed.data;
  const conditions: SQL[] = [];
  if (type) conditions.push(eq(playlists.type, type));
  if (q) conditions.push(sql`lower(${playlists.name}) LIKE ${`%${q.toLowerCase()}%`}`);

  const db = getDb();
  const query = db
    .select()
    .from(playlists)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(playlists.updatedAt));
  const rows = limit ? query.limit(limit).all() : query.all();

  const manualIds = rows.filter((r) => r.type === "manual").map((r) => r.id);
  const manualCounts = manualIds.length
    ? db
        .select({ playlistId: playlistTracks.playlistId, cnt: sql<number>`count(*)`.as("cnt") })
        .from(playlistTracks)
        .where(inArray(playlistTracks.playlistId, manualIds))
        .groupBy(playlistTracks.playlistId)
        .all()
    : [];
  const manualCountById = new Map(manualCounts.map((r) => [r.playlistId, r.cnt]));

  const items = rows.map((row) => {
    let trackCount = 0;
    if (row.type === "manual") {
      trackCount = manualCountById.get(row.id) ?? 0;
    } else if (row.rulesJson) {
      trackCount = evaluateSmartCrate(db, JSON.parse(row.rulesJson), row.sortField).length;
    }
    return { ...toPlaylistJson(row), trackCount };
  });

  return NextResponse.json({ items });
}

/** POST /api/v1/playlists — create a manual playlist or a smart crate (ARCHITECTURE.md §7). */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid playlist.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const { name, type, description, rulesJson, sortField } = parsed.data;
  const now = new Date().toISOString();

  const row = getDb()
    .insert(playlists)
    .values({
      uuid: randomUUID(),
      name,
      type,
      description: description ?? null,
      rulesJson: type === "smart" ? JSON.stringify(rulesJson) : null,
      sortField: sortField ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return NextResponse.json(toPlaylistJson(row), { status: 201 });
}
