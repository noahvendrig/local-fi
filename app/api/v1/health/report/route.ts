import { and, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { tracks } from "@/lib/db/schema";
import { findDuplicateGroups } from "@/lib/health/duplicates";

/** GET /api/v1/health/report — library health summary (ARCHITECTURE.md §7/M10). */
export async function GET() {
  const db = getDb();

  const missingCount =
    db
      .select({ cnt: sql<number>`count(*)`.as("cnt") })
      .from(tracks)
      .where(and(isNull(tracks.deletedAt), isNotNull(tracks.missingSince)))
      .get()?.cnt ?? 0;

  const pendingWaveformCount =
    db
      .select({ cnt: sql<number>`count(*)`.as("cnt") })
      .from(tracks)
      .where(and(isNull(tracks.deletedAt), ne(tracks.waveformStatus, "ready")))
      .get()?.cnt ?? 0;

  const duplicateGroupCount = findDuplicateGroups(db).length;

  return NextResponse.json({ missingCount, duplicateGroupCount, pendingWaveformCount });
}
