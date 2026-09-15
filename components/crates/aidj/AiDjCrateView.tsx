"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPlaylist } from "@/lib/api/playlistsClient";
import { sequenceCrateForAiDj } from "@/lib/audio/aiDjSequencer";
import { useAiDjStore } from "@/lib/store/aiDj";
import { AiDjNowPlaying } from "./AiDjNowPlaying";
import { AiDjTracklist } from "./AiDjTracklist";
import { AiDjTransportControls } from "./AiDjTransportControls";
import { useAiDjEngine } from "./useAiDjEngine";

const MIN_USABLE_TRACKS = 2;

export function AiDjCrateView({ playlistId }: { playlistId: number }) {
  const {
    data: playlist,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["playlist", playlistId],
    queryFn: () => fetchPlaylist(playlistId),
  });

  const engine = useAiDjEngine();
  const sessionId = useAiDjStore((s) => s.sessionId);
  const sessionOrder = useAiDjStore((s) => s.order);
  const sessionSkippedCount = useAiDjStore((s) => s.skippedCount);
  const started = sessionId != null;

  const sequenced = useMemo(() => (playlist ? sequenceCrateForAiDj(playlist.tracks) : null), [playlist]);

  if (isLoading) return null;

  if (error || !playlist) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
        <h1 className="font-serif text-2xl text-t1">Crate not found</h1>
        <Link href="/crates" className="text-sm font-medium text-acc-text hover:underline">
          Back to crates
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center gap-3.5 border-b border-line px-8 py-4">
        <Link href={`/crates/${playlistId}`} className="text-[13px] text-t3 hover:text-t1">
          ‹ Crate
        </Link>
        <div className="flex rounded-lg border border-line bg-surf p-0.5">
          <Link href={`/crates/${playlistId}`} className="rounded-md px-3 py-[5px] text-[11px] font-medium uppercase tracking-wide text-t3 hover:text-t1">
            Tracklist
          </Link>
          <Link href={`/crates/${playlistId}/dj`} className="rounded-md px-3 py-[5px] text-[11px] font-medium uppercase tracking-wide text-t3 hover:text-t1">
            DJ view
          </Link>
          <span className="rounded-md bg-acc px-3 py-[5px] text-[11px] font-medium uppercase tracking-wide text-on-acc">AI DJ</span>
        </div>
      </div>

      <div className="flex gap-6 px-8 pb-6 pt-6">
        <div className="lf-hatch h-[104px] w-[104px] flex-none rounded-xl shadow-[var(--lf-art-shadow)]" />
        <div className="min-w-0 flex-1">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-t3">Crate · AI DJ</div>
          <div className="mb-2.5 font-serif text-[38px] leading-[1.1] font-medium text-t1">{playlist.name}</div>
          <div className="flex gap-4 font-mono text-xs text-t3">
            <span>
              {playlist.tracks.length} track{playlist.tracks.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      </div>

      {!started && sequenced && (
        <div className="mx-8 mb-6 flex items-center gap-4 rounded-xl border border-line bg-surf px-5 py-4">
          {sequenced.order.length < MIN_USABLE_TRACKS ? (
            <p className="text-[13px] text-t2">
              This crate needs at least {MIN_USABLE_TRACKS} tracks with a known BPM to run a set — analyze it from the DJ view first.
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void engine.beginSession(playlistId, sequenced.order, sequenced.skipped.length)}
                className="flex items-center gap-2 rounded-lg bg-acc px-4 py-2.5 text-[13px] font-medium text-on-acc hover:opacity-90"
              >
                ▶ Start AI DJ set
              </button>
              <p className="text-[13px] text-t2">
                Auto-mixes {sequenced.order.length} track{sequenced.order.length === 1 ? "" : "s"} with beatmatched stem-mashup transitions.
                {sequenced.skipped.length > 0
                  ? ` ${sequenced.skipped.length} track${sequenced.skipped.length === 1 ? "" : "s"} skipped (no BPM).`
                  : ""}
              </p>
            </>
          )}
        </div>
      )}

      {started && (
        <>
          <AiDjTransportControls engine={engine} />
          <AiDjNowPlaying />
          <AiDjTracklist order={sessionOrder} skippedCount={sessionSkippedCount} />
        </>
      )}
    </div>
  );
}
