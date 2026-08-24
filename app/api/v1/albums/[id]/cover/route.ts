import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { albums } from "@/lib/db/schema";
import { contentTypeForExt } from "@/lib/media/contentType";
import { getDataDir } from "@/lib/storage/dataDir";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "No cover art for this album." } }, { status: 404 });

/** GET /api/v1/albums/:id/cover — cover art bytes (ARCHITECTURE.md §7). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const albumId = Number(id);
  if (!Number.isInteger(albumId)) return NOT_FOUND;

  const album = getDb().select({ coverArtPath: albums.coverArtPath }).from(albums).where(eq(albums.id, albumId)).get();
  if (!album?.coverArtPath) return NOT_FOUND;

  const absPath = path.join(getDataDir(), album.coverArtPath);
  if (!existsSync(absPath)) return NOT_FOUND;

  const buffer = readFileSync(absPath);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentTypeForExt(path.extname(absPath)),
      "Cache-Control": "private, max-age=604800",
    },
  });
}
