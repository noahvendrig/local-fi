import { spawnSync } from "node:child_process";

/** Resolved ffmpeg binary path — system PATH by default, LOCALFI_FFMPEG_PATH to override (ARCHITECTURE.md §6). */
export function getFfmpegPath(): string {
  return process.env.LOCALFI_FFMPEG_PATH ?? "ffmpeg";
}

export function isFfmpegAvailable(): boolean {
  const result = spawnSync(/* turbopackIgnore: true */ getFfmpegPath(), ["-version"], {
    stdio: "ignore",
  });
  return result.status === 0;
}
