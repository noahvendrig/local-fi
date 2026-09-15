import { create } from "zustand";

/**
 * Which deck the bottom transport bar should display/control: the regular player
 * (usePlayerStore), the DJ deck (useDjStore), or a mixtape (useMixtapePlayerStore). Explicit and
 * set only by the actions that represent the user actually choosing a deck
 * (playTrack/playNext/playPrevious/playFromQueue on the regular side, playDjTrack on the DJ
 * side, playMixtape on the mixtape side) — NOT by transient play/pause state, so pausing the
 * active deck from the transport bar can never make it silently fall back to another one. See
 * TransportBar's `djActive`/`mixtapeActive`.
 */
interface TransportSourceState {
  activeSource: "regular" | "dj" | "mixtape";
  setActiveSource: (source: "regular" | "dj" | "mixtape") => void;
}

export const useTransportSourceStore = create<TransportSourceState>((set) => ({
  activeSource: "regular",
  setActiveSource: (source) => set({ activeSource: source }),
}));
