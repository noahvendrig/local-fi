import { NextResponse } from "next/server";

// Internal rewrite target — proxy.ts routes unauthenticated /api/v1/* requests
// here because proxy itself cannot return a JSON body (ARCHITECTURE.md §8).
// Deliberately not "_unauthorized": a `_`-prefixed folder is a Next.js private
// folder and is excluded from routing, which would 404 instead of resolving.
export function GET() {
  return NextResponse.json(
    { error: { code: "unauthorized", message: "Missing or invalid bearer token." } },
    { status: 401 }
  );
}

export {
  GET as POST,
  GET as PUT,
  GET as PATCH,
  GET as DELETE,
  GET as HEAD,
  GET as OPTIONS,
};
