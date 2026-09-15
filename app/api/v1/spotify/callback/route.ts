import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { completeLogin } from "@/lib/spotify/client";

/**
 * Step 2: Spotify redirects the user's browser here after they grant (or deny) access.
 * Listed in proxy.ts's UNAUTHENTICATED_PATHS since this is Spotify's own top-level
 * navigation back to us, not a request our client code can attach auth to — protected
 * instead by the one-time `code` plus the `state`/cookie pair set by /spotify/login.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const deniedReason = url.searchParams.get("error");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("spotify_oauth_state")?.value;
  cookieStore.delete("spotify_oauth_state");

  const redirectTo = new URL("/settings", url.origin);

  if (deniedReason) {
    redirectTo.searchParams.set("spotify", "denied");
    return NextResponse.redirect(redirectTo);
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    redirectTo.searchParams.set("spotify", "error");
    return NextResponse.redirect(redirectTo);
  }

  try {
    await completeLogin(code);
    redirectTo.searchParams.set("spotify", "connected");
  } catch {
    redirectTo.searchParams.set("spotify", "error");
  }
  return NextResponse.redirect(redirectTo);
}
