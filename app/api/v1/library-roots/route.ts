import { NextResponse } from "next/server";
import { z } from "zod";
import { createLibraryRoot, listLibraryRoots, RootValidationFailure, type RootValidationErrorCode } from "@/lib/library/libraryRoots";
import { enqueueFolderScanJob, walkRootForNewFiles } from "@/lib/library/scan";
import { startWatcher } from "@/lib/library/watcher";

const ERROR_STATUS: Record<RootValidationErrorCode, number> = {
  not_found: 400,
  not_a_directory: 400,
  inside_data_dir: 400,
  duplicate: 409,
  overlapping_root: 409,
};

/** GET /api/v1/library-roots — watched folders, with track/missing counts (AGENTS.md watch-in-place design). */
export async function GET() {
  const items = listLibraryRoots().map((root) => ({ ...root, syncToCrate: root.syncToCrate === 1 }));
  return NextResponse.json({ items });
}

const BodySchema = z.object({
  path: z.string().trim().min(1),
  name: z.string().trim().max(200).optional(),
  /** Mirror this folder (and each immediate subfolder) into manual crates, kept in sync as files are indexed. */
  syncToCrate: z.boolean().optional(),
});

/**
 * POST /api/v1/library-roots — registers an existing folder to index in place (never copied
 * into data/originals/). Validates the path, starts watching it, and kicks off an initial
 * folder_scan import job so the Import tray shows real progress for the first index.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid library root request.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  let root;
  try {
    root = createLibraryRoot(parsed.data.path, parsed.data.name, parsed.data.syncToCrate ?? false);
  } catch (err) {
    if (err instanceof RootValidationFailure) {
      return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: ERROR_STATUS[err.code] });
    }
    throw err;
  }

  startWatcher(root);

  const newFiles = await walkRootForNewFiles(root);
  const importJob = enqueueFolderScanJob(root, newFiles);

  return NextResponse.json(
    { ...root, syncToCrate: root.syncToCrate === 1, trackCount: 0, missingCount: 0, rootCrateId: null, importJob },
    { status: 201 }
  );
}
