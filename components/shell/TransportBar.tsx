// Persistent 88px transport bar. Empty in M0 — the <audio> element, waveform
// scrubber, and playback controls are wired up in M4/M5.
export function TransportBar() {
  return (
    <footer className="fixed inset-x-0 bottom-0 z-30 flex h-[88px] items-center justify-center border-t border-line bg-surf shadow-[var(--lf-shadow)]">
      <span className="text-sm text-t3">No track playing</span>
    </footer>
  );
}
