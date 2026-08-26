import { create } from "zustand";

/**
 * Which deck the bottom transport bar should display/control: the regular player
 * (usePlayerStore) or the DJ deck (useDjStore). Explicit and set only by the actions that
 * represent the user actually choosing a deck (playTrack/playNext/playPrevious/playFromQueue
 * on the regular side, playDjTrack on the DJ side) — NOT by transient play/pause state, so
 * pausing the active deck from the transport bar can never make it silently fall back to the
 * other one. See TransportBar's `djActive`.
 */
interface TransportSourceState {
  activeSource: "regular" | "dj";
  setActiveSource: (source: "regular" | "dj") => void;
}

export const useTransportSourceStore = create<TransportSourceState>((set) => ({
  activeSource: "regular",
  setActiveSource: (source) => set({ activeSource: source }),
}));
