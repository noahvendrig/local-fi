import { create } from "zustand";

export type LibraryViewMode = "grid" | "list";

const STORAGE_KEY = "lf-library-view";

function loadInitialViewMode(): LibraryViewMode {
  if (typeof window === "undefined") return "grid";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "list" ? "list" : "grid";
}

interface LibraryState {
  viewMode: LibraryViewMode;
  setViewMode: (mode: LibraryViewMode) => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  viewMode: loadInitialViewMode(),
  setViewMode: (mode) => {
    window.localStorage.setItem(STORAGE_KEY, mode);
    set({ viewMode: mode });
  },
}));
