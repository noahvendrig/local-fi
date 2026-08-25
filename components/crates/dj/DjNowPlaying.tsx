import type { TrackSummary } from "@/lib/api-client";
import type { DjAdjustment } from "@/lib/audio/djMatch";
import { useDjStore } from "@/lib/store/dj";
import { usePlayerStore } from "@/lib/store/player";

export function DjNowPlaying({
  track,
  isPlaying,
  adjustment,
}: {
  track: TrackSummary;
  isPlaying: boolean;
  adjustment: DjAdjustment;
}) {
  const playDjTrack = useDjStore((s) => s.playDjTrack);
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const tempoPct = (adjustment.tempoRatio - 1) * 100;
  const hasNoAnalysis = track.bpm == null && track.key == null;

  return (
    <div className="mx-8 mb-6 flex items-center gap-4 rounded-xl border border-line bg-surf px-5 py-3">
      <button
        type="button"
        onClick={() => playDjTrack(track)}
        aria-label={isPlaying ? "Pause" : "Play"}
        className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-acc text-on-acc"
      >
        {isPlaying ? "❚❚" : "▶"}
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-t1">{track.title ?? "Untitled"}</div>
        <div className="truncate font-mono text-[11px] text-t3">{track.artistName}</div>
      </div>

      <div className="flex flex-none items-center gap-2" title="Volume">
        <span aria-hidden className="text-[13px] text-t3">
          🔊
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          aria-label="DJ deck volume"
          className="h-2 w-24 accent-acc"
        />
      </div>

      <div className="flex flex-none items-center gap-4 font-mono text-[11px] text-t2">
        {hasNoAnalysis ? (
          <span className="text-warn">no BPM/key — click Analyze in the tracklist</span>
        ) : (
          <>
            {tempoPct !== 0 && (
              <span>
                tempo {tempoPct >= 0 ? "+" : ""}
                {tempoPct.toFixed(1)}%
              </span>
            )}
            {adjustment.pitchSemitones !== 0 && (
              <span>
                pitch {adjustment.pitchSemitones >= 0 ? "+" : ""}
                {adjustment.pitchSemitones} st
              </span>
            )}
            {tempoPct === 0 && adjustment.pitchSemitones === 0 && <span>unadjusted</span>}
          </>
        )}
      </div>
    </div>
  );
}
