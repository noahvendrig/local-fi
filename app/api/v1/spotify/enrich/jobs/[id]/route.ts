import { NextResponse } from "next/server";
import { loadSpotifyEnrichJobSnapshot } from "@/lib/spotify/enrichEvents";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snapshot = loadSpotifyEnrichJobSnapshot(Number(id));

  if (!snapshot) {
    return NextResponse.json({ error: { code: "not_found", message: "Spotify enrich job not found." } }, { status: 404 });
  }

  return NextResponse.json({ ...snapshot.job, tracks: snapshot.tracks });
}
