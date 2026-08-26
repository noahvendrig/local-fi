import type { TrackSummary } from "@/lib/api-client";
import type { EqState } from "@/lib/audio/eqConfig";
import { apiUrl, authHeaders } from "./http";

export type RepeatMode = "off" | "all" | "one";

export interface PlaybackStateDTO {
  sessionKey: string;
  queue: TrackSummary[];
  currentIndex: number;
  positionSeconds: number;
  isPlaying: boolean;
  volume: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
  eq: EqState;
  updatedAt: string | null;
}

export interface PlaybackStatePatch {
  queue?: number[];
  currentIndex?: number;
  positionSeconds?: number;
  isPlaying?: boolean;
  volume?: number;
  repeatMode?: RepeatMode;
  shuffle?: boolean;
  eq?: EqState;
}

export async function fetchPlaybackState(): Promise<PlaybackStateDTO> {
  const res = await fetch(apiUrl("/api/v1/playback-state"), { headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch playback state (${res.status})`);
  return res.json();
}

export async function putPlaybackState(patch: PlaybackStatePatch): Promise<PlaybackStateDTO> {
  const res = await fetch(apiUrl("/api/v1/playback-state"), {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Failed to persist playback state (${res.status})`);
  return res.json();
}
