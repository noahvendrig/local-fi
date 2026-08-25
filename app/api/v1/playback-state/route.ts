import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { playbackState } from "@/lib/db/schema";
import { parseEqJson, parseEqState } from "@/lib/audio/eqConfig";
import { getTrackSummariesByIds } from "@/lib/db/trackSummary";

// Single-player phase-1 case (ARCHITECTURE.md §3.8) — a real column, not a hardcoded
// singleton row, so multi-device/multi-tab state later is "write more rows," not a schema change.
const SESSION_KEY = "default";

const PutSchema = z.object({
  queue: z.array(z.number().int().positive()).optional(),
  currentIndex: z.number().int().min(0).optional(),
  positionSeconds: z.number().min(0).optional(),
  isPlaying: z.boolean().optional(),
  volume: z.number().min(0).max(1).optional(),
  repeatMode: z.enum(["off", "all", "one"]).optional(),
  shuffle: z.boolean().optional(),
  eq: z
    .object({
      enabled: z.boolean(),
      gains: z.array(z.number().min(-12).max(12)).length(10),
      preamp: z.number().min(-12).max(12),
      preset: z.string(),
    })
    .optional(),
});

type Db = ReturnType<typeof getDb>;

function loadRow(db: Db) {
  return db.select().from(playbackState).where(eq(playbackState.sessionKey, SESSION_KEY)).get();
}

function toResponseBody(db: Db) {
  const row = loadRow(db);
  const ids: number[] = row ? (JSON.parse(row.queueJson) as number[]) : [];
  const queue = getTrackSummariesByIds(db, ids);
  const requestedId = row ? ids[row.currentIndex] : undefined;
  const currentIndex = requestedId != null ? Math.max(0, queue.findIndex((t) => t.id === requestedId)) : 0;

  return {
    sessionKey: SESSION_KEY,
    queue,
    currentIndex: queue.length === 0 ? 0 : currentIndex,
    positionSeconds: row?.positionSeconds ?? 0,
    isPlaying: row ? row.isPlaying === 1 : false,
    volume: row?.volume ?? 1,
    repeatMode: row?.repeatMode ?? "off",
    shuffle: row ? row.shuffle === 1 : false,
    eq: parseEqJson(row?.eqJson),
    updatedAt: row?.updatedAt ?? null,
  };
}

/** GET /api/v1/playback-state — current queue/position (ARCHITECTURE.md §7). */
export async function GET() {
  return NextResponse.json(toResponseBody(getDb()));
}

/** PUT /api/v1/playback-state — partial, debounce-written from the client on change. */
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid playback state.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const db = getDb();
  const existing = loadRow(db);
  const now = new Date().toISOString();
  const patch = parsed.data;

  const merged = {
    sessionKey: SESSION_KEY,
    queueJson: patch.queue ? JSON.stringify(patch.queue) : (existing?.queueJson ?? "[]"),
    currentIndex: patch.currentIndex ?? existing?.currentIndex ?? 0,
    positionSeconds: patch.positionSeconds ?? existing?.positionSeconds ?? 0,
    isPlaying: patch.isPlaying !== undefined ? (patch.isPlaying ? 1 : 0) : (existing?.isPlaying ?? 0),
    volume: patch.volume ?? existing?.volume ?? 1,
    repeatMode: patch.repeatMode ?? existing?.repeatMode ?? "off",
    shuffle: patch.shuffle !== undefined ? (patch.shuffle ? 1 : 0) : (existing?.shuffle ?? 0),
    eqJson: patch.eq ? JSON.stringify(parseEqState(patch.eq)) : (existing?.eqJson ?? null),
    updatedAt: now,
  };

  db.insert(playbackState)
    .values(merged)
    .onConflictDoUpdate({ target: playbackState.sessionKey, set: merged })
    .run();

  return NextResponse.json(toResponseBody(db));
}
