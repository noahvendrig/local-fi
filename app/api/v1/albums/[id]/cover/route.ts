import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { albums, tracks } from "@/lib/db/schema";
import { contentTypeForExt } from "@/lib/media/contentType";
import { getDataDir } from "@/lib/storage/dataDir";
import { applyCoverArtToTrack, unlinkOrphanCoverSidecar } from "@/lib/tags/applyCoverArt";
import { CoverImageError, coverImageFromUpload } from "@/lib/tags/coverImage";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "No cover art for this album." } }, { status: 404 });
const COVER_CACHE_CONTROL = "private, no-cache";

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
      "Cache-Control": COVER_CACHE_CONTROL,
    },
  });
}

/**
 * PUT /api/v1/albums/:id/cover — multipart field `file`. Writes the picture into every
 * album track that can store embedded art; others get a library sidecar only.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const albumId = Number(id);
  if (!Number.isInteger(albumId)) {
    return NextResponse.json({ error: { code: "not_found", message: "Album not found." } }, { status: 404 });
  }

  const db = getDb();
  const album = db.select().from(albums).where(eq(albums.id, albumId)).get();
  if (!album) {
    return NextResponse.json({ error: { code: "not_found", message: "Album not found." } }, { status: 404 });
  }

  const albumTracks = db
    .select()
    .from(tracks)
    .where(and(eq(tracks.albumId, albumId), isNull(tracks.deletedAt)))
    .all();
  if (albumTracks.length === 0) {
    return NextResponse.json({ error: { code: "invalid_request", message: "This album has no tracks to attach cover art to." } }, { status: 400 });
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

  const previousAlbumCover = album.coverArtPath;
  let coverArtRelativePath: string | null = null;
  let embeddedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  for (const track of albumTracks) {
    if (track.missingSince) {
      skippedCount += 1;
      continue;
    }
    try {
      const result = applyCoverArtToTrack(track, image, { promoteToAlbum: "never" });
      coverArtRelativePath = coverArtRelativePath ?? result.coverArtRelativePath;
      if (result.embedded) embeddedCount += 1;
      else skippedCount += 1;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Failed to write cover art.");
    }
  }

  if (!coverArtRelativePath) {
    return NextResponse.json(
      {
        error: {
          code: "cover_write_failed",
          message: errors[0] ?? "Couldn't write cover art to any track in this album.",
        },
      },
      { status: 500 }
    );
  }

  db.update(albums).set({ coverArtPath: coverArtRelativePath }).where(eq(albums.id, albumId)).run();
  unlinkOrphanCoverSidecar(previousAlbumCover);

  return NextResponse.json({
    coverArtUrl: `/api/v1/albums/${albumId}/cover?v=${encodeURIComponent(coverArtRelativePath)}`,
    embeddedCount,
    skippedCount,
    failedCount: errors.length,
  });
}
