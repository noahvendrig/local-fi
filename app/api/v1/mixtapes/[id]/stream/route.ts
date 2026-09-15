import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { mixtapes } from "@/lib/db/schema";
import { contentTypeForFormat } from "@/lib/media/audioContentType";
import { nodeStreamToWebStream } from "@/lib/media/nodeStream";
import { getDataDir } from "@/lib/storage/dataDir";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Mixtape not found." } }, { status: 404 });

function rangeNotSatisfiable(size: number) {
  return NextResponse.json(
    { error: { code: "invalid_range", message: "Requested range is not satisfiable." } },
    { status: 416, headers: { "Content-Range": `bytes */${size}` } }
  );
}

/** GET /api/v1/mixtapes/:id/stream — audio bytes with HTTP Range support (mirrors tracks/:id/stream). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mixtapeId = Number(id);
  if (!Number.isInteger(mixtapeId)) return NOT_FOUND;

  const mixtape = getDb()
    .select({ path: mixtapes.path, format: mixtapes.format })
    .from(mixtapes)
    .where(eq(mixtapes.id, mixtapeId))
    .get();
  if (!mixtape) return NOT_FOUND;

  const absPath = path.join(getDataDir(), mixtape.path);
  if (!existsSync(absPath)) return NOT_FOUND;

  const { size } = statSync(absPath);
  const contentType = contentTypeForFormat(mixtape.format);
  const rangeHeader = request.headers.get("range");

  const baseHeaders = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=604800",
  };

  if (!rangeHeader) {
    const stream = nodeStreamToWebStream(createReadStream(absPath));
    return new Response(stream, { status: 200, headers: { ...baseHeaders, "Content-Length": String(size) } });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return rangeNotSatisfiable(size);
  const [, startStr, endStr] = match;
  if (startStr === "" && endStr === "") return rangeNotSatisfiable(size);

  let start: number;
  let end: number;
  if (startStr === "") {
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

  const stream = nodeStreamToWebStream(createReadStream(absPath, { start, end }));
  return new Response(stream, {
    status: 206,
    headers: { ...baseHeaders, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
  });
}
