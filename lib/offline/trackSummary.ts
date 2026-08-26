import type { TrackSummary } from "@/lib/api-client";
import type { OfflineTrack } from "./db";

/**
 * Shapes a cached/local track into a TrackSummary so it can go through `playTrack()`/the queue
 * exactly like a live-library track — no separate "offline player" code path. Fields with no
 * offline equivalent (artist/album links, bitrate/sampleRate/bitDepth badges, loudness-match
 * data, DJ bpm/key) are null; each already has an established graceful-degradation path in the
 * UI (badges just don't render, loudnessGain(null, …) no-ops) rather than a new one invented
 * here. `coverArtUrl` is deliberately null even when `hasCover` is true — the UI's existing
 * `withAuthQuery(coverArtUrl)` call sites assume a fetchable server URL and would corrupt a
 * `blob:` one by appending `?token=`; wiring offline cover art through every one of those call
 * sites is a larger, separate change, not part of the audio-engine seam this converter serves.
 */
export function offlineTrackToSummary(track: OfflineTrack): TrackSummary {
  return {
    id: track.id,
    uuid: track.uuid,
    title: track.title,
    artistId: null,
    artistName: track.artistName,
    albumId: null,
    albumTitle: track.albumTitle,
    trackNumber: null,
    discNumber: null,
    durationSeconds: track.durationSeconds,
    format: track.format,
    lossless: track.lossless,
    bitrate: null,
    sampleRate: null,
    bitDepth: null,
    coverArtUrl: null,
    dateAdded: track.addedAt,
    missing: false,
    waveformAvgLevel: null,
    bpm: null,
    key: null,
    analysisStatus: "none",
  };
}
