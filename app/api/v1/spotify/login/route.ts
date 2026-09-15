import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthorizeUrl, SpotifyConfigError } from "@/lib/spotify/client";

/**
 * Step 1 of the one-time Spotify login: redirects the browser to Spotify's consent
 * screen. Reached via a plain link click from Settings (see SettingsView.tsx), so it's
 * a full navigation, not a fetch — proxy.ts's normal ?token= auth still applies here
 * (unlike the callback below, which Spotify itself navigates back to).
 */
export async function GET(request: Request) {
  const state = randomBytes(16).toString("hex");

  let authorizeUrl: string;
  try {
    authorizeUrl = getAuthorizeUrl(state);
  } catch (err) {
    if (err instanceof SpotifyConfigError) {
      return NextResponse.redirect(new URL("/settings?spotify=config_missing", request.url));
    }
    throw err;
  }

  const cookieStore = await cookies();
  cookieStore.set("spotify_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return NextResponse.redirect(authorizeUrl);
}
