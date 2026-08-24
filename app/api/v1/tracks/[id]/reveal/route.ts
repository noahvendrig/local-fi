import { spawn } from "node:child_process";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { tracks } from "@/lib/db/schema";
import { getDataDir } from "@/lib/storage/dataDir";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Track not found." } }, { status: 404 });

function isLocalhostRequest(request: Request): boolean {
  const hostname = (request.headers.get("host") ?? "").split(":")[0];
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function revealInOsFileExplorer(absPath: string): void {
  // explorer.exe /select often exits non-zero even on success — detached + unref, never awaited.
  if (process.platform === "win32") {
    spawn("explorer.exe", [`/select,${absPath}`], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", ["-R", absPath], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [path.dirname(absPath)], { detached: true, stdio: "ignore" }).unref();
  }
}

/**
 * POST /api/v1/tracks/:id/reveal — opens the OS file explorer at the track's location.
 * Desktop-only affordance (ARCHITECTURE.md M8): gated to localhost since it shells out
 * on the server, which is only safe to expose when nothing outside this machine can hit it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isLocalhostRequest(request)) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "Reveal-in-folder is only available when served on localhost." } },
      { status: 403 }
    );
  }

  const { id } = await params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId)) return NOT_FOUND;

  const track = getDb()
    .select({ path: tracks.path })
    .from(tracks)
    .where(and(eq(tracks.id, trackId), isNull(tracks.deletedAt)))
    .get();
  if (!track) return NOT_FOUND;

  const absPath = path.join(getDataDir(), track.path);

  try {
    revealInOsFileExplorer(absPath);
  } catch (err) {
    return NextResponse.json(
      { error: { code: "reveal_failed", message: err instanceof Error ? err.message : "Failed to open file explorer." } },
      { status: 500 }
    );
  }

  return new NextResponse(null, { status: 204 });
}
