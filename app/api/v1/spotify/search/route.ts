import { NextResponse } from "next/server";
import { searchTracks, SpotifyConfigError, SpotifyNotConnectedError } from "@/lib/spotify/client";

/**
 * Catalog search for a single track by free-text query — used by the top search bar's
 * "not in your library" fallback (TopSearchBar.tsx). Unlike playlist reads, catalog search
 * works regardless of playlist ownership, so this only needs a connected user token.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = params.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ items: [] });
  }

  // Spotify's search endpoint 400s ("Invalid limit") above 10 — verified empirically against
  // the live API, despite the Web API docs' documented range of 1-50.
  const rawLimit = Number(params.get("limit"));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 10) : undefined;

  try {
    const items = await searchTracks(q, limit);
    return NextResponse.json({ items });
  } catch (err) {
    if (err instanceof SpotifyConfigError) {
      return NextResponse.json({ error: { code: "spotify_not_configured", message: err.message } }, { status: 503 });
    }
    if (err instanceof SpotifyNotConnectedError) {
      return NextResponse.json({ error: { code: "spotify_not_connected", message: err.message } }, { status: 401 });
    }
    return NextResponse.json(
      {
        error: {
          code: "spotify_error",
          message: err instanceof Error ? err.message : "Could not search Spotify.",
        },
      },
      { status: 502 }
    );
  }
}
