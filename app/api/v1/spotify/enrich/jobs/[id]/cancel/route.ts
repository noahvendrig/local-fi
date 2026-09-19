import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { spotifyEnrichJobs } from "@/lib/db/schema";
import { loadSpotifyEnrichJobSnapshot } from "@/lib/spotify/enrichEvents";
import { requestSpotifyEnrichJobCancellation } from "@/lib/spotify/enrichQueue";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  const db = getDb();
  const job = db.select().from(spotifyEnrichJobs).where(eq(spotifyEnrichJobs.id, jobId)).get();

  if (!job) {
    return NextResponse.json({ error: { code: "not_found", message: "Spotify enrich job not found." } }, { status: 404 });
  }

  if (job.status === "pending") {
    requestSpotifyEnrichJobCancellation(jobId);
    db.update(spotifyEnrichJobs).set({ status: "cancelled", finishedAt: new Date().toISOString() }).where(eq(spotifyEnrichJobs.id, jobId)).run();
  } else if (job.status === "running") {
    requestSpotifyEnrichJobCancellation(jobId);
  }

  const snapshot = loadSpotifyEnrichJobSnapshot(jobId)!;
  return NextResponse.json({ ...snapshot.job, tracks: snapshot.tracks });
}
