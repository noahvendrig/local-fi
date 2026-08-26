import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthorized } from "./lib/auth/verifyToken";

// Endpoints reachable with no token at all — narrowly, just the one a phone calls before it
// has ever been issued a device token (mobile plan Phase B). Everything else under
// /api/v1/pairing/* (start/status/devices) stays behind the normal check below: only the
// already-authenticated PC should be able to mint codes or manage/revoke paired devices.
const UNAUTHENTICATED_PATHS = new Set(["/api/v1/pairing/complete"]);

// CORS: the standalone PWA (served from a static host, not this PC) makes every /api/v1/* call
// cross-origin, including the pairing POST itself — without this, the browser blocks every
// response before any client code (however correctly it built the URL) ever sees it. Reflecting
// the request's own Origin back — rather than a fixed allowlist — is required here since the
// set of valid origins is unknowable in advance (any static host the app is deployed to, paired
// with any LAN address a PC happens to be reachable at). This is safe specifically because auth
// is a manually-attached Authorization header, never cookies: nothing here relies on credentialed
// CORS, which reflecting an arbitrary origin would otherwise be unsafe for. The existing LAN
// mobile/desktop view is unaffected — it's always same-origin, so the browser never even
// consults these headers there.
function withCorsHeaders(request: NextRequest, response: NextResponse): NextResponse {
  const origin = request.headers.get("origin");
  if (origin) response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.headers.set("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");
  return response;
}

// Centralized auth gatekeeper for the API (ARCHITECTURE.md §8). proxy.ts can't
// return a JSON body itself, so on failure it rewrites to a Route Handler that can.
export function proxy(request: NextRequest) {
  // A cross-origin preflight never carries the app's Authorization header — answering it here,
  // ahead of the auth check, is the whole point of preflight (the browser is asking permission
  // to send the real request, not making it yet).
  if (request.method === "OPTIONS") {
    return withCorsHeaders(request, new NextResponse(null, { status: 204 }));
  }
  if (UNAUTHENTICATED_PATHS.has(new URL(request.url).pathname)) {
    return withCorsHeaders(request, NextResponse.next());
  }
  if (!isAuthorized(request)) {
    return withCorsHeaders(request, NextResponse.rewrite(new URL("/api/unauthorized", request.url)));
  }
  return withCorsHeaders(request, NextResponse.next());
}

export const config = {
  matcher: "/api/v1/:path*",
};
