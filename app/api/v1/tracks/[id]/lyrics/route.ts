import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { getTrackDetailRow } from "@/lib/db/trackDetail";
import { fetchLyrics } from "@/lib/lyrics/lrclib";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Track not found." } }, { status: 404 });

/** GET /api/v1/tracks/:id/lyrics — synced/plain lyrics for one track, via LRCLIB (see
 *  lib/lyrics/lrclib.ts). Always 200s with `{ found: false }` when nothing usable turned up
 *  (missing title/artist, no LRCLIB match, instrumental, ...) — the Now Playing view greys out
 *  its Lyrics button on that response rather than treating it as an error. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId)) return NOT_FOUND;

  const row = getTrackDetailRow(getDb(), trackId);
  if (!row) return NOT_FOUND;
  if (!row.title || !row.artistName) return NextResponse.json({ found: false });

  const result = await fetchLyrics({
    title: row.title,
    artist: row.artistName,
    album: row.albumTitle,
    durationSeconds: row.durationSeconds,
  });

  if (!result) return NextResponse.json({ found: false });
  return NextResponse.json({ found: true, synced: result.synced, plain: result.plain });
}
