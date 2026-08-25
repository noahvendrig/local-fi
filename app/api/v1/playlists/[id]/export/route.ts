import { NextResponse } from "next/server";
import {
  contentDispositionAttachment,
  createPlaylistZipStream,
  preparePlaylistExport,
} from "@/lib/crates/exportPlaylist";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Playlist not found." } }, { status: 404 });

const EMPTY = NextResponse.json(
  { error: { code: "empty_playlist", message: "This crate has no tracks to export." } },
  { status: 400 }
);

const NO_FILES = NextResponse.json(
  { error: { code: "no_exportable_tracks", message: "None of this crate's tracks are available on disk." } },
  { status: 409 }
);

/** GET /api/v1/playlists/:id/export — zip of the crate folder with its audio files inside. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playlistId = Number(id);
  if (!Number.isInteger(playlistId)) return NOT_FOUND;

  const prepared = preparePlaylistExport(playlistId);
  if ("error" in prepared) {
    if (prepared.error === "not_found") return NOT_FOUND;
    if (prepared.error === "empty") return EMPTY;
    return NO_FILES;
  }

  const stream = createPlaylistZipStream(prepared.entries);
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": contentDispositionAttachment(prepared.zipFilename),
      "Cache-Control": "no-store",
    },
  });
}
