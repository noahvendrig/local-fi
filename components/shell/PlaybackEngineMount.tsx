"use client";

import { usePlaybackEngine } from "./usePlaybackEngine";

// TransportBar.tsx owns the real dual <audio> elements usePlaybackEngine() drives — on the
// existing LAN mobile view it's still mounted (just visually hidden via `hidden md:flex`), which
// is the only reason playback already works there. The standalone PWA has no room for
// TransportBar's own desktop-oriented UI (and it links into /artists/:id, a route standalone
// doesn't have), so this mounts just the audio engine itself with none of that chrome.
export function PlaybackEngineMount() {
  const { audioARef, audioBRef, handleTimeUpdate, handleEnded, handlePlay, handlePause } = usePlaybackEngine();
  return (
    <>
      <audio
        ref={audioARef}
        crossOrigin="anonymous"
        preload="auto"
        onTimeUpdate={(e) => handleTimeUpdate(0, e.currentTarget)}
        onEnded={() => handleEnded(0)}
        onPlay={() => handlePlay(0)}
        onPause={() => handlePause(0)}
      />
      <audio
        ref={audioBRef}
        crossOrigin="anonymous"
        preload="auto"
        onTimeUpdate={(e) => handleTimeUpdate(1, e.currentTarget)}
        onEnded={() => handleEnded(1)}
        onPlay={() => handlePlay(1)}
        onPause={() => handlePause(1)}
      />
    </>
  );
}
