import { getPlaybackEqualizer } from "./equalizer";

/**
 * Fetches an audio URL (a stem WAV from the AI DJ proxy routes, or a plain track stream for the
 * whole-track fallback path) and decodes it into an AudioBuffer against the shared AudioContext,
 * so it's immediately playable via PlaybackEqualizer's startAiDjStem.
 */
export async function decodeStemBuffer(url: string, signal?: AbortSignal): Promise<AudioBuffer> {
  const ctx = getPlaybackEqualizer().ensureAudioContext();
  if (!ctx) throw new Error("Web Audio is not available in this environment.");

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Failed to fetch stem audio (HTTP ${res.status}).`);
  const arrayBuffer = await res.arrayBuffer();
  return ctx.decodeAudioData(arrayBuffer);
}
