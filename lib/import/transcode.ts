import { spawn } from "node:child_process";
import { getFfmpegPath } from "../ffmpeg";
import type { ExtractedTags } from "./tags";

/** Opus VBR target — perceptually transparent for most listeners while cutting file size
 *  far below typical lossless or high-bitrate lossy sources. */
export const COMPRESS_BITRATE_KBPS = 160;

/** Re-encoding an already-lossy file that's at or under the target would only add a second
 *  lossy generation for little or no size saving, so only compress lossless sources or
 *  lossy sources encoded well above the target. */
export function shouldCompress(tags: Pick<ExtractedTags, "lossless" | "bitrate">): boolean {
  if (tags.lossless) return true;
  return tags.bitrate != null && tags.bitrate > COMPRESS_BITRATE_KBPS * 1000;
}

/**
 * Re-encodes `inputPath` to Opus at `outputPath`. Strips all streams and metadata
 * (-vn -map_metadata -1) since ffmpeg can't carry a picture stream into an Ogg
 * container — callers re-embed cover art and tags afterward via node-taglib-sharp.
 */
export function transcodeToOpus(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      /* turbopackIgnore: true */ getFfmpegPath(),
      ["-v", "error", "-y", "-i", inputPath, "-vn", "-map_metadata", "-1", "-c:a", "libopus", "-b:a", `${COMPRESS_BITRATE_KBPS}k`, outputPath],
      { stdio: ["ignore", "ignore", "pipe"] }
    );

    let stderr = "";
    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code !== 0) reject(new Error(`ffmpeg compress failed with code ${code}: ${stderr.trim() || "no output"}`));
      else resolve();
    });
  });
}
