import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { mixtapeJobs, mixtapes } from "@/lib/db/schema";
import { loadMixtapeJobSnapshot } from "@/lib/mixtapes/events";
import { requestMixtapeJobCancellation } from "@/lib/mixtapes/queue";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  const db = getDb();
  const job = db.select().from(mixtapeJobs).where(eq(mixtapeJobs.id, jobId)).get();

  if (!job) {
    return NextResponse.json({ error: { code: "not_found", message: "Mixtape job not found." } }, { status: 404 });
  }

  if (job.status === "pending") {
    requestMixtapeJobCancellation(jobId);
    const now = new Date().toISOString();
    db.update(mixtapeJobs).set({ status: "cancelled", finishedAt: now }).where(eq(mixtapeJobs.id, jobId)).run();
    db.update(mixtapes).set({ analysisStatus: "failed", updatedAt: now }).where(eq(mixtapes.id, job.mixtapeId)).run();
  } else if (job.status === "running") {
    requestMixtapeJobCancellation(jobId);
  }

  return NextResponse.json(loadMixtapeJobSnapshot(jobId));
}
