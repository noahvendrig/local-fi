import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { tracks } from "@/lib/db/schema";
import { contentTypeForFormat } from "@/lib/media/audioContentType";
import { resolveTrackAbsPath } from "@/lib/storage/resolveTrackPath";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Track not found." } }, { status: 404 });

function rangeNotSatisfiable(size: number) {
  return NextResponse.json(
    { error: { code: "invalid_range", message: "Requested range is not satisfiable." } },
    { status: 416, headers: { "Content-Range": `bytes */${size}` } }
  );
}

/** GET /api/v1/tracks/:id/stream — audio bytes with real HTTP Range support (ARCHITECTURE.md §7). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId)) return NOT_FOUND;

  const track = getDb()
    .select({ path: tracks.path, libraryRootId: tracks.libraryRootId, format: tracks.format })
    .from(tracks)
    .where(and(eq(tracks.id, trackId), isNull(tracks.deletedAt), isNull(tracks.missingSince)))
    .get();
  if (!track) return NOT_FOUND;

  let absPath: string;
  try {
    absPath = resolveTrackAbsPath(track);
  } catch {
    return NOT_FOUND;
  }
  if (!existsSync(absPath)) return NOT_FOUND;

  const { size } = statSync(absPath);
  const contentType = contentTypeForFormat(track.format);
  const rangeHeader = request.headers.get("range");

  const baseHeaders = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=604800",
  };

  if (!rangeHeader) {
    const stream = Readable.toWeb(createReadStream(absPath)) as ReadableStream;
    return new Response(stream, {
      status: 200,
      headers: { ...baseHeaders, "Content-Length": String(size) },
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return rangeNotSatisfiable(size);
  const [, startStr, endStr] = match;
  if (startStr === "" && endStr === "") return rangeNotSatisfiable(size);

  let start: number;
  let end: number;
  if (startStr === "") {
    // Suffix range ("bytes=-500" => last 500 bytes).
    const suffixLength = Number(endStr);
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === "" ? size - 1 : Number(endStr);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || end >= size) {
    return rangeNotSatisfiable(size);
  }

  const stream = Readable.toWeb(createReadStream(absPath, { start, end })) as ReadableStream;
  return new Response(stream, {
    status: 206,
    headers: {
      ...baseHeaders,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
    },
  });
}
