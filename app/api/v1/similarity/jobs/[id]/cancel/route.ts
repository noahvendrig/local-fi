import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { similarityJobs } from "@/lib/db/schema";
import { loadSimilarityJobSnapshot } from "@/lib/similarity/events";
import { requestSimilarityJobCancellation } from "@/lib/similarity/queue";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  const db = getDb();
  const job = db.select().from(similarityJobs).where(eq(similarityJobs.id, jobId)).get();

  if (!job) {
    return NextResponse.json({ error: { code: "not_found", message: "Similarity job not found." } }, { status: 404 });
  }

  if (job.status === "pending") {
    requestSimilarityJobCancellation(jobId);
    db.update(similarityJobs).set({ status: "cancelled", finishedAt: new Date().toISOString() }).where(eq(similarityJobs.id, jobId)).run();
  } else if (job.status === "running") {
    requestSimilarityJobCancellation(jobId);
  }

  const snapshot = loadSimilarityJobSnapshot(jobId)!;
  return NextResponse.json({ ...snapshot.job, tracks: snapshot.tracks });
}
