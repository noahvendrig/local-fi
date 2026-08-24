import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { albums, tracks } from "@/lib/db/schema";
import { contentTypeForExt } from "@/lib/media/contentType";
import { getDataDir } from "@/lib/storage/dataDir";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "No cover art for this track." } }, { status: 404 });

/** GET /api/v1/tracks/:id/cover — cover art bytes, falling back to the album's (ARCHITECTURE.md §7). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId)) return NOT_FOUND;

  const track = getDb()
    .select({ coverArtPath: tracks.coverArtPath, albumCoverArtPath: albums.coverArtPath })
    .from(tracks)
    .leftJoin(albums, eq(tracks.albumId, albums.id))
    .where(and(eq(tracks.id, trackId), isNull(tracks.deletedAt)))
    .get();

  const coverArtPath = track?.coverArtPath ?? track?.albumCoverArtPath;
  if (!coverArtPath) return NOT_FOUND;

  const absPath = path.join(getDataDir(), coverArtPath);
  if (!existsSync(absPath)) return NOT_FOUND;

  const buffer = readFileSync(absPath);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentTypeForExt(path.extname(absPath)),
      "Cache-Control": "private, max-age=604800",
    },
  });
}
