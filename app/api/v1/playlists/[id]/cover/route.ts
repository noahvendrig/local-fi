import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { toPlaylistJson } from "@/lib/crates/serialize";
import {
  PLAYLIST_COVER_MAX_BYTES,
  detectCoverImageExt,
  unlinkCoverArtFile,
  writePlaylistCoverArt,
} from "@/lib/crates/coverArt";
import { getDb } from "@/lib/db/client";
import { playlists } from "@/lib/db/schema";
import { contentTypeForExt } from "@/lib/media/contentType";
import { getDataDir } from "@/lib/storage/dataDir";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Playlist not found." } }, { status: 404 });
const NO_COVER = NextResponse.json({ error: { code: "not_found", message: "No cover art for this playlist." } }, { status: 404 });

function playlistIdFrom(id: string): number | null {
  const playlistId = Number(id);
  return Number.isInteger(playlistId) ? playlistId : null;
}

function invalid(message: string, status = 400) {
  return NextResponse.json({ error: { code: "invalid_request", message } }, { status });
}

/** GET /api/v1/playlists/:id/cover — uploaded crate cover bytes. Accepts ?token= like album/track covers. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const playlistId = playlistIdFrom((await params).id);
  if (playlistId == null) return NO_COVER;

  const playlist = getDb()
    .select({ coverArtPath: playlists.coverArtPath })
    .from(playlists)
    .where(eq(playlists.id, playlistId))
    .get();
  if (!playlist?.coverArtPath) return NO_COVER;

  const absPath = path.join(getDataDir(), playlist.coverArtPath);
  if (!existsSync(absPath)) return NO_COVER;

  const buffer = readFileSync(absPath);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentTypeForExt(path.extname(absPath)),
      "Cache-Control": "private, max-age=604800",
    },
  });
}

/** PUT /api/v1/playlists/:id/cover — replace the crate cover. Multipart field name `file`. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const playlistId = playlistIdFrom((await params).id);
  if (playlistId == null) return NOT_FOUND;

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > PLAYLIST_COVER_MAX_BYTES + 64_000) {
    return invalid("Cover image is too large (max 10 MB).", 413);
  }

  const db = getDb();
  const existing = db.select().from(playlists).where(eq(playlists.id, playlistId)).get();
  if (!existing) return NOT_FOUND;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return invalid("Could not read the upload.");
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return invalid("No image provided under the 'file' field.");
  }
  if (file.size > PLAYLIST_COVER_MAX_BYTES) {
    return invalid("Cover image is too large (max 10 MB).", 413);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = detectCoverImageExt(bytes);
  if (!ext) {
    return invalid("Cover must be a JPEG, PNG, WebP, or GIF image.");
  }

  const coverArtPath = writePlaylistCoverArt(existing.uuid, existing.coverArtPath, bytes, ext);
  const now = new Date().toISOString();
  const updated = db
    .update(playlists)
    .set({ coverArtPath, updatedAt: now })
    .where(eq(playlists.id, playlistId))
    .returning()
    .get();

  return NextResponse.json(toPlaylistJson(updated));
}

/** DELETE /api/v1/playlists/:id/cover — remove the uploaded crate cover. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const playlistId = playlistIdFrom((await params).id);
  if (playlistId == null) return NOT_FOUND;

  const db = getDb();
  const existing = db.select().from(playlists).where(eq(playlists.id, playlistId)).get();
  if (!existing) return NOT_FOUND;

  unlinkCoverArtFile(existing.coverArtPath);
  const now = new Date().toISOString();
  const updated = db
    .update(playlists)
    .set({ coverArtPath: null, updatedAt: now })
    .where(eq(playlists.id, playlistId))
    .returning()
    .get();

  return NextResponse.json(toPlaylistJson(updated));
}
