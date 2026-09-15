import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { fingerprintJobs } from "@/lib/db/schema";
import { loadFingerprintJobSnapshot } from "@/lib/fingerprint/events";
import { requestFingerprintJobCancellation } from "@/lib/fingerprint/queue";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  const db = getDb();
  const job = db.select().from(fingerprintJobs).where(eq(fingerprintJobs.id, jobId)).get();

  if (!job) {
    return NextResponse.json({ error: { code: "not_found", message: "Fingerprint job not found." } }, { status: 404 });
  }

  if (job.status === "pending") {
    requestFingerprintJobCancellation(jobId);
    db.update(fingerprintJobs).set({ status: "cancelled", finishedAt: new Date().toISOString() }).where(eq(fingerprintJobs.id, jobId)).run();
  } else if (job.status === "running") {
    requestFingerprintJobCancellation(jobId);
  }

  const snapshot = loadFingerprintJobSnapshot(jobId)!;
  return NextResponse.json({ ...snapshot.job, tracks: snapshot.tracks });
}
