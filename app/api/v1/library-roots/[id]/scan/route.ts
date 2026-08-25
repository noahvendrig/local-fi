import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { tracks } from "@/lib/db/schema";
import { getLibraryRootById } from "@/lib/library/libraryRoots";
import { checkTracksForChanges, enqueueFolderScanJob, walkRootForNewFiles } from "@/lib/library/scan";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Library root not found." } }, { status: 404 });

/**
 * POST /api/v1/library-roots/:id/scan — rescans one watched folder: stats its known tracks
 * for missing/changed files, then walks the tree for anything new and hands it to the
 * import queue. Returns the folder_scan job so the Import page can show progress.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rootId = Number(id);
  if (!Number.isInteger(rootId)) return NOT_FOUND;

  const root = getLibraryRootById(rootId);
  if (!root) return NOT_FOUND;

  const rootTracks = getDb()
    .select()
    .from(tracks)
    .where(and(eq(tracks.libraryRootId, rootId), isNull(tracks.deletedAt)))
    .all();
  checkTracksForChanges(rootTracks);

  const newFiles = await walkRootForNewFiles(root);
  const importJob = enqueueFolderScanJob(root, newFiles);

  return NextResponse.json(importJob, { status: 201 });
}
