import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { importJobFiles, importJobs } from "@/lib/db/schema";
import { loadJobSnapshot } from "@/lib/import/events";
import { sanitizeFilename, stagingDirFor } from "@/lib/import/paths";
import { enqueueImportJob } from "@/lib/import/queue";

/**
 * Accepts a batch of files as multipart form data (field name "files"), stages
 * them to disk, creates the import_jobs/import_job_files rows, and hands the job
 * to the in-process worker queue (ARCHITECTURE.md §3.7). Large folders are sent
 * as several POSTs: optional `jobUuid` appends to a pending job, and
 * `finalize=false` delays processing until the last batch. `relativePaths`
 * (one per file, same order) and `createFolderPlaylists=true` opt into grouping
 * files from the same immediate subfolder into their own playlist once the job
 * finishes (see lib/import/folderPlaylists.ts). `compressAudio=true` opts into
 * re-encoding to Opus while processing (see lib/import/transcode.ts).
 */
export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "invalid_request",
          message:
            "Could not read the upload. The request may have been truncated — try again; large folders are sent in smaller batches.",
        },
      },
      { status: 400 },
    );
  }

  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
  const relativePaths = formData.getAll("relativePaths").map((entry) => (typeof entry === "string" ? entry : ""));
  const existingUuid = readFormString(formData, "jobUuid");
  const finalize = formData.get("finalize") !== "false";
  const createFolderPlaylists = formData.get("createFolderPlaylists") === "true";
  const compressAudio = formData.get("compressAudio") === "true";

  if (files.length === 0 && !(existingUuid && finalize)) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "No files provided under the 'files' field." } },
      { status: 400 },
    );
  }

  const db = getDb();
  const now = new Date().toISOString();
  let job;
  let startIndex = 0;
  let created = false;

  if (existingUuid) {
    job = db.select().from(importJobs).where(eq(importJobs.uuid, existingUuid)).get();
    if (!job) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Import job not found." } },
        { status: 404 },
      );
    }
    if (job.status !== "pending" || job.type !== "upload") {
      return NextResponse.json(
        { error: { code: "conflict", message: "That import job is no longer accepting files." } },
        { status: 409 },
      );
    }
    startIndex = db.select().from(importJobFiles).where(eq(importJobFiles.jobId, job.id)).all().length;
    if (files.length > 0) {
      db.update(importJobs)
        .set({ totalFiles: job.totalFiles + files.length })
        .where(eq(importJobs.id, job.id))
        .run();
    }
  } else {
    const jobUuid = randomUUID();
    job = db
      .insert(importJobs)
      .values({
        uuid: jobUuid,
        type: "upload",
        status: "pending",
        totalFiles: files.length,
        createFolderPlaylists: createFolderPlaylists ? 1 : 0,
        compressAudio: compressAudio ? 1 : 0,
        createdAt: now,
      })
      .returning()
      .get();
    created = true;
  }

  const stagingDir = stagingDirFor(job.uuid);
  mkdirSync(stagingDir, { recursive: true });

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    // Each file gets its own numbered subdirectory so same-named files from
    // different source folders (e.g. two "01 - Track.mp3") never collide.
    const fileDir = path.join(stagingDir, String(startIndex + i));
    mkdirSync(fileDir, { recursive: true });
    const stagedPath = path.join(fileDir, sanitizeFilename(file.name));

    await writeUploadedFile(file, stagedPath);

    db.insert(importJobFiles)
      .values({
        jobId: job.id,
        originalFilename: file.name,
        stagedPath,
        sourceFolder: sourceFolderFromRelativePath(relativePaths[i]),
        status: "queued",
        bytesTotal: file.size,
        bytesProcessed: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  if (finalize) {
    enqueueImportJob(job.id);
  }

  const snapshot = loadJobSnapshot(job.id);
  return NextResponse.json(
    { ...snapshot!.job, files: snapshot!.files },
    { status: created ? 201 : 200 },
  );
}

function readFormString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * A relative path like "Imported Folder/Album A/track.mp3" means the file came from
 * an immediate subfolder ("Album A") of the folder the user imported — used to group
 * files into per-folder playlists (see lib/import/folderPlaylists.ts). A path with no
 * subfolder segment ("Imported Folder/track.mp3", or none at all) returns null.
 */
function sourceFolderFromRelativePath(relativePath: string | undefined): string | null {
  if (!relativePath) return null;
  const segments = relativePath.split("/").filter(Boolean);
  // segments[0] is the imported root; a subfolder exists only if there's another
  // directory level between the root and the filename.
  return segments.length > 2 ? segments[1] : null;
}

async function writeUploadedFile(file: File, destPath: string): Promise<void> {
  await pipeline(
    Readable.fromWeb(file.stream() as import("node:stream/web").ReadableStream<Uint8Array>),
    createWriteStream(destPath),
  );
}
