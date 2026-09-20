import { NextResponse } from "next/server";
import { loadMusicbrainzEnrichJobSnapshot } from "@/lib/musicbrainz/enrichEvents";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snapshot = loadMusicbrainzEnrichJobSnapshot(Number(id));

  if (!snapshot) {
    return NextResponse.json({ error: { code: "not_found", message: "MusicBrainz enrich job not found." } }, { status: 404 });
  }

  return NextResponse.json({ ...snapshot.job, tracks: snapshot.tracks });
}
