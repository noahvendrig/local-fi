"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchPlaylist } from "@/lib/api/playlistsClient";
import { computeDjAdjustment } from "@/lib/audio/djMatch";
import { useDjStore } from "@/lib/store/dj";
import { DjTransportControls } from "./DjTransportControls";
import { DjTracklist } from "./DjTracklist";
import { DjNowPlaying } from "./DjNowPlaying";
import { useAnalysisRunner } from "./useAnalysisRunner";
import { useDjPlaybackEngine } from "./useDjPlaybackEngine";

export function DjCrateView({ playlistId }: { playlistId: number }) {
  const {
    data: playlist,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["playlist", playlistId],
    queryFn: () => fetchPlaylist(playlistId),
  });

  const { progress, startAnalysis } = useAnalysisRunner(playlistId);
  const { audioRef, handleEnded, handlePause, handlePlay, handleTimeUpdate } = useDjPlaybackEngine();
  const currentTrack = useDjStore((s) => s.currentTrack);
  const isPlaying = useDjStore((s) => s.isPlaying);
  const targetBpm = useDjStore((s) => s.targetBpm);
  const targetKey = useDjStore((s) => s.targetKey);
  const keyLockEnabled = useDjStore((s) => s.keyLockEnabled);

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

  const analyzedCount = playlist.tracks.filter((t) => t.analysisStatus === "ready").length;
  const isAnalyzing = progress != null && (progress.status === "pending" || progress.status === "running");
  const unanalyzedIds = playlist.tracks.filter((t) => t.analysisStatus !== "ready").map((t) => t.id);

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
          <span className="rounded-md bg-acc px-3 py-[5px] text-[11px] font-medium uppercase tracking-wide text-on-acc">DJ view</span>
        </div>
        <div className="flex-1" />
        {isAnalyzing ? (
          <div className="flex items-center gap-2">
            <div className="lf-index-spin h-3 w-3 flex-none rounded-full border-[1.5px] border-line border-t-acc" />
            <span className="font-mono text-[11px] text-t3">
              Analyzing {progress.processed} / {progress.total}…
            </span>
          </div>
        ) : (
          <>
            <span className="font-mono text-[11px] text-t3">
              {analyzedCount} of {playlist.tracks.length} analyzed
            </span>
            {unanalyzedIds.length > 0 && (
              <button
                type="button"
                onClick={() => startAnalysis(unanalyzedIds)}
                className="rounded-md border border-line px-3 py-1.5 text-[11px] font-medium text-t1 hover:border-acc hover:bg-surf-2"
              >
                Analyze crate
              </button>
            )}
          </>
        )}
      </div>

      <div className="flex gap-6 px-8 pb-6 pt-6">
        <div className="lf-hatch h-[104px] w-[104px] flex-none rounded-xl shadow-[var(--lf-art-shadow)]" />
        <div className="min-w-0 flex-1">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-t3">Crate · DJ view</div>
          <div className="mb-2.5 font-serif text-[38px] leading-[1.1] font-medium text-t1">{playlist.name}</div>
          <div className="flex gap-4 font-mono text-xs text-t3">
            <span>
              {playlist.tracks.length} track{playlist.tracks.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      </div>

      <DjTransportControls />
      {currentTrack && (
        <DjNowPlaying
          track={currentTrack}
          isPlaying={isPlaying}
          adjustment={computeDjAdjustment(currentTrack, targetBpm, targetKey, keyLockEnabled)}
        />
      )}
      <DjTracklist playlistId={playlistId} tracks={playlist.tracks} onAnalyze={startAnalysis} />
      <audio
        ref={audioRef}
        onEnded={handleEnded}
        onPause={handlePause}
        onPlay={handlePlay}
        onTimeUpdate={(e) => handleTimeUpdate(e.currentTarget)}
        className="hidden"
      />
    </div>
  );
}
