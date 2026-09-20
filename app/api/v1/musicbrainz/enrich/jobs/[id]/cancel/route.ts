import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { musicbrainzEnrichJobs } from "@/lib/db/schema";
import { loadMusicbrainzEnrichJobSnapshot } from "@/lib/musicbrainz/enrichEvents";
import { requestMusicbrainzEnrichJobCancellation } from "@/lib/musicbrainz/enrichQueue";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  const db = getDb();
  const job = db.select().from(musicbrainzEnrichJobs).where(eq(musicbrainzEnrichJobs.id, jobId)).get();

  if (!job) {
    return NextResponse.json({ error: { code: "not_found", message: "MusicBrainz enrich job not found." } }, { status: 404 });
  }

  if (job.status === "pending") {
    requestMusicbrainzEnrichJobCancellation(jobId);
    db.update(musicbrainzEnrichJobs).set({ status: "cancelled", finishedAt: new Date().toISOString() }).where(eq(musicbrainzEnrichJobs.id, jobId)).run();
  } else if (job.status === "running") {
    requestMusicbrainzEnrichJobCancellation(jobId);
  }

  const snapshot = loadMusicbrainzEnrichJobSnapshot(jobId)!;
  return NextResponse.json({ ...snapshot.job, tracks: snapshot.tracks });
}
