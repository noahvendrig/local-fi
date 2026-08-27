// Centralized navigator.mediaSession wiring — the lock-screen / notification / hardware-media-key
// seam. Mounted once via components/shell/MediaSessionMount.tsx in both app/layout.tsx and
// apps/standalone/app/layout.tsx. Source-aware: it reflects whichever transport source is
// audible (useTransportSourceStore.activeSource) — the regular queue player (usePlayerStore) or
// the DJ deck (useDjStore) — so its metadata, position and transport buttons always track the
// deck the user actually hears.
//
// Known limitation (see the playback architecture doc): every <audio> element is permanently
// routed through Web Audio (lib/audio/equalizer.ts, createMediaElementSource — one-shot per
// element, singleton graph). Desktop browsers and Android-Firefox-in-a-tab brand the media
// widget with the browser name and Firefox degrades the rich UI for Web-Audio-captured
// elements; app-branded controls require installing the PWA. Nothing here can change that.

import { computeDjAdjustment } from "@/lib/audio/djMatch";
import type { TrackSummary } from "@/lib/api-client";
import { resolveArtworkSrc } from "@/lib/offline/playback";
import { useDjStore } from "@/lib/store/dj";
import { usePlayerStore } from "@/lib/store/player";
import { useSettingsStore } from "@/lib/store/settings";
import { useTransportSourceStore } from "@/lib/store/transportSource";

export interface MediaSessionController {
  stop(): void;
}

interface ActiveView {
  kind: "regular" | "dj";
  track: TrackSummary | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  playbackRate: number;
  canSkip: boolean;
}

const ICON_ARTWORK: MediaImage[] = [
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
];
const ARTWORK_SIZES = ["96x96", "128x128", "192x192", "256x256", "384x384", "512x512"];

function activeView(): ActiveView {
  const source = useTransportSourceStore.getState().activeSource;
  const dj = useDjStore.getState();
  if (source === "dj" && dj.currentTrack) {
    const { tempoRatio } = computeDjAdjustment(
      dj.currentTrack,
      dj.targetBpm,
      dj.targetKey,
      dj.keyLockEnabled,
      dj.targetOctave
    );
    return {
      kind: "dj",
      track: dj.currentTrack,
      isPlaying: dj.isPlaying,
      position: dj.currentTime,
      duration: dj.currentTrack.durationSeconds,
      playbackRate: tempoRatio || 1,
      canSkip: false,
    };
  }
  const player = usePlayerStore.getState();
  return {
    kind: "regular",
    track: player.currentTrack,
    isPlaying: player.isPlaying,
    position: player.currentTime,
    duration: player.currentTrack?.durationSeconds ?? 0,
    playbackRate: 1,
    canSkip: true,
  };
}

function seekActive(delta: number) {
  const view = activeView();
  const target = view.position + delta;
  if (view.kind === "dj") useDjStore.getState().seekTo(target);
  else usePlayerStore.getState().seekTo(target);
}

function seekActiveTo(seconds: number) {
  if (activeView().kind === "dj") useDjStore.getState().seekTo(seconds);
  else usePlayerStore.getState().seekTo(seconds);
}

function setPlayingActive(playing: boolean) {
  if (activeView().kind === "dj") useDjStore.getState().setDjPlaying(playing);
  else usePlayerStore.getState().setPlaying(playing);
}

function trySetHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // Some browsers throw for actions they don't recognize (older Safari: "stop", "seekto").
  }
}

export function startMediaSession(): MediaSessionController {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return { stop() {} };
  }

  const session = navigator.mediaSession;
  let tickerId = 0;
  let artworkGen = 0;
  let lastTrackKey: string | null = null;
  let lastPlaybackState: MediaSessionPlaybackState | null = null;
  let lastSkip: boolean | null = null;
  let scheduled = false;
  let disposed = false;

  const stopTicker = () => {
    if (tickerId) {
      window.clearInterval(tickerId);
      tickerId = 0;
    }
  };

  const setPositionStateSafe = (view: ActiveView) => {
    if (!("setPositionState" in session)) return;
    const { duration } = view;
    if (!Number.isFinite(duration) || duration <= 0) {
      try {
        session.setPositionState();
      } catch {
        /* out-of-range in some browsers */
      }
      return;
    }
    const position = Math.min(Math.max(view.position, 0), duration);
    try {
      session.setPositionState({ duration, playbackRate: view.playbackRate || 1, position });
    } catch {
      /* out-of-range in some browsers */
    }
  };

  const applyMetadata = (view: ActiveView) => {
    const track = view.track!;
    const title = track.title ?? "Untitled";
    const artist = track.artistName ?? "Unknown artist";
    const album = track.albumTitle ?? "";
    // Text first, immediately (not gated on isPlaying) so the OS shows something at once; the
    // fallback icon keeps the lock screen from flashing blank while the real cover resolves.
    try {
      session.metadata = new MediaMetadata({ title, artist, album, artwork: ICON_ARTWORK });
    } catch {
      return;
    }
    const gen = ++artworkGen;
    void resolveArtworkSrc(track)
      .then((art) => {
        if (disposed || gen !== artworkGen || !art) return;
        const artwork: MediaImage[] = [
          ...ARTWORK_SIZES.map((sizes) => ({ src: art.src, sizes, type: art.type || undefined })),
          ...ICON_ARTWORK,
        ];
        try {
          session.metadata = new MediaMetadata({ title, artist, album, artwork });
        } catch {
          /* keep the text-only metadata already set */
        }
      })
      .catch(() => {
        /* keep the text-only metadata already set */
      });
  };

  const update = () => {
    if (disposed) return;
    const view = activeView();

    const trackKey = view.track ? `${view.kind}:${view.track.id}` : null;
    if (trackKey !== lastTrackKey) {
      lastTrackKey = trackKey;
      if (!view.track) {
        artworkGen++;
        session.metadata = null;
        lastPlaybackState = null;
        stopTicker();
      } else {
        applyMetadata(view);
      }
    }

    if (!view.track) return;

    const playbackState: MediaSessionPlaybackState = view.isPlaying ? "playing" : "paused";
    if (playbackState !== lastPlaybackState) {
      lastPlaybackState = playbackState;
      try {
        session.playbackState = playbackState;
      } catch {
        /* not all browsers expose the setter */
      }
    }

    if (view.canSkip !== lastSkip) {
      lastSkip = view.canSkip;
      trySetHandler("previoustrack", view.canSkip ? () => usePlayerStore.getState().playPrevious() : null);
      trySetHandler("nexttrack", view.canSkip ? () => usePlayerStore.getState().playNext() : null);
    }

    setPositionStateSafe(view);

    // Ticker runs only while playing — a paused deck on the lock screen shouldn't burn a wakeup
    // every second, and its position isn't moving anyway.
    if (view.isPlaying && !tickerId) {
      tickerId = window.setInterval(() => {
        if (disposed) return;
        setPositionStateSafe(activeView());
      }, 1000);
    } else if (!view.isPlaying) {
      stopTicker();
    }
  };

  const schedule = () => {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      update();
    });
  };

  // Handlers that don't depend on the active source are registered once and never touched again.
  trySetHandler("play", () => setPlayingActive(true));
  trySetHandler("pause", () => setPlayingActive(false));
  trySetHandler("stop", () => setPlayingActive(false));
  trySetHandler("seekbackward", () => seekActive(-useSettingsStore.getState().seekStep));
  trySetHandler("seekforward", () => seekActive(useSettingsStore.getState().seekStep));
  trySetHandler("seekto", (details) => {
    if (typeof details.seekTime === "number") seekActiveTo(details.seekTime);
  });

  const unsubscribes = [
    useTransportSourceStore.subscribe(schedule),
    usePlayerStore.subscribe(schedule),
    useDjStore.subscribe(schedule),
  ];

  update();

  return {
    stop() {
      if (disposed) return;
      disposed = true;
      stopTicker();
      for (const off of unsubscribes) off();
      for (const action of [
        "play",
        "pause",
        "stop",
        "previoustrack",
        "nexttrack",
        "seekbackward",
        "seekforward",
        "seekto",
      ] as MediaSessionAction[]) {
        trySetHandler(action, null);
      }
      try {
        session.metadata = null;
        session.playbackState = "none";
      } catch {
        /* best effort */
      }
    },
  };
}
