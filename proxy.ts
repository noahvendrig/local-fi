import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthorized } from "./lib/auth/verifyToken";

// Centralized auth gatekeeper for the API (ARCHITECTURE.md §8). proxy.ts can't
// return a JSON body itself, so on failure it rewrites to a Route Handler that can.
export function proxy(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.rewrite(new URL("/api/unauthorized", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/v1/:path*",
};
