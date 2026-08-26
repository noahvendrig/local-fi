import { streamUrl, waveformUrl, type TrackSummary } from "@/lib/api-client";
import { fetchWaveform, parseWaveform, type WaveformData } from "@/lib/waveform/parse";
import { readBlob } from "./blobs";

/**
 * Resolves what an `<audio>` element's `src` should be for a track — the audio-engine seam
 * (mobile plan Phase E). Checks the offline cache (Phase C copies, Phase D local imports) first;
 * a local-only track (negative id, from Phase D2) has no server row at all, so there's nothing
 * to fall back to if its blob is somehow missing. A synced track (positive id) falls back to the
 * live network stream, exactly matching today's online-only behavior when nothing's cached.
 * Returns an object URL for a cached blob — the caller owns revoking it once the track changes
 * (see usePlaybackEngine.ts's revokeDeckBlobUrl), since `streamUrl()`'s plain string never
 * needed that but a Blob URL leaks GPU/memory-backed resources if left unrevoked.
 */
export async function resolvePlaybackSrc(track: TrackSummary): Promise<string> {
  const blob = await readBlob(track.id, "audio").catch(() => undefined);
  if (blob) return URL.createObjectURL(blob);
  if (track.id < 0) throw new Error("This track isn't available offline.");
  return streamUrl(track.id);
}

/**
 * Same idea for the waveform sidecar — cached bytes parse identically to a network fetch since
 * `.lfpk` is just bytes regardless of source (lib/waveform/parse.ts's own note). Returns null,
 * not a rejected promise, for "no waveform available" (never generated for a local import, or
 * genuinely offline with nothing cached) — WaveformScrubber already renders a flat idle line for
 * a null waveform, the same fallback it already uses for a track mid-analysis.
 */
export async function resolveWaveform(track: TrackSummary): Promise<WaveformData | null> {
  const blob = await readBlob(track.id, "waveform").catch(() => undefined);
  if (blob) {
    try {
      return parseWaveform(await blob.arrayBuffer());
    } catch {
      return null;
    }
  }
  if (track.id < 0) return null;
  try {
    return await fetchWaveform(waveformUrl(track.id));
  } catch {
    return null;
  }
}
