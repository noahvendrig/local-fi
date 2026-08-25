import { NextResponse } from "next/server";
import { z } from "zod";
import { getLibraryRootById, removeLibraryRoot, renameLibraryRoot, updateSyncToCrate } from "@/lib/library/libraryRoots";
import { backfillSyncForRoot } from "@/lib/library/syncCrates";
import { stopWatcher } from "@/lib/library/watcher";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Library root not found." } }, { status: 404 });

const PatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    /** Toggleable anytime, not just at add time — turning it on backfills existing tracks into the crate(s). */
    syncToCrate: z.boolean().optional(),
  })
  .refine((body) => body.name !== undefined || body.syncToCrate !== undefined, {
    message: "Provide at least one field to update.",
  });

/** PATCH /api/v1/library-roots/:id — rename the display label and/or toggle sync-to-crate. Changing the path is remove + re-add (AGENTS.md, out of scope). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rootId = Number(id);
  if (!Number.isInteger(rootId)) return NOT_FOUND;

  const existing = getLibraryRootById(rootId);
  if (!existing) return NOT_FOUND;

  const body = await request.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid library root update.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  let updated = existing;

  if (parsed.data.name !== undefined) {
    updated = renameLibraryRoot(rootId, parsed.data.name) ?? updated;
  }

  if (parsed.data.syncToCrate !== undefined) {
    const turningOn = parsed.data.syncToCrate && existing.syncToCrate !== 1;
    updated = updateSyncToCrate(rootId, parsed.data.syncToCrate) ?? updated;
    if (turningOn) backfillSyncForRoot(updated);
  }

  return NextResponse.json({ ...updated, syncToCrate: updated.syncToCrate === 1 });
}

/**
 * DELETE /api/v1/library-roots/:id — index-only removal: stops the watcher and deletes the
 * root's tracks (and their waveform/art sidecars) from the DB. Audio files on disk are
 * never touched (AGENTS.md watch-in-place design).
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rootId = Number(id);
  if (!Number.isInteger(rootId)) return NOT_FOUND;

  if (!getLibraryRootById(rootId)) return NOT_FOUND;

  stopWatcher(rootId);
  removeLibraryRoot(rootId);

  return new NextResponse(null, { status: 204 });
}
