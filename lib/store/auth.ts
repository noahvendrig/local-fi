import { create } from "zustand";

// Populated once from a server-rendered prop (ARCHITECTURE.md §8) — the token
// never touches localStorage, only in-memory state re-supplied on navigation.
interface AuthState {
  token: string;
  setToken: (token: string) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: "",
  setToken: (token) => set({ token }),
}));
