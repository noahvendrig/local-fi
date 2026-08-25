import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { tracks } from "@/lib/db/schema";
import { getTrackDetailRow, mapTrackDetailRow } from "@/lib/db/trackDetail";
import { trackFingerprint } from "@/lib/import/fingerprint";
import { toDataDirRelative } from "@/lib/import/paths";
import { getLibraryRootById } from "@/lib/library/libraryRoots";
import { getDataDir } from "@/lib/storage/dataDir";
import { isPathInsideRoot, resolveTrackAbsPath, toRootRelative } from "@/lib/storage/resolveTrackPath";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Track not found." } }, { status: 404 });

const BodySchema = z.object({ path: z.string().trim().min(1).optional() });

/**
 * POST /api/v1/tracks/:id/relink — points a missing track at a re-located file (ARCHITECTURE.md
 * §7/M10). With no body, it just re-checks the track's recorded path (the common case: the user
 * copied the file back where it belonged). With `{ path }`, a managed track's target must resolve
 * inside LOCALFI_DATA_DIR (the "DB never stores paths outside the managed data dir" invariant);
 * a watched track's target must instead resolve inside its own library root — watch-in-place
 * tracks are never allowed to jump into the managed tree or another root.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId)) return NOT_FOUND;

  const db = getDb();
  const existing = db.select().from(tracks).where(and(eq(tracks.id, trackId), isNull(tracks.deletedAt))).get();
  if (!existing) return NOT_FOUND;

  const body = await request.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid relink request.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  let relativePath = existing.path;

  if (parsed.data.path) {
    const resolved = path.resolve(parsed.data.path);

    if (existing.libraryRootId == null) {
      const dataDir = path.resolve(getDataDir());
      if (!isPathInsideRoot(resolved, dataDir)) {
        return NextResponse.json(
          { error: { code: "invalid_path", message: "Relink target must be inside the library's data directory." } },
          { status: 422 }
        );
      }
      relativePath = toDataDirRelative(resolved);
    } else {
      const root = getLibraryRootById(existing.libraryRootId);
      if (!root || !isPathInsideRoot(resolved, root.path)) {
        return NextResponse.json(
          { error: { code: "invalid_path", message: "Relink target must be inside this track's watched library folder." } },
          { status: 422 }
        );
      }
      relativePath = toRootRelative(root.path, resolved);
    }
  }

  const absPath = resolveTrackAbsPath({ path: relativePath, libraryRootId: existing.libraryRootId });
  if (!existsSync(absPath)) {
    return NextResponse.json(
      { error: { code: "not_found_on_disk", message: "No file exists at that location." } },
      { status: 404 }
    );
  }

  const stat = statSync(absPath);
  const fingerprint = trackFingerprint(relativePath, stat.size, stat.mtimeMs);

  db.update(tracks)
    .set({
      path: relativePath,
      fingerprint,
      fileMtime: new Date(stat.mtimeMs).toISOString(),
      fileSizeBytes: stat.size,
      missingSince: null,
      dateModified: new Date().toISOString(),
    })
    .where(eq(tracks.id, trackId))
    .run();

  const updatedRow = getTrackDetailRow(db, trackId);
  return NextResponse.json(mapTrackDetailRow(updatedRow!));
}
