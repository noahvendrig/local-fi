import { useAuthStore } from "@/lib/store/auth";
import { useDeviceStore } from "@/lib/store/device";
import { apiUrl, authHeaders, withAuthQuery } from "./http";

/** Thrown by submitSpotifyImport (importClient.ts) when the server reports no Spotify
 *  login is on file yet — callers use this to show a "Connect Spotify" prompt instead
 *  of a raw error message. */
export class SpotifyNotConnectedError extends Error {}

export async function fetchSpotifyStatus(): Promise<boolean> {
  const res = await fetch(apiUrl("/api/v1/spotify/status"), { headers: authHeaders() });
  if (!res.ok) return false;
  const body = (await res.json()) as { connected: boolean };
  return body.connected;
}

/** Full-navigation URL for the "Connect Spotify" link/button — not a fetch, the browser
 *  is sent here directly so Spotify's own consent screen can take over. */
export function spotifyLoginUrl(): string {
  return withAuthQuery("/api/v1/spotify/login");
}

/** Reactive form of spotifyLoginUrl() for use in JSX `href`s. The static token is seeded
 *  asynchronously (AuthTokenProvider's useEffect, after first render) — computing the URL
 *  via plain spotifyLoginUrl() inside JSX bakes in an empty "?token=" from that first render
 *  and never updates, since a bare getState() read doesn't subscribe. Subscribing to both
 *  token sources here forces the re-render that picks up the real token once it lands. */
export function useSpotifyLoginUrl(): string {
  useAuthStore((s) => s.token);
  useDeviceStore((s) => s.device?.deviceToken);
  return spotifyLoginUrl();
}

export async function disconnectSpotify(): Promise<void> {
  const res = await fetch(apiUrl("/api/v1/spotify/disconnect"), { method: "POST", headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to disconnect Spotify (${res.status})`);
}
