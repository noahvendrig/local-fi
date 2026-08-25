import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { analysisJobs } from "@/lib/db/schema";
import { loadAnalysisJobSnapshot } from "@/lib/analysis/events";
import { requestAnalysisJobCancellation } from "@/lib/analysis/queue";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  const db = getDb();
  const job = db.select().from(analysisJobs).where(eq(analysisJobs.id, jobId)).get();

  if (!job) {
    return NextResponse.json({ error: { code: "not_found", message: "Analysis job not found." } }, { status: 404 });
  }

  if (job.status === "pending") {
    requestAnalysisJobCancellation(jobId);
    db.update(analysisJobs).set({ status: "cancelled", finishedAt: new Date().toISOString() }).where(eq(analysisJobs.id, jobId)).run();
  } else if (job.status === "running") {
    requestAnalysisJobCancellation(jobId);
  }

  const snapshot = loadAnalysisJobSnapshot(jobId)!;
  return NextResponse.json({ ...snapshot.job, tracks: snapshot.tracks });
}
