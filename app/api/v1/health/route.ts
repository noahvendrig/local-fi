import { NextResponse } from "next/server";
import { isDbReachable } from "@/lib/db/client";
import { isDataDirWritable } from "@/lib/storage/dataDir";
import { isFfmpegAvailable } from "@/lib/ffmpeg";

export async function GET() {
  return NextResponse.json({
    ffmpeg: isFfmpegAvailable(),
    db: isDbReachable(),
    dataDir: isDataDirWritable(),
  });
}
