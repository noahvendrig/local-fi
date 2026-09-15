import { NextResponse } from "next/server";
import { isSpotifyConnected } from "@/lib/spotify/client";

export async function GET() {
  return NextResponse.json({ connected: isSpotifyConnected() });
}
