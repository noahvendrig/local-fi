import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { getTrackDetailRow, mapTrackDetailRow } from "@/lib/db/trackDetail";
import { albums, tracks } from "@/lib/db/schema";
import { contentTypeForExt } from "@/lib/media/contentType";
import { getDataDir } from "@/lib/storage/dataDir";
import { applyCoverArtToTrack } from "@/lib/tags/applyCoverArt";
import { CoverImageError, coverImageFromUpload } from "@/lib/tags/coverImage";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "No cover art for this track." } }, { status: 404 });
const COVER_CACHE_CONTROL = "private, no-cache";

/** GET /api/v1/tracks/:id/cover — cover art bytes, falling back to the album's (ARCHITECTURE.md §7). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId)) return NOT_FOUND;

  const track = getDb()
    .select({ coverArtPath: tracks.coverArtPath, albumCoverArtPath: albums.coverArtPath })
    .from(tracks)
    .leftJoin(albums, eq(tracks.albumId, albums.id))
    .where(eq(tracks.id, trackId))
    .get();

  const coverArtPath = track?.coverArtPath ?? track?.albumCoverArtPath;
  if (!coverArtPath) return NOT_FOUND;

  const absPath = path.join(getDataDir(), coverArtPath);
  if (!existsSync(absPath)) return NOT_FOUND;

  const buffer = readFileSync(absPath);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentTypeForExt(path.extname(absPath)),
      "Cache-Control": COVER_CACHE_CONTROL,
    },
  });
}

/**
 * PUT /api/v1/tracks/:id/cover — multipart field `file`. Embeds the picture in the audio file
 * when the format can hold one, then writes the artwork sidecar and DB path so the UI matches.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId)) {
    return NextResponse.json({ error: { code: "not_found", message: "Track not found." } }, { status: 404 });
  }

  const db = getDb();
  const existing = db.select().from(tracks).where(and(eq(tracks.id, trackId), isNull(tracks.deletedAt))).get();
  if (!existing) {
    return NextResponse.json({ error: { code: "not_found", message: "Track not found." } }, { status: 404 });
  }
  if (existing.missingSince) {
    return NextResponse.json(
      { error: { code: "file_missing", message: "This track's file is missing on disk; relink it before editing cover art." } },
      { status: 409 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "Could not read the upload." } }, { status: 400 });
  }
  const uploaded = formData.get("file");
  if (!(uploaded instanceof File) || uploaded.size === 0) {
    return NextResponse.json({ error: { code: "invalid_request", message: "No image provided under the 'file' field." } }, { status: 400 });
  }

  let image;
  try {
    image = await coverImageFromUpload(uploaded);
  } catch (err) {
    if (err instanceof CoverImageError) {
      return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
    }
    throw err;
  }

  try {
    const result = applyCoverArtToTrack(existing, image);
    const updatedRow = getTrackDetailRow(db, trackId);
    return NextResponse.json({ ...mapTrackDetailRow(updatedRow!), coverEmbedded: result.embedded });
  } catch (err) {
    return NextResponse.json(
      { error: { code: "cover_write_failed", message: err instanceof Error ? err.message : "Failed to write cover art." } },
      { status: 500 }
    );
  }
}
