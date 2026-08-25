"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateTrack } from "@/lib/api/tracksClient";
import type { PlaylistTrackItem } from "@/lib/api/playlistsClient";
import { formatDuration } from "@/lib/format/track";
import { MATCH_LEVEL_COLOR, keyCompatibility, tempoDelta } from "@/lib/audio/djMatch";
import { normalizeToCamelot } from "@/lib/tags/camelotKey";
import { useDjStore } from "@/lib/store/dj";
import { FormatBadge } from "@/components/library/FormatBadge";
import { PlayingIcon } from "@/components/shell/PlayerIcons";
import { CamelotKeyBadge } from "./CamelotKeyBadge";

const GRID_COLS = "20px 26px 1fr 84px 52px 96px 62px 148px";

export function DjTracklist({
  playlistId,
  tracks,
  onAnalyze,
}: {
  playlistId: number;
  tracks: PlaylistTrackItem[];
  onAnalyze: (trackIds: number[]) => void;
}) {
  const currentTrackId = useDjStore((s) => s.currentTrack?.id);
  const isPlaying = useDjStore((s) => s.isPlaying);
  const playDjTrack = useDjStore((s) => s.playDjTrack);
  const targetBpm = useDjStore((s) => s.targetBpm);
  const targetKey = useDjStore((s) => s.targetKey);
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null);

  return (
    <div className="px-8 pb-8">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="text-[11px] font-medium uppercase tracking-wide text-t3">Tracks</span>
        <span className="font-mono text-[11px] text-t3">
          {targetBpm || targetKey ? "sorted by crate order" : "set a target BPM/key above to see match quality"}
        </span>
      </div>

      <div
        className="grid gap-3.5 border-b border-line px-3 pb-2 text-[10.5px] font-medium uppercase tracking-wide text-t3"
        style={{ gridTemplateColumns: GRID_COLS }}
      >
        <span />
        <span>#</span>
        <span>Title</span>
        <span>Format</span>
        <span className="text-right">Time</span>
        <span>BPM</span>
        <span>Key</span>
        <span>Match</span>
      </div>

      {tracks.map((track, i) => (
        <DjTrackRow
          key={track.entryId ?? track.id}
          track={track}
          index={i}
          playlistId={playlistId}
          isCurrent={track.id === currentTrackId}
          isPlaying={isPlaying}
          onPlay={() => !track.missing && playDjTrack(track)}
          targetBpm={targetBpm}
          targetKey={targetKey}
          isEditing={editingTrackId === track.id}
          onStartEdit={() => setEditingTrackId(track.id)}
          onStopEdit={() => setEditingTrackId((cur) => (cur === track.id ? null : cur))}
          onAnalyze={() => onAnalyze([track.id])}
        />
      ))}
    </div>
  );
}

function DjTrackRow({
  track,
  index,
  playlistId,
  isCurrent,
  isPlaying,
  onPlay,
  targetBpm,
  targetKey,
  isEditing,
  onStartEdit,
  onStopEdit,
  onAnalyze,
}: {
  track: PlaylistTrackItem;
  index: number;
  playlistId: number;
  isCurrent: boolean;
  isPlaying: boolean;
  onPlay: () => void;
  targetBpm: number | null;
  targetKey: string | null;
  isEditing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onAnalyze: () => void;
}) {
  const queryClient = useQueryClient();
  const [bpmDraft, setBpmDraft] = useState(track.bpm != null ? String(track.bpm) : "");
  const [keyDraft, setKeyDraft] = useState(track.key ?? "");
  const [error, setError] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: (patch: { bpm?: number | null; key?: string | null }) => updateTrack(track.id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });
      onStopEdit();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to save."),
  });

  const handleSave = () => {
    setError(null);
    const bpm = bpmDraft.trim() ? Number(bpmDraft) : null;
    if (bpmDraft.trim() && (!Number.isFinite(bpm) || bpm! < 20 || bpm! > 400)) {
      setError("BPM must be between 20 and 400.");
      return;
    }
    const normalizedKey = keyDraft.trim() ? normalizeToCamelot(keyDraft.trim()) : null;
    if (keyDraft.trim() && !normalizedKey) {
      setError('Key not recognized — try Camelot notation (e.g. "8A") or a standard key (e.g. "Am").');
      return;
    }
    saveMutation.mutate({ bpm, key: normalizedKey });
  };

  const tempo = tempoDelta(track.bpm, targetBpm);
  const keyMatch = keyCompatibility(track.key, targetKey);
  const hasMatch = tempo != null || keyMatch != null;

  return (
    <div
      className={`grid items-center gap-3.5 border-b border-line px-3 py-[11px] last:border-b-0 ${track.missing ? "opacity-40" : ""}`}
      style={{ gridTemplateColumns: GRID_COLS }}
    >
      <span aria-hidden className="text-xs text-t3">
        ⠿
      </span>
      <span className="font-mono text-xs text-t3">{isCurrent && isPlaying ? <PlayingIcon /> : String(index + 1).padStart(2, "0")}</span>

      <div className="min-w-0 cursor-pointer" onClick={onPlay} title={track.missing ? "File missing on disk" : undefined}>
        <div className={`truncate text-sm ${isCurrent ? "text-playing" : "text-t1"}`}>{track.title ?? "Untitled"}</div>
        <div className="truncate font-mono text-xs text-t3">{track.artistName}</div>
      </div>

      <span>
        <FormatBadge format={track.format} lossless={track.lossless} />
      </span>
      <span className="text-right font-mono text-xs text-t2">{formatDuration(track.durationSeconds)}</span>

      {isEditing ? (
        <div className="col-span-3 flex items-center gap-2">
          <input
            value={bpmDraft}
            onChange={(e) => setBpmDraft(e.target.value)}
            placeholder="BPM"
            inputMode="decimal"
            className="w-16 rounded-md border border-line bg-bg px-2 py-1 font-mono text-xs text-t1"
          />
          <input
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            placeholder="Key (8A)"
            className="w-20 rounded-md border border-line bg-bg px-2 py-1 font-mono text-xs text-t1"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="rounded-md border border-acc bg-acc px-2 py-1 text-[11px] font-medium text-on-acc disabled:opacity-50"
          >
            {saveMutation.isPending ? "…" : "Save"}
          </button>
          <button type="button" onClick={onStopEdit} className="text-[11px] text-t3 hover:text-t1">
            Cancel
          </button>
          {error && <span className="text-[10.5px] text-err">{error}</span>}
        </div>
      ) : (
        <>
          <div>
            {track.bpm != null ? (
              <span className="font-mono text-sm font-medium text-t1">{track.bpm}</span>
            ) : track.analysisStatus === "analyzing" ? (
              <div className="flex items-center gap-1.5">
                <div className="lf-index-spin h-[13px] w-[13px] flex-none rounded-full border-[1.5px] border-line border-t-acc" />
                <span className="font-mono text-[10.5px] text-t3">reading</span>
              </div>
            ) : track.analysisStatus === "queued" ? (
              <span className="font-mono text-[10.5px] text-t3">queued</span>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onAnalyze}
                  className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-t2 hover:border-acc hover:bg-[var(--lf-tint)] hover:text-acc-text"
                >
                  ● Analyze
                </button>
                <button type="button" onClick={onStartEdit} className="text-[10px] text-t3 hover:text-t1" title="Enter BPM/key manually">
                  edit
                </button>
              </div>
            )}
          </div>

          <div>
            {track.key ? (
              <button type="button" onClick={onStartEdit} title="Click to edit">
                <CamelotKeyBadge camelotKey={track.key} />
              </button>
            ) : (
              <button
                type="button"
                onClick={onStartEdit}
                aria-label="Set key"
                className="inline-block h-5 w-[34px] rounded-md border border-dashed border-line"
              />
            )}
          </div>

          <div>
            {hasMatch ? (
              <div className="flex items-center gap-2">
                {keyMatch && (
                  <span
                    className="h-[9px] w-[9px] flex-none rounded-full"
                    style={{ background: MATCH_LEVEL_COLOR[keyMatch.level], boxShadow: `0 0 0 3px color-mix(in srgb, ${MATCH_LEVEL_COLOR[keyMatch.level]} 22%, transparent)` }}
                  />
                )}
                {tempo && (
                  <span className="min-w-[52px] font-mono text-[13px] font-medium" style={{ color: MATCH_LEVEL_COLOR[tempo.level] }}>
                    {tempo.label}
                  </span>
                )}
                <span className="whitespace-nowrap text-[10.5px] text-t3">{keyMatch?.hint ?? ""}</span>
              </div>
            ) : (
              <span className="font-mono text-[11px] text-t3">{track.bpm != null || track.key ? "set a target" : "—"}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
