import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { importJobFiles, importJobs } from "@/lib/db/schema";
import { enqueueImportJob } from "@/lib/import/queue";
import { sanitizeFilename, stagingDirFor } from "@/lib/import/paths";

/**
 * Accepts a batch of files as multipart form data (field name "files"), stages
 * them to disk, creates the import_jobs/import_job_files rows, and hands the job
 * to the in-process worker queue (ARCHITECTURE.md §3.7). Processing runs in the
 * background — this responds as soon as staging is done.
 */
export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Expected multipart/form-data with a 'files' field." } },
      { status: 400 }
    );
  }

  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);

  if (files.length === 0) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "No files provided under the 'files' field." } },
      { status: 400 }
    );
  }

  const db = getDb();
  const jobUuid = randomUUID();
  const now = new Date().toISOString();

  const job = db
    .insert(importJobs)
    .values({ uuid: jobUuid, type: "upload", status: "pending", totalFiles: files.length, createdAt: now })
    .returning()
    .get();

  const stagingDir = stagingDirFor(jobUuid);
  mkdirSync(stagingDir, { recursive: true });

  const jobFiles = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    // Each file gets its own numbered subdirectory so same-named files from
    // different source folders (e.g. two "01 - Track.mp3") never collide.
    const fileDir = path.join(stagingDir, String(i));
    mkdirSync(fileDir, { recursive: true });
    const stagedPath = path.join(fileDir, sanitizeFilename(file.name));

    const buffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(stagedPath, buffer);

    const jobFile = db
      .insert(importJobFiles)
      .values({
        jobId: job.id,
        originalFilename: file.name,
        stagedPath,
        status: "queued",
        bytesTotal: file.size,
        bytesProcessed: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    jobFiles.push(jobFile);
  }

  enqueueImportJob(job.id);

  return NextResponse.json({ ...job, files: jobFiles }, { status: 201 });
}
