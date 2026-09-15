// Server-side Spotify Web API client. Playlist track reads require a real user to have
// granted access (Authorization Code flow) — Spotify no longer allows the Client
// Credentials (app-only) flow to read playlist contents at all, even for a user's own
// public playlist (only catalog-level lookups like a playlist's name still work that
// way). So this authenticates as the user who completed the one-time "Connect Spotify"
// login (see the /api/v1/spotify/* routes), refreshing their access token as needed.
// Note that even with a user token, Spotify now only returns contents for playlists that
// user owns — see the 403 handling in spotifyGet() for what that means for imports.
// Requires SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET, set once the user registers a free
// app at developer.spotify.com.

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { getSpotifyRefreshTokenPath } from "../storage/dataDir";

export interface SpotifyTrackMetadata {
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number;
  coverArtUrl: string | null;
  /** open.spotify.com track link — stored as tracks.sourceUrl provenance once imported. */
  spotifyUrl: string;
}

export class SpotifyConfigError extends Error {}
export class InvalidPlaylistUrlError extends Error {}
/** No refresh token on disk yet — the user needs to complete GET /api/v1/spotify/login once. */
export class SpotifyNotConnectedError extends Error {}

const SCOPES = "playlist-read-private playlist-read-collaborative";

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new SpotifyConfigError(
      "SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET are not set — register a free app at developer.spotify.com and add them to .env."
    );
  }
  return { clientId, clientSecret };
}

function getRedirectUri(): string {
  return process.env.SPOTIFY_REDIRECT_URI ?? "http://127.0.0.1:3000/api/v1/spotify/callback";
}

export function isSpotifyConnected(): boolean {
  return loadRefreshToken() != null;
}

function loadRefreshToken(): string | null {
  try {
    const token = readFileSync(getSpotifyRefreshTokenPath(), "utf8").trim();
    return token || null;
  } catch {
    return null;
  }
}

function saveRefreshToken(token: string): void {
  writeFileSync(getSpotifyRefreshTokenPath(), token, { mode: 0o600 });
}

export function disconnectSpotify(): void {
  tokenCache = null;
  try {
    rmSync(getSpotifyRefreshTokenPath());
  } catch {
    // Already disconnected.
  }
}

/** Step 1 of the login flow — where the user's browser is sent to grant access. */
export function getAuthorizeUrl(state: string): string {
  const { clientId } = getCredentials();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: getRedirectUri(),
    state,
    // Spotify silently reuses a prior consent grant (skipping the approval screen entirely)
    // whenever this app+scopes combo was already approved — which made "Disconnect" then
    // "Connect" again look like a no-op even though a fresh token was in fact issued, with no
    // way to tell the reconnect had happened. Forcing the dialog makes it visible, and lets the
    // user pick an account when they're signed into more than one.
    show_dialog: "true",
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

/** Step 2 — the callback route exchanges the returned code for tokens and persists the refresh token. */
export async function completeLogin(code: string): Promise<void> {
  const { clientId, clientSecret } = getCredentials();
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: getRedirectUri() }).toString(),
  });

  if (!res.ok) {
    throw new SpotifyConfigError(`Spotify login failed (HTTP ${res.status}) — try connecting again.`);
  }

  const body = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  saveRefreshToken(body.refresh_token);
  tokenCache = { accessToken: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now) return tokenCache.accessToken;

  const refreshToken = loadRefreshToken();
  if (!refreshToken) {
    throw new SpotifyNotConnectedError("Connect your Spotify account first (Settings → Spotify).");
  }

  const { clientId, clientSecret } = getCredentials();
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
  });

  if (!res.ok) {
    // A revoked/expired refresh token also lands here — treat it the same as "never connected"
    // so the caller shows a reconnect prompt instead of a raw Spotify error.
    throw new SpotifyNotConnectedError("Your Spotify connection expired — reconnect it in Settings.");
  }

  const body = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
  // Refresh a little early so a token never expires mid-request.
  tokenCache = { accessToken: body.access_token, expiresAt: now + (body.expires_in - 60) * 1000 };
  // Spotify sometimes rotates the refresh token on use — persist the new one if so.
  if (body.refresh_token) saveRefreshToken(body.refresh_token);
  return tokenCache.accessToken;
}

/** Extracts the playlist id from any open.spotify.com/playlist/... link, ignoring query params (e.g. ?si=...). */
export function parsePlaylistId(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new InvalidPlaylistUrlError("That doesn't look like a valid URL.");
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const playlistIndex = segments.indexOf("playlist");
  const id = playlistIndex !== -1 ? segments[playlistIndex + 1] : undefined;

  if (!id || !/^[A-Za-z0-9]+$/.test(id)) {
    throw new InvalidPlaylistUrlError("Couldn't find a playlist ID in that link — paste a link like https://open.spotify.com/playlist/....");
  }
  return id;
}

interface SpotifyImage {
  url: string;
  width: number | null;
}

// Spotify's Feb/Mar 2026 Web API migration replaced GET /playlists/{id}/tracks with
// GET /playlists/{id}/items and renamed the payload with it: the wrapper's `track` field is
// now `item`, and an item can be a podcast episode as well as a track (hence the `type`
// discriminator). The old endpoint doesn't redirect or warn — it just 403s.
interface SpotifyPlaylistItem {
  /** True when the playlist owner uploaded a local file; such entries carry no catalog id. */
  is_local: boolean;
  item: {
    id: string | null;
    name: string;
    type: string;
    artists: { name: string }[];
    album: { name: string; images: SpotifyImage[] } | null;
    duration_ms: number;
  } | null;
}

interface SpotifyPlaylistItemsPage {
  items: SpotifyPlaylistItem[];
  next: string | null;
}

async function spotifyGet<T>(url: string): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) {
    throw new InvalidPlaylistUrlError("That playlist wasn't found — it may be private or the link may be wrong.");
  }
  if (!res.ok) {
    // Surface Spotify's own error body server-side — a bare status code doesn't distinguish
    // "insufficient scope" from "app in Development Mode, account not allow-listed" from
    // other causes, and those need different fixes.
    const detail = await res.text().catch(() => "");
    console.error(`[spotify] ${url} -> HTTP ${res.status}: ${detail}`);

    // Since the 2026 API migration, Spotify only returns playlist *contents* for playlists the
    // authenticated user owns — a foreign playlist's metadata (name, owner, cover) still reads
    // fine, but /items on it is a bare 403. Verified by probing a healthy token against both:
    // the user's own playlist returns 200 while an unrelated public one returns 403, with
    // everything else (/me, /me/playlists, /search, /albums/{id}/tracks) unaffected. It isn't a
    // scope failure — Spotify words those "Insufficient client scope" — nor an app registration
    // problem, which two separately-registered apps behaving identically ruled out.
    if (res.status === 403 && url.includes("/items")) {
      throw new Error(
        "Spotify only allows apps to read the contents of playlists you own, so this one can't be " +
          "imported directly. To import it, open the playlist in Spotify, add its tracks to a new " +
          "playlist on your own account, and paste that playlist's link instead."
      );
    }
    throw new Error(`Spotify API request failed (HTTP ${res.status}).`);
  }
  return (await res.json()) as T;
}

/** Fetches a public playlist's display name, used to auto-name the crate created for it. */
export async function fetchPlaylistName(playlistId: string): Promise<string> {
  const page = await spotifyGet<{ name: string }>(
    `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}?fields=name`
  );
  return page.name;
}

/** Fetches every track in one of the user's own playlists, paginating through Spotify's 100-per-page limit. */
export async function fetchPlaylistTracks(playlistId: string): Promise<SpotifyTrackMetadata[]> {
  const tracks: SpotifyTrackMetadata[] = [];
  let url: string | null =
    `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items?limit=100&fields=next,items(is_local,item(id,name,type,artists(name),album(name,images),duration_ms))`;

  while (url) {
    const page: SpotifyPlaylistItemsPage = await spotifyGet<SpotifyPlaylistItemsPage>(url);
    for (const entry of page.items) {
      const track = entry.item;
      // Local files (uploaded by the playlist owner, not in Spotify's catalog) have no
      // useful metadata to search YouTube with, and no catalog id — skip them rather than guessing.
      // Podcast episodes are skipped for the same reason: this pipeline downloads music.
      if (!track || entry.is_local || !track.id || track.type !== "track") continue;

      const images = track.album?.images ?? [];
      const coverArtUrl = images.length > 0 ? images.reduce((a, b) => ((a.width ?? 0) >= (b.width ?? 0) ? a : b)).url : null;

      tracks.push({
        title: track.name,
        artists: track.artists.map((a) => a.name),
        album: track.album?.name ?? null,
        durationMs: track.duration_ms,
        coverArtUrl,
        spotifyUrl: `https://open.spotify.com/track/${track.id}`,
      });
    }
    url = page.next;
  }

  return tracks;
}
