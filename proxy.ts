import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthorized } from "./lib/auth/verifyToken";

// Endpoints reachable with no token at all — narrowly, just the one a phone calls before it
// has ever been issued a device token (mobile plan Phase B). Everything else under
// /api/v1/pairing/* (start/status/devices) stays behind the normal check below: only the
// already-authenticated PC should be able to mint codes or manage/revoke paired devices.
const UNAUTHENTICATED_PATHS = new Set(["/api/v1/pairing/complete"]);

// Centralized auth gatekeeper for the API (ARCHITECTURE.md §8). proxy.ts can't
// return a JSON body itself, so on failure it rewrites to a Route Handler that can.
export function proxy(request: NextRequest) {
  if (UNAUTHENTICATED_PATHS.has(new URL(request.url).pathname)) {
    return NextResponse.next();
  }
  if (!isAuthorized(request)) {
    return NextResponse.rewrite(new URL("/api/unauthorized", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/v1/:path*",
};
