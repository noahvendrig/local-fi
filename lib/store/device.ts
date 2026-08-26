import { create } from "zustand";

// Unlike lib/store/auth.ts's in-memory-only static token (re-supplied from the server on every
// navigation), a paired phone must survive app restarts with no server round-trip to recover
// its credential — this is the one thing that has to persist to localStorage.
const STORAGE_KEY = "lf-device";

interface StoredDevice {
  deviceId: number;
  serverUrl: string;
  deviceToken: string;
  deviceName: string;
  pairedAt: string;
}

function loadInitial(): StoredDevice | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDevice>;
    if (typeof parsed.deviceId !== "number" || typeof parsed.serverUrl !== "string" || typeof parsed.deviceToken !== "string") {
      return null;
    }
    return {
      deviceId: parsed.deviceId,
      serverUrl: parsed.serverUrl,
      deviceToken: parsed.deviceToken,
      deviceName: typeof parsed.deviceName === "string" ? parsed.deviceName : "This device",
      pairedAt: typeof parsed.pairedAt === "string" ? parsed.pairedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

interface DeviceState {
  device: StoredDevice | null;
  setPaired: (device: StoredDevice) => void;
  clearPairing: () => void;
}

// Paired-ness is derived at call sites (`useDeviceStore((s) => s.device !== null)`), matching
// how the rest of the codebase reads Zustand state — not stored as its own field, which would
// just be a second place to keep in sync with `device`.
export const useDeviceStore = create<DeviceState>((set) => ({
  device: loadInitial(),
  setPaired: (device) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(device));
    set({ device });
  },
  clearPairing: () => {
    window.localStorage.removeItem(STORAGE_KEY);
    set({ device: null });
  },
}));
