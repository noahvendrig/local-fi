import { streamUrl, waveformUrl, type TrackSummary } from "@/lib/api-client";
import { withAuthQuery } from "@/lib/api/http";
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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("failed to read cover blob"));
    reader.readAsDataURL(blob);
  });
}

function guessImageType(url: string): string {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "avif") return "image/avif";
  return "image/jpeg";
}

/**
 * Resolves cover art for `navigator.mediaSession` metadata — the artwork seam that mirrors
 * resolvePlaybackSrc's offline-first order. A cached `cover` blob (Phase C copies / Phase D
 * imports, the only art an offline-only track has since its coverArtUrl is null) becomes a
 * `data:` URL — small enough not to matter, and unlike `blob:` URLs it's reliably accepted as
 * artwork by iOS Safari and Firefox. A synced track with no cached cover falls back to the
 * authenticated stream URL, made absolute so the standalone PWA resolves it against the paired
 * PC rather than its own static-host origin (CORS for /api/v1/* is already reflected by proxy.ts).
 */
export async function resolveArtworkSrc(track: TrackSummary): Promise<{ src: string; type: string } | null> {
  const blob = await readBlob(track.id, "cover").catch(() => undefined);
  if (blob) {
    try {
      return { src: await blobToDataUrl(blob), type: blob.type || "image/jpeg" };
    } catch {
      // fall through to the network URL
    }
  }
  if (track.coverArtUrl) {
    const src = new URL(withAuthQuery(track.coverArtUrl), window.location.origin).toString();
    return { src, type: guessImageType(track.coverArtUrl) };
  }
  return null;
}
