// Client-side parser for the .lfpk sidecar format (ARCHITECTURE.md §3.5).
// Mirrors the writer at lib/import/waveform.ts byte-for-byte.

export interface WaveformData {
  peakCount: number;
  durationSeconds: number;
  /** Per-bucket amplitude, scaled to [-1, 1]. */
  mins: Float32Array;
  maxs: Float32Array;
}

const LFPK_MAGIC = "LFPK";

export function parseWaveform(buffer: ArrayBuffer): WaveformData {
  const view = new DataView(buffer);

  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== LFPK_MAGIC) throw new Error("Invalid .lfpk file: bad magic bytes.");

  const version = view.getUint8(4);
  if (version !== 1) throw new Error(`Unsupported .lfpk version: ${version}`);

  const peakCount = view.getUint32(8, true);
  const durationSeconds = view.getFloat32(12, true);

  const mins = new Float32Array(peakCount);
  const maxs = new Float32Array(peakCount);
  for (let i = 0; i < peakCount; i++) {
    mins[i] = view.getInt8(16 + i * 2) / 127;
    maxs[i] = view.getInt8(16 + i * 2 + 1) / 127;
  }

  return { peakCount, durationSeconds, mins, maxs };
}

export async function fetchWaveform(url: string): Promise<WaveformData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch waveform (${res.status})`);
  return parseWaveform(await res.arrayBuffer());
}
