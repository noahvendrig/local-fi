import { NextResponse } from "next/server";
import { searchTracks, SpotifyConfigError, SpotifyNotConnectedError } from "@/lib/spotify/client";

/**
 * Catalog search for a single track by free-text query — used by the top search bar's
 * "not in your library" fallback (TopSearchBar.tsx). Unlike playlist reads, catalog search
 * works regardless of playlist ownership, so this only needs a connected user token.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ items: [] });
  }

  try {
    const items = await searchTracks(q);
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
