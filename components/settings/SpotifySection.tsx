"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { disconnectSpotify, fetchSpotifyStatus, useSpotifyLoginUrl } from "@/lib/api/spotifyClient";

const CALLBACK_MESSAGE: Record<string, string> = {
  connected: "Spotify connected.",
  denied: "Spotify login was cancelled.",
  error: "Spotify login failed — try again.",
  config_missing: "Set SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET in .env first.",
};

/** One-time Spotify OAuth connect/disconnect control (lib/spotify/client.ts) — playlist
 *  imports need this since Spotify no longer lets app-only credentials read playlist tracks. */
export function SpotifySection() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const callbackResult = searchParams.get("spotify");
  const loginUrl = useSpotifyLoginUrl();

  const statusQuery = useQuery({ queryKey: ["spotify-status"], queryFn: fetchSpotifyStatus });

  const disconnectMutation = useMutation({
    mutationFn: disconnectSpotify,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["spotify-status"] }),
  });

  // Drop the ?spotify= param and refresh status once, right after the OAuth callback lands here.
  useEffect(() => {
    if (!callbackResult) return;
    queryClient.invalidateQueries({ queryKey: ["spotify-status"] });
    router.replace("/settings");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callbackResult]);

  const connected = statusQuery.data === true;

  return (
    <div className="lf-card mt-3 flex items-center justify-between gap-4 rounded-2xl px-5 py-4">
      <div>
        <p className="text-sm font-semibold text-t1">Spotify</p>
        <p className="mt-0.5 text-sm text-t2">
          {connected
            ? "Connected — paste a playlist link on Import or a new crate to download it."
            : "Connect an account once to import public playlists by link."}
        </p>
        {callbackResult ? <p className="mt-1 text-xs text-t3">{CALLBACK_MESSAGE[callbackResult] ?? null}</p> : null}
      </div>
      {connected ? (
        <button
          type="button"
          onClick={() => disconnectMutation.mutate()}
          disabled={disconnectMutation.isPending}
          className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-medium text-t1 hover:border-err hover:text-err disabled:opacity-50"
        >
          {disconnectMutation.isPending ? "Disconnecting…" : "Disconnect"}
        </button>
      ) : (
        <a
          href={loginUrl}
          className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-medium text-t1 hover:border-acc hover:bg-surf-2"
        >
          Connect Spotify
        </a>
      )}
    </div>
  );
}
