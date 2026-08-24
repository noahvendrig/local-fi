import { create } from "zustand";

// Drives the single global track-level tag editor host (mounted once in the root
// layout), so both the command palette's "Edit tags" action (M8) and any per-row
// edit button can open the same modal without each owning its own fetch/open state.
interface TagEditorState {
  trackId: number | null;
  open: (trackId: number) => void;
  close: () => void;
}

export const useTagEditorStore = create<TagEditorState>((set) => ({
  trackId: null,
  open: (trackId) => set({ trackId }),
  close: () => set({ trackId: null }),
}));
