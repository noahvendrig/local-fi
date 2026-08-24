import type { TrackSummary } from "@/lib/api-client";
import { authHeaders } from "./http";

export interface HomeStat {
  label: string;
  value: string;
  meta: string;
}

export interface HomeTopTrack {
  rank: number;
  plays: number;
  barW: number;
  track: TrackSummary;
}

export interface HomeBackInRotationTrack {
  meta: string;
  track: TrackSummary;
}

export interface HomeTopArtist {
  artistId: number;
  name: string;
  plays: number;
  barW: number;
}

export interface HomeDay {
  date: string;
  label: string;
  plays: number;
  h: number;
}

export interface HomeFormat {
  format: string;
  plays: number;
  pct: number;
}

export interface HomeStatsDTO {
  rangeLabel: string;
  stats: HomeStat[];
  top5: HomeTopTrack[];
  backInRotation: HomeBackInRotationTrack[];
  topArtists: HomeTopArtist[];
  days: HomeDay[];
  formats: HomeFormat[];
}

export async function fetchHomeStats(): Promise<HomeStatsDTO> {
  const res = await fetch("/api/v1/home", { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Failed to fetch home stats (${res.status})`);
  }
  return res.json();
}
