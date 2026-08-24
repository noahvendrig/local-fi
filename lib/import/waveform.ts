import { spawn } from "node:child_process";
import { getFfmpegPath } from "../ffmpeg";

// Fixed peak count keeps scrubber density consistent across track lengths and
// bounds .lfpk size predictably (ARCHITECTURE.md §3.5).
export const WAVEFORM_PEAK_COUNT = 1600;

// A coarse mono decode is plenty for a min/max peak bar and keeps ffmpeg's
// stdout (and the memory this pass touches) small regardless of source quality.
const DECODE_SAMPLE_RATE = 8000;

const LFPK_MAGIC = Buffer.from("LFPK", "ascii");

export interface WaveformResult {
  /** Full binary .lfpk file contents, ready to write to disk as-is. */
  buffer: Buffer;
  /** Mean absolute amplitude across the whole track, scaled to [0,1]. */
  avgLevel: number;
  peakCount: number;
}

/**
 * Decodes `inputPath` to raw PCM via ffmpeg and buckets it into WAVEFORM_PEAK_COUNT
 * min/max peak pairs, streaming the decode so we never hold full decoded audio in
 * memory (ARCHITECTURE.md §6).
 */
export function generateWaveform(inputPath: string, durationSeconds: number): Promise<WaveformResult> {
  return new Promise((resolve, reject) => {
    const totalSamples = Math.max(1, Math.round(durationSeconds * DECODE_SAMPLE_RATE));
    const samplesPerBucket = totalSamples / WAVEFORM_PEAK_COUNT;

    const mins = new Int8Array(WAVEFORM_PEAK_COUNT).fill(127);
    const maxs = new Int8Array(WAVEFORM_PEAK_COUNT).fill(-128);
    const bucketHasData = new Uint8Array(WAVEFORM_PEAK_COUNT);

    let sampleIndex = 0;
    let absSum = 0;
    let leftover: Buffer | null = null;
    let settled = false;

    const ffmpeg = spawn(
      /* turbopackIgnore: true */ getFfmpegPath(),
      ["-v", "error", "-i", inputPath, "-f", "s16le", "-ac", "1", "-ar", String(DECODE_SAMPLE_RATE), "pipe:1"],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let stderr = "";
    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      const data = leftover ? Buffer.concat([leftover, chunk]) : chunk;
      leftover = null;
      const usableLength = data.length - (data.length % 2);
      if (usableLength < data.length) {
        leftover = data.subarray(usableLength);
      }
      for (let offset = 0; offset < usableLength; offset += 2) {
        const sample = data.readInt16LE(offset);
        const scaled = sample >> 8; // int16 -> int8, arithmetic shift preserves sign
        const bucket = Math.min(WAVEFORM_PEAK_COUNT - 1, Math.floor(sampleIndex / samplesPerBucket));
        if (scaled < mins[bucket]) mins[bucket] = scaled;
        if (scaled > maxs[bucket]) maxs[bucket] = scaled;
        bucketHasData[bucket] = 1;
        absSum += Math.abs(scaled);
        sampleIndex++;
      }
    });

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
      if (sampleIndex === 0) {
        settled = true;
        reject(new Error("ffmpeg produced no decodable audio samples"));
        return;
      }
      settled = true;

      // Carry the last real value forward into any bucket the stream never touched
      // (e.g. a slightly-shorter-than-tagged tail), so gaps read as flat, not silent-zero.
      let lastMin = 0;
      let lastMax = 0;
      for (let i = 0; i < WAVEFORM_PEAK_COUNT; i++) {
        if (bucketHasData[i]) {
          lastMin = mins[i];
          lastMax = maxs[i];
        } else {
          mins[i] = lastMin;
          maxs[i] = lastMax;
        }
      }

      const header = Buffer.alloc(16);
      LFPK_MAGIC.copy(header, 0);
      header.writeUInt8(1, 4);
      header.writeUInt8(0, 5);
      header.writeUInt16LE(0, 6);
      header.writeUInt32LE(WAVEFORM_PEAK_COUNT, 8);
      header.writeFloatLE(durationSeconds, 12);

      const peaks = Buffer.alloc(WAVEFORM_PEAK_COUNT * 2);
      for (let i = 0; i < WAVEFORM_PEAK_COUNT; i++) {
        peaks.writeInt8(mins[i], i * 2);
        peaks.writeInt8(maxs[i], i * 2 + 1);
      }

      resolve({
        buffer: Buffer.concat([header, peaks]),
        avgLevel: absSum / sampleIndex / 127,
        peakCount: WAVEFORM_PEAK_COUNT,
      });
    });
  });
}
