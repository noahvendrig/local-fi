import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { tracks } from "@/lib/db/schema";
import { getTrackDetailRow, mapTrackDetailRow } from "@/lib/db/trackDetail";
import { restoreTrack } from "@/lib/library/trash";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Track not found." } }, { status: 404 });

/** POST /api/v1/tracks/:id/restore — move a soft-deleted track back into the library. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId)) return NOT_FOUND;

  const db = getDb();
  const existing = db.select().from(tracks).where(eq(tracks.id, trackId)).get();
  if (!existing) return NOT_FOUND;
  if (!existing.deletedAt) {
    return NextResponse.json(
      { error: { code: "not_in_trash", message: "This track is not in the trash." } },
      { status: 409 }
    );
  }

  try {
    restoreTrack(existing);
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: "restore_failed",
          message: err instanceof Error ? err.message : "Couldn't restore this track from trash.",
        },
      },
      { status: 500 }
    );
  }

  const row = getTrackDetailRow(db, trackId);
  if (!row) return NOT_FOUND;
  return NextResponse.json(mapTrackDetailRow(row));
}
