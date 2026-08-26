import { create } from "zustand";
import { isPaletteId, type PaletteId, type Theme } from "@/lib/theme/palettes";

export type { PaletteId, Theme };
export type ProgressStyle = "waveform" | "bar" | "spectrum";
export type TimeDisplay = "duration" | "remaining";
export type Density = "comfortable" | "compact";
export type NowPlayingBackdrop = "glass" | "solid";
export const CROSSFADE_SECONDS_OPTIONS = [0, 2, 3, 4] as const;
export type CrossfadeSeconds = (typeof CROSSFADE_SECONDS_OPTIONS)[number];
export type SeekStep = 5 | 10 | 15;

const STORAGE_KEY = "lf-settings";
const LEGACY_THEME_KEY = "lf-theme";

export interface PlayerSettings {
  theme: Theme;
  palette: PaletteId;
  progressStyle: ProgressStyle;
  timeDisplay: TimeDisplay;
  density: Density;
  nowPlayingBackdrop: NowPlayingBackdrop;
  reducedMotion: boolean;
  showTrackInTitle: boolean;
  vinylSpin: boolean;
  hotkeysEnabled: boolean;
  seekStep: SeekStep;
  trackNotifications: boolean;
  showFormatBadges: boolean;
  loudnessMatch: boolean;
  crossfadeSeconds: CrossfadeSeconds;
  compressImports: boolean;
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  theme: "dark",
  palette: "violet",
  progressStyle: "waveform",
  timeDisplay: "duration",
  density: "comfortable",
  nowPlayingBackdrop: "glass",
  reducedMotion: false,
  showTrackInTitle: true,
  vinylSpin: false,
  hotkeysEnabled: true,
  seekStep: 10,
  trackNotifications: false,
  showFormatBadges: true,
  loudnessMatch: true,
  crossfadeSeconds: 0,
  compressImports: false,
};

interface SettingsState extends PlayerSettings {
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setPalette: (palette: PaletteId) => void;
  setProgressStyle: (progressStyle: ProgressStyle) => void;
  setTimeDisplay: (timeDisplay: TimeDisplay) => void;
  setDensity: (density: Density) => void;
  setNowPlayingBackdrop: (nowPlayingBackdrop: NowPlayingBackdrop) => void;
  setReducedMotion: (reducedMotion: boolean) => void;
  setShowTrackInTitle: (showTrackInTitle: boolean) => void;
  setVinylSpin: (vinylSpin: boolean) => void;
  setHotkeysEnabled: (hotkeysEnabled: boolean) => void;
  setSeekStep: (seekStep: SeekStep) => void;
  setTrackNotifications: (trackNotifications: boolean) => void;
  setShowFormatBadges: (showFormatBadges: boolean) => void;
  setLoudnessMatch: (loudnessMatch: boolean) => void;
  setCrossfadeSeconds: (crossfadeSeconds: CrossfadeSeconds) => void;
  setCompressImports: (compressImports: boolean) => void;
  resetSettings: () => void;
  hydrateFromDom: () => void;
}

function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light";
}

function isCrossfadeSeconds(value: unknown): value is CrossfadeSeconds {
  return value === 0 || value === 2 || value === 3 || value === 4;
}

function parseStoredSettings(): PlayerSettings {
  const next = { ...DEFAULT_SETTINGS };
  const domTheme = document.documentElement.getAttribute("data-theme");
  const domPalette = document.documentElement.getAttribute("data-palette");
  const domDensity = document.documentElement.getAttribute("data-density");
  const domMotion = document.documentElement.getAttribute("data-motion");
  if (isTheme(domTheme)) next.theme = domTheme;
  if (isPaletteId(domPalette)) next.palette = domPalette;
  if (domDensity === "comfortable" || domDensity === "compact") next.density = domDensity;
  if (domMotion === "reduce") next.reducedMotion = true;
  if (domMotion === "full") next.reducedMotion = false;

  try {
    const legacyTheme = window.localStorage.getItem(LEGACY_THEME_KEY);
    if (isTheme(legacyTheme)) next.theme = legacyTheme;

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return next;
    const parsed = JSON.parse(raw) as Partial<PlayerSettings> & { trackFade?: number };
    if (isTheme(parsed.theme)) next.theme = parsed.theme;
    if (isPaletteId(parsed.palette)) next.palette = parsed.palette;
    if (parsed.progressStyle === "waveform" || parsed.progressStyle === "bar" || parsed.progressStyle === "spectrum") {
      next.progressStyle = parsed.progressStyle;
    }
    if (parsed.timeDisplay === "duration" || parsed.timeDisplay === "remaining") next.timeDisplay = parsed.timeDisplay;
    if (parsed.density === "comfortable" || parsed.density === "compact") next.density = parsed.density;
    if (parsed.nowPlayingBackdrop === "glass" || parsed.nowPlayingBackdrop === "solid") {
      next.nowPlayingBackdrop = parsed.nowPlayingBackdrop;
    }
    if (typeof parsed.reducedMotion === "boolean") next.reducedMotion = parsed.reducedMotion;
    if (typeof parsed.showTrackInTitle === "boolean") next.showTrackInTitle = parsed.showTrackInTitle;
    if (typeof parsed.vinylSpin === "boolean") next.vinylSpin = parsed.vinylSpin;
    if (typeof parsed.hotkeysEnabled === "boolean") next.hotkeysEnabled = parsed.hotkeysEnabled;
    if (parsed.seekStep === 5 || parsed.seekStep === 10 || parsed.seekStep === 15) next.seekStep = parsed.seekStep;
    if (typeof parsed.trackNotifications === "boolean") next.trackNotifications = parsed.trackNotifications;
    if (typeof parsed.showFormatBadges === "boolean") next.showFormatBadges = parsed.showFormatBadges;
    if (typeof parsed.loudnessMatch === "boolean") next.loudnessMatch = parsed.loudnessMatch;
    if (isCrossfadeSeconds(parsed.crossfadeSeconds)) {
      next.crossfadeSeconds = parsed.crossfadeSeconds;
    } else if (parsed.trackFade === 2 || parsed.trackFade === 3 || parsed.trackFade === 4) {
      next.crossfadeSeconds = parsed.trackFade;
    } else if (parsed.trackFade === 6) {
      next.crossfadeSeconds = 4;
    }
    if (typeof parsed.compressImports === "boolean") next.compressImports = parsed.compressImports;
  } catch {
    return next;
  }
  return next;
}

function persist(settings: PlayerSettings) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  window.localStorage.setItem(LEGACY_THEME_KEY, settings.theme);
}

function applyDom(settings: PlayerSettings) {
  const root = document.documentElement;
  root.setAttribute("data-theme", settings.theme);
  root.setAttribute("data-palette", settings.palette);
  root.setAttribute("data-density", settings.density);
  root.setAttribute("data-motion", settings.reducedMotion ? "reduce" : "full");
}

function snapshot(state: SettingsState): PlayerSettings {
  return {
    theme: state.theme,
    palette: state.palette,
    progressStyle: state.progressStyle,
    timeDisplay: state.timeDisplay,
    density: state.density,
    nowPlayingBackdrop: state.nowPlayingBackdrop,
    reducedMotion: state.reducedMotion,
    showTrackInTitle: state.showTrackInTitle,
    vinylSpin: state.vinylSpin,
    hotkeysEnabled: state.hotkeysEnabled,
    seekStep: state.seekStep,
    trackNotifications: state.trackNotifications,
    showFormatBadges: state.showFormatBadges,
    loudnessMatch: state.loudnessMatch,
    crossfadeSeconds: state.crossfadeSeconds,
    compressImports: state.compressImports,
  };
}

function commit(set: (partial: Partial<SettingsState>) => void, get: () => SettingsState, patch: Partial<PlayerSettings>) {
  set(patch);
  const next = snapshot(get());
  applyDom(next);
  persist(next);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,

  setTheme: (theme) => commit(set, get, { theme }),
  toggleTheme: () => commit(set, get, { theme: get().theme === "dark" ? "light" : "dark" }),
  setPalette: (palette) => commit(set, get, { palette }),
  setProgressStyle: (progressStyle) => commit(set, get, { progressStyle }),
  setTimeDisplay: (timeDisplay) => commit(set, get, { timeDisplay }),
  setDensity: (density) => commit(set, get, { density }),
  setNowPlayingBackdrop: (nowPlayingBackdrop) => commit(set, get, { nowPlayingBackdrop }),
  setReducedMotion: (reducedMotion) => commit(set, get, { reducedMotion }),
  setShowTrackInTitle: (showTrackInTitle) => commit(set, get, { showTrackInTitle }),
  setVinylSpin: (vinylSpin) => commit(set, get, { vinylSpin }),
  setHotkeysEnabled: (hotkeysEnabled) => commit(set, get, { hotkeysEnabled }),
  setSeekStep: (seekStep) => commit(set, get, { seekStep }),
  setTrackNotifications: (trackNotifications) => commit(set, get, { trackNotifications }),
  setShowFormatBadges: (showFormatBadges) => commit(set, get, { showFormatBadges }),
  setLoudnessMatch: (loudnessMatch) => commit(set, get, { loudnessMatch }),
  setCrossfadeSeconds: (crossfadeSeconds) => commit(set, get, { crossfadeSeconds }),
  setCompressImports: (compressImports) => commit(set, get, { compressImports }),
  resetSettings: () => commit(set, get, { ...DEFAULT_SETTINGS }),
  hydrateFromDom: () => {
    const next = parseStoredSettings();
    applyDom(next);
    persist(next);
    set(next);
  },
}));
