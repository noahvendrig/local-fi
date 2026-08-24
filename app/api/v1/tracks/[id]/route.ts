import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { albums, artists, tracks } from "@/lib/db/schema";
import { getTrackDetailRow, mapTrackDetailRow } from "@/lib/db/trackDetail";
import { trackFingerprint } from "@/lib/import/fingerprint";
import { ensureAlbumArtistLink, ensureTrackArtistLink, upsertAlbum, upsertArtist } from "@/lib/import/upsert";
import { getDataDir } from "@/lib/storage/dataDir";
import { writeTrackTags } from "@/lib/tags/writeTags";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Track not found." } }, { status: 404 });

const PatchSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  artist: z.string().trim().min(1).max(500).optional(),
  album: z.string().trim().max(500).nullable().optional(),
  albumArtist: z.string().trim().max(500).nullable().optional(),
  trackNumber: z.number().int().min(0).max(9999).nullable().optional(),
  discNumber: z.number().int().min(0).max(999).nullable().optional(),
  year: z.number().int().min(0).max(9999).nullable().optional(),
  genre: z.string().trim().max(200).nullable().optional(),
});

/** GET /api/v1/tracks/:id — full detail incl. resolved artist/album/album-artist (ARCHITECTURE.md §7). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId)) return NOT_FOUND;

  const row = getTrackDetailRow(getDb(), trackId);
  if (!row) return NOT_FOUND;

  return NextResponse.json(mapTrackDetailRow(row));
}

/**
 * PATCH /api/v1/tracks/:id — edit tags (ARCHITECTURE.md §5/M9): write to the physical file via
 * node-taglib-sharp first, then update the DB row from those same values, then re-run the
 * artist/album upsert (so renaming an album regroups the track rather than orphaning a duplicate).
 * If the file write fails, the DB is never touched — it must never drift from the file.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId)) return NOT_FOUND;

  const db = getDb();
  const existing = db.select().from(tracks).where(and(eq(tracks.id, trackId), isNull(tracks.deletedAt))).get();
  if (!existing) return NOT_FOUND;

  const body = await request.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid tag update.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }
  const patch = parsed.data;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: { code: "invalid_request", message: "No fields to update." } }, { status: 400 });
  }

  if (existing.missingSince) {
    return NextResponse.json(
      { error: { code: "file_missing", message: "This track's file is missing on disk; relink it before editing tags." } },
      { status: 409 }
    );
  }

  const absPath = path.join(getDataDir(), existing.path);

  try {
    writeTrackTags(absPath, patch);
  } catch (err) {
    return NextResponse.json(
      { error: { code: "tag_write_failed", message: err instanceof Error ? err.message : "Failed to write tags to file." } },
      { status: 500 }
    );
  }

  const stat = statSync(absPath);
  const fingerprint = trackFingerprint(existing.path, stat.size, stat.mtimeMs);
  const now = new Date().toISOString();

  const touchesArtistOrAlbum = patch.artist !== undefined || patch.album !== undefined || patch.albumArtist !== undefined;

  const currentArtist = existing.artistId ? db.select().from(artists).where(eq(artists.id, existing.artistId)).get() : null;
  const currentAlbum = existing.albumId ? db.select().from(albums).where(eq(albums.id, existing.albumId)).get() : null;
  const currentAlbumArtistName = currentAlbum?.albumArtistId
    ? (db.select({ name: artists.name }).from(artists).where(eq(artists.id, currentAlbum.albumArtistId)).get()?.name ?? null)
    : null;

  db.transaction((tx) => {
    let artistId = existing.artistId;
    let albumId = existing.albumId;

    if (touchesArtistOrAlbum) {
      const artistName = patch.artist !== undefined ? patch.artist : (currentArtist?.name ?? "Unknown Artist");
      const artist = upsertArtist(tx, artistName);
      artistId = artist.id;
      ensureTrackArtistLink(tx, trackId, artist.id, "primary", 0);

      const albumTitle = patch.album !== undefined ? patch.album : (currentAlbum?.title ?? null);
      if (albumTitle) {
        const albumArtistName = patch.albumArtist !== undefined ? patch.albumArtist || artistName : (currentAlbumArtistName ?? artistName);
        const albumArtist = upsertArtist(tx, albumArtistName);
        const albumYear = patch.year !== undefined ? patch.year : (currentAlbum?.year ?? existing.year);
        const albumRow = upsertAlbum(tx, albumTitle, albumArtist.id, albumYear ?? null);
        ensureAlbumArtistLink(tx, albumRow.id, albumArtist.id, 0);
        albumId = albumRow.id;
      } else {
        albumId = null;
      }
    }

    tx.update(tracks)
      .set({
        title: patch.title !== undefined ? patch.title : existing.title,
        artistId,
        albumId,
        trackNumber: patch.trackNumber !== undefined ? patch.trackNumber : existing.trackNumber,
        discNumber: patch.discNumber !== undefined ? patch.discNumber : existing.discNumber,
        year: patch.year !== undefined ? patch.year : existing.year,
        genre: patch.genre !== undefined ? patch.genre : existing.genre,
        fileMtime: new Date(stat.mtimeMs).toISOString(),
        fileSizeBytes: stat.size,
        fingerprint,
        dateModified: now,
      })
      .where(eq(tracks.id, trackId))
      .run();
  });

  const updatedRow = getTrackDetailRow(db, trackId);
  return NextResponse.json(mapTrackDetailRow(updatedRow!));
}

/**
 * DELETE /api/v1/tracks/:id — soft-remove by default (moves the file to trash/, sets deletedAt);
 * `?hard=true` permanently purges the row and file (used by Health's "Remove missing entry", M10).
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId)) return NOT_FOUND;

  const url = new URL(request.url);
  const hard = url.searchParams.get("hard") === "true";

  const db = getDb();
  const existing = db.select().from(tracks).where(and(eq(tracks.id, trackId), isNull(tracks.deletedAt))).get();
  if (!existing) return NOT_FOUND;

  const absPath = path.join(getDataDir(), existing.path);
  const now = new Date().toISOString();

  if (hard) {
    if (existsSync(absPath)) {
      try {
        unlinkSync(absPath);
      } catch {
        // Best-effort — a purged row shouldn't be blocked by a file the OS won't release.
      }
    }
    db.delete(tracks).where(eq(tracks.id, trackId)).run();
  } else {
    if (!existing.missingSince && existsSync(absPath)) {
      const trashPath = path.join(getDataDir(), "trash", existing.uuid, path.basename(absPath));
      mkdirSync(path.dirname(trashPath), { recursive: true });
      renameSync(absPath, trashPath);
    }
    db.update(tracks).set({ deletedAt: now }).where(eq(tracks.id, trackId)).run();
  }

  return new NextResponse(null, { status: 204 });
}
