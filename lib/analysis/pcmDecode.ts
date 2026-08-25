import { spawn } from "node:child_process";
import { getFfmpegPath } from "../ffmpeg";

/** Matches music-tempo's implicit hop-size assumptions and gives key detection plenty of resolution. */
export const ANALYSIS_SAMPLE_RATE = 44100;

/**
 * Decodes `inputPath` to full-resolution mono float32 PCM via ffmpeg, buffered whole in memory —
 * unlike lib/import/waveform.ts's streaming peak-bucketing, both music-tempo and the key detector
 * need the complete sample array up front, and a few minutes of mono float32 audio is small
 * enough (tens of MB) to hold transiently for a single track's analysis pass.
 */
export function decodeMonoPcmF32(inputPath: string, sampleRate: number = ANALYSIS_SAMPLE_RATE): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let stderr = "";
    let settled = false;

    const ffmpeg = spawn(
      /* turbopackIgnore: true */ getFfmpegPath(),
      ["-v", "error", "-i", inputPath, "-f", "f32le", "-ac", "1", "-ar", String(sampleRate), "pipe:1"],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));

    ffmpeg.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    ffmpeg.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        settled = true;
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim() || "no output"}`));
        return;
      }
      settled = true;
      const buffer = Buffer.concat(chunks);
      const sampleCount = Math.floor(buffer.length / 4);
      const samples = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) samples[i] = buffer.readFloatLE(i * 4);
      resolve(samples);
    });
  });
}
