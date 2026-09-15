"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { TrackSummary } from "@/lib/api-client";
import {
  fetchMixtape,
  ManualSegmentsExistError,
  type MixtapeSegment,
} from "@/lib/api/mixtapesClient";
import { formatDuration } from "@/lib/format/track";
import { usePlayerStore } from "@/lib/store/player";
import { useMixtapePlayerStore } from "@/lib/store/mixtapePlayer";
import { ConfirmDialog } from "@/components/shell/ConfirmDialog";
import { AssignSegmentModal } from "./AssignSegmentModal";
import { MixtapeSegmentTimeline } from "./MixtapeSegmentTimeline";
import { useMixtapeAnalysisProgress } from "./useMixtapeAnalysisProgress";
import { useMixtapePlaybackEngine } from "./useMixtapePlaybackEngine";

const STAGE_LABEL: Record<string, string> = {
  decoding: "Decoding audio…",
  fingerprinting: "Fingerprinting…",
  matching: "Matching against your library…",
  done: "Done",
};

export function MixtapeDetailView({ mixtapeId }: { mixtapeId: number }) {
  const [assignTarget, setAssignTarget] = useState<MixtapeSegment | null>(null);
  const [reanalyzeConfirm, setReanalyzeConfirm] = useState<{ manualSegmentCount: number } | null>(null);

  const mixtapeQuery = useQuery({ queryKey: ["mixtape", mixtapeId], queryFn: () => fetchMixtape(mixtapeId) });
  const mixtape = mixtapeQuery.data;

  const { progress, startAnalysis } = useMixtapeAnalysisProgress(mixtapeId, mixtape?.latestJob ?? null);

  const analyzeMutation = useMutation({
    mutationFn: (force: boolean) => startAnalysis(force),
    onSuccess: () => setReanalyzeConfirm(null),
    onError: (err) => {
      if (err instanceof ManualSegmentsExistError) {
        setReanalyzeConfirm({ manualSegmentCount: err.manualSegmentCount });
      }
    },
  });

  // Playback for the mixtape itself routes through the shared transport bar (useMixtapePlayerStore
  // + useMixtapePlaybackEngine) — a third deck alongside the regular queue player and the DJ deck,
  // so play/pause/seek here show up in the bottom "Playing Now" bar instead of a disconnected
  // local <audio> element.
  const currentMixtape = useMixtapePlayerStore((s) => s.currentMixtape);
  const mixtapeIsPlaying = useMixtapePlayerStore((s) => s.isPlaying);
  const mixtapeCurrentTime = useMixtapePlayerStore((s) => s.currentTime);
  const playMixtape = useMixtapePlayerStore((s) => s.playMixtape);
  const seekMixtape = useMixtapePlayerStore((s) => s.seekTo);
  const { audioRef, handleEnded, handlePause, handlePlay, handleTimeUpdate } = useMixtapePlaybackEngine();

  if (mixtapeQuery.isLoading || !mixtape) {
    return (
      <div className="flex h-full flex-col px-10 py-8">
        <p className="text-sm text-t3">Loading…</p>
      </div>
    );
  }

  const isAnalyzing = mixtape.analysisStatus === "queued" || mixtape.analysisStatus === "analyzing";
  const matchedCount = mixtape.segments.filter((s) => s.matchStatus === "auto_matched" || s.matchStatus === "manual").length;
  const unrecognizedCount = mixtape.segments.filter((s) => s.matchStatus === "unrecognized").length;

  const isThisMixtapeActive = currentMixtape?.id === mixtapeId;
  const currentTime = isThisMixtapeActive ? mixtapeCurrentTime : 0;
  const isPlaying = isThisMixtapeActive && mixtapeIsPlaying;

  const toggleMixtapePlay = () => {
    playMixtape({ id: mixtapeId, title: mixtape.title, durationSeconds: mixtape.durationSeconds, format: mixtape.format });
  };

  // Skips to a position in the mixtape — used by both the general waveform click-to-seek and by
  // clicking a segment block. Loads/starts this mixtape first if it isn't already the active deck.
  const handleSeek = (seconds: number) => {
    const clamped = Math.max(0, Math.min(mixtape.durationSeconds, seconds));
    if (!isThisMixtapeActive) {
      playMixtape({ id: mixtapeId, title: mixtape.title, durationSeconds: mixtape.durationSeconds, format: mixtape.format });
    }
    seekMixtape(clamped);
  };

  // Matched tracks in segment order, used as the queue context when playing a segment's song from
  // the list — so Next/Previous on the transport bar walks through the mixtape's matched songs.
  const matchedTracksQueue: TrackSummary[] = mixtape.segments
    .filter((s) => s.matchedTrack != null)
    .sort((a, b) => a.position - b.position)
    .map((s) => s.matchedTrack as TrackSummary);

  const playSegmentTrack = (segment: MixtapeSegment) => {
    if (!segment.matchedTrack) return;
    usePlayerStore.getState().playTrack(segment.matchedTrack, matchedTracksQueue);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto px-10 py-8">
      <Link href="/mixtapes" className="w-fit text-xs text-t3 hover:text-t1">
        ← Mixtapes
      </Link>

      <div className="mt-2 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-[28px] font-bold leading-[1.2] text-t1">{mixtape.title}</h1>
          <p className="mt-1 font-mono text-xs text-t3">
            {formatDuration(mixtape.durationSeconds)} · {mixtape.format.toUpperCase()}
            {mixtape.analysisStatus === "ready" ? ` · ${matchedCount} matched, ${unrecognizedCount} unrecognized` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => analyzeMutation.mutate(false)}
          disabled={isAnalyzing || analyzeMutation.isPending}
          className="shrink-0 rounded-lg border border-line px-4 py-2.5 text-[13px] font-medium text-t1 hover:border-acc hover:bg-surf-2 disabled:opacity-40"
        >
          {isAnalyzing ? "Analyzing…" : "Re-analyze"}
        </button>
      </div>

      {isAnalyzing && progress ? (
        <div className="lf-card mt-4 rounded-lg px-4 py-3">
          <div className="flex items-center justify-between text-xs text-t2">
            <span>{STAGE_LABEL[progress.stage ?? ""] ?? "Working…"}</span>
            <span className="font-mono">{Math.round(progress.progressPct)}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-acc transition-[width]" style={{ width: `${progress.progressPct}%` }} />
          </div>
        </div>
      ) : null}

      {mixtape.analysisStatus === "failed" ? (
        <p className="mt-4 text-sm text-err">Analysis failed{progress?.errorMessage ? `: ${progress.errorMessage}` : "."}</p>
      ) : null}

      <audio
        ref={audioRef}
        onEnded={handleEnded}
        onPause={handlePause}
        onPlay={handlePlay}
        onTimeUpdate={(e) => handleTimeUpdate(e.currentTarget)}
        className="hidden"
      />

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={toggleMixtapePlay}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-acc text-on-acc hover:bg-acc-2"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? "❚❚" : "▶"}
        </button>
        <span className="w-12 shrink-0 text-right font-mono text-xs text-t3">{formatDuration(currentTime)}</span>
        <div className="flex-1">
          <MixtapeSegmentTimeline
            mixtapeId={mixtapeId}
            durationSeconds={mixtape.durationSeconds}
            segments={mixtape.segments}
            currentTime={currentTime}
            onSeek={handleSeek}
            onSegmentSeek={(segment) => handleSeek(segment.startSeconds)}
          />
        </div>
      </div>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-t3">Segments</h2>
      {mixtape.segments.length === 0 ? (
        <p className="mt-3 text-sm text-t3">
          {isAnalyzing ? "Matching in progress…" : "No segments yet — run analysis to segment this mixtape."}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {mixtape.segments.map((segment) => (
            <li
              key={segment.id}
              role={segment.matchedTrack ? "button" : undefined}
              tabIndex={segment.matchedTrack ? 0 : undefined}
              onClick={() => playSegmentTrack(segment)}
              onKeyDown={(e) => {
                if (!segment.matchedTrack) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  playSegmentTrack(segment);
                }
              }}
              className={`lf-card flex items-center gap-3.5 rounded-lg px-3.5 py-3 ${
                segment.matchedTrack ? "cursor-pointer hover:border-acc" : ""
              }`}
            >
              <span className="w-28 shrink-0 font-mono text-xs text-t3">
                {formatDuration(segment.startSeconds)}–{formatDuration(segment.endSeconds)}
              </span>
              <div className="min-w-0 flex-1">
                {segment.matchedTrack ? (
                  <>
                    <p className="truncate text-sm text-t1">{segment.matchedTrack.title ?? "Untitled"}</p>
                    <p className="truncate text-xs text-t2">{segment.matchedTrack.artistName ?? "Unknown artist"}</p>
                  </>
                ) : (
                  <p className="text-sm text-t3">Unrecognized — click to assign</p>
                )}
              </div>
              {segment.matchStatus === "auto_matched" && segment.confidenceScore != null ? (
                <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-t2">
                  {Math.round(segment.confidenceScore * 100)}% match
                </span>
              ) : segment.matchStatus === "manual" ? (
                <span className="shrink-0 rounded-full border border-ok px-2 py-0.5 text-[11px] text-ok">Manual</span>
              ) : null}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setAssignTarget(segment);
                }}
                className="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-xs text-t2 hover:border-acc hover:bg-surf-2"
              >
                {segment.matchedTrack ? "Reassign" : "Assign"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {assignTarget ? (
        <AssignSegmentModal mixtapeId={mixtapeId} segment={assignTarget} onClose={() => setAssignTarget(null)} />
      ) : null}

      {reanalyzeConfirm ? (
        <ConfirmDialog
          title="Discard manual corrections?"
          message={`Re-analyzing will discard your manual corrections for ${reanalyzeConfirm.manualSegmentCount} segment${
            reanalyzeConfirm.manualSegmentCount === 1 ? "" : "s"
          } and replace every segment with a fresh match.`}
          confirmLabel="Re-analyze"
          danger
          isPending={analyzeMutation.isPending}
          onConfirm={() => analyzeMutation.mutate(true)}
          onClose={() => setReanalyzeConfirm(null)}
        />
      ) : null}
    </div>
  );
}
