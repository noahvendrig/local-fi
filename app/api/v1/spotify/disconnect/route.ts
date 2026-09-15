import { NextResponse } from "next/server";
import { disconnectSpotify } from "@/lib/spotify/client";

export async function POST() {
  disconnectSpotify();
  return NextResponse.json({ connected: false });
}
