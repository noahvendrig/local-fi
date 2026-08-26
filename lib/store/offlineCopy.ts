import { create } from "zustand";

export interface CrateCopyProgress {
  crateId: number;
  crateName: string;
  totalTracks: number;
  completedTracks: number;
  currentTrackTitle: string | null;
  totalBytes: number;
  tracksOk: number;
  coversOk: number;
  waveformsOk: number;
  status: "copying" | "done" | "error";
  error: string | null;
}

interface OfflineCopyState {
  /** Keyed by crate id — more than one crate could plausibly be mid-copy at once. */
  progress: Record<number, CrateCopyProgress>;
  startCopy: (crateId: number, crateName: string, totalTracks: number) => void;
  reportTrack: (crateId: number, patch: { trackTitle: string; bytes: number; hadCover: boolean; hadWaveform: boolean }) => void;
  finishCopy: (crateId: number) => void;
  failCopy: (crateId: number, error: string) => void;
  clearProgress: (crateId: number) => void;
}

export const useOfflineCopyStore = create<OfflineCopyState>((set) => ({
  progress: {},

  startCopy: (crateId, crateName, totalTracks) =>
    set((s) => ({
      progress: {
        ...s.progress,
        [crateId]: {
          crateId,
          crateName,
          totalTracks,
          completedTracks: 0,
          currentTrackTitle: null,
          totalBytes: 0,
          tracksOk: 0,
          coversOk: 0,
          waveformsOk: 0,
          status: "copying",
          error: null,
        },
      },
    })),

  reportTrack: (crateId, patch) =>
    set((s) => {
      const current = s.progress[crateId];
      if (!current) return s;
      return {
        progress: {
          ...s.progress,
          [crateId]: {
            ...current,
            completedTracks: current.completedTracks + 1,
            currentTrackTitle: patch.trackTitle,
            totalBytes: current.totalBytes + patch.bytes,
            tracksOk: current.tracksOk + 1,
            coversOk: current.coversOk + (patch.hadCover ? 1 : 0),
            waveformsOk: current.waveformsOk + (patch.hadWaveform ? 1 : 0),
          },
        },
      };
    }),

  finishCopy: (crateId) =>
    set((s) => {
      const current = s.progress[crateId];
      if (!current) return s;
      return { progress: { ...s.progress, [crateId]: { ...current, status: "done" } } };
    }),

  failCopy: (crateId, error) =>
    set((s) => {
      const current = s.progress[crateId];
      if (!current) return s;
      return { progress: { ...s.progress, [crateId]: { ...current, status: "error", error } } };
    }),

  clearProgress: (crateId) =>
    set((s) => {
      const next = { ...s.progress };
      delete next[crateId];
      return { progress: next };
    }),
}));
