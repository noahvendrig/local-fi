import { NextResponse } from "next/server";
import { isDbReachable } from "@/lib/db/client";
import { isDataDirWritable } from "@/lib/storage/dataDir";
import { isFfmpegAvailable } from "@/lib/ffmpeg";
import { isPythonBackendAvailable } from "@/lib/pythonBackend/process";

export async function GET() {
  return NextResponse.json({
    ffmpeg: isFfmpegAvailable(),
    db: isDbReachable(),
    dataDir: isDataDirWritable(),
    pythonBackend: await isPythonBackendAvailable(),
  });
}
