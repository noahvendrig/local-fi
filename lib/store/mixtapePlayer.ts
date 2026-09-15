import { create } from "zustand";
import type { WaveformData } from "@/lib/waveform/parse";
import { useDjStore } from "./dj";
import { usePlayerStore } from "./player";
import { useTransportSourceStore } from "./transportSource";

/** Just enough of a Mixtape to drive the transport bar — title/duration/format, no library fields. */
export interface MixtapeNowPlaying {
  id: number;
  title: string;
  durationSeconds: number;
  format: string;
}

/**
 * Mixtape-view playback state: mirrors useDjStore's shape (a third deck alongside the regular
 * queue player and the DJ deck). Deliberately separate from usePlayerStore — a mixtape isn't a
 * library TrackSummary and doesn't belong in the queue/offline/crossfade machinery there. Not
 * persisted to /playback-state; ephemeral per session like the DJ deck. The bottom transport bar
 * reads this plus useTransportSourceStore to show whichever deck the user last selected — see
 * TransportBar's `mixtapeActive` logic. The actual <audio> element lives in
 * components/mixtapes/useMixtapePlaybackEngine.ts, mounted only while a mixtape detail page is open.
 */
interface MixtapePlayerState {
  currentMixtape: MixtapeNowPlaying | null;
  isPlaying: boolean;
  /** Mirrors the mixtape deck's <audio> position, so the bottom transport bar can show live progress. */
  currentTime: number;
  pendingSeekSeconds: number | null;
  /** Current mixtape's parsed peak sidecar, fetched by TransportBar and shared with the detail page's timeline. */
  waveform: WaveformData | null;

  /** Selects a mixtape; re-selecting the already-loaded mixtape toggles play/pause instead of restarting it. */
  playMixtape: (mixtape: MixtapeNowPlaying) => void;
  setMixtapePlaying: (playing: boolean) => void;
  setCurrentTime: (seconds: number) => void;
  setWaveform: (data: WaveformData | null) => void;
  seekTo: (seconds: number) => void;
  consumePendingSeek: () => void;
}

export const useMixtapePlayerStore = create<MixtapePlayerState>((set, get) => ({
  currentMixtape: null,
  isPlaying: false,
  currentTime: 0,
  pendingSeekSeconds: null,
  waveform: null,

  playMixtape: (mixtape) => {
    const { currentMixtape, isPlaying } = get();
    useTransportSourceStore.getState().setActiveSource("mixtape");
    if (currentMixtape?.id === mixtape.id) {
      const next = !isPlaying;
      if (next) {
        usePlayerStore.getState().setPlaying(false);
        useDjStore.getState().setDjPlaying(false);
      }
      set({ isPlaying: next });
      return;
    }
    usePlayerStore.getState().setPlaying(false);
    useDjStore.getState().setDjPlaying(false);
    set({ currentMixtape: mixtape, isPlaying: true, currentTime: 0, pendingSeekSeconds: null });
  },

  setMixtapePlaying: (playing) => {
    if (playing) {
      usePlayerStore.getState().setPlaying(false);
      useDjStore.getState().setDjPlaying(false);
    }
    set({ isPlaying: playing });
  },

  setCurrentTime: (seconds) => set({ currentTime: seconds }),
  setWaveform: (data) => set({ waveform: data }),
  seekTo: (seconds) => set({ pendingSeekSeconds: seconds, currentTime: seconds }),
  consumePendingSeek: () => set({ pendingSeekSeconds: null }),
}));
