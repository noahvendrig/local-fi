import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { importJobs } from "@/lib/db/schema";
import { loadJobSnapshot } from "@/lib/import/events";
import { requestJobCancellation } from "@/lib/import/queue";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  const db = getDb();
  const job = db.select().from(importJobs).where(eq(importJobs.id, jobId)).get();

  if (!job) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Import job not found." } },
      { status: 404 }
    );
  }

  if (job.status === "pending" || job.status === "running") {
    requestJobCancellation(jobId);
  }

  const snapshot = loadJobSnapshot(jobId);
  return NextResponse.json({ ...snapshot!.job, files: snapshot!.files });
}
