import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { tracks } from "@/lib/db/schema";
import { findDuplicateGroups, repointPlaylistEntries } from "@/lib/health/duplicates";
import { softDeleteTrack } from "@/lib/library/trash";

const BodySchema = z.object({
  groupKey: z.string().trim().min(1).optional(),
});

/**
 * POST /api/v1/health/duplicates/remove — keep the best copy in each (or one) duplicate
 * group and soft-delete the extras into trash/.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid body.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const db = getDb();
  const groups = findDuplicateGroups(db);
  const { groupKey } = parsed.data;

  if (groupKey && !groups.some((group) => group.key === groupKey)) {
    return NextResponse.json({ error: { code: "not_found", message: "Duplicate group not found." } }, { status: 404 });
  }

  const targetGroups = groupKey ? groups.filter((group) => group.key === groupKey) : groups;
  const removedIds: number[] = [];

  for (const group of targetGroups) {
    const extras = group.tracks.filter((track) => track.id !== group.keeperId);
    for (const extra of extras) {
      const row = db.select().from(tracks).where(eq(tracks.id, extra.id)).get();
      if (!row || row.deletedAt) continue;
      try {
        repointPlaylistEntries(db, extra.id, group.keeperId);
        softDeleteTrack(row);
        removedIds.push(extra.id);
      } catch (err) {
        return NextResponse.json(
          {
            error: {
              code: "delete_failed",
              message: err instanceof Error ? err.message : "Couldn't remove a duplicate track.",
              details: { removedIds, failedId: extra.id },
            },
          },
          { status: 500 }
        );
      }
    }
  }

  return NextResponse.json({ removed: removedIds.length, removedIds });
}
