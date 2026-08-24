// Shared icon set for playback controls — used by TransportBar, NowPlayingOverlay, and RightRail
// so the same glyphs don't get redefined per surface.

type IconSizeProps = { size?: number };

export function PlayIcon({ size = 14 }: IconSizeProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5 3v18l16-9z" />
    </svg>
  );
}

export function PauseIcon({ size = 14 }: IconSizeProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}

export function PreviousIcon({ size = 14 }: IconSizeProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 5h2v14H6zM20 5v14L9 12z" />
    </svg>
  );
}

export function NextIcon({ size = 14 }: IconSizeProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 5h2v14h-2zM4 5v14l11-7z" />
    </svg>
  );
}

export function ShuffleIcon({ size = 14 }: IconSizeProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h3.5L15 18h3.5" />
      <path d="M14.5 6H18.5L18.5 10" />
      <path d="M3 18h3.5L10 13" />
      <path d="M14.5 18H18.5L18.5 14" />
    </svg>
  );
}

export function RepeatIcon({ size = 14 }: IconSizeProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

export function RepeatOneIcon({ size = 14 }: IconSizeProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      <path d="M12 8v5" fill="none" />
    </svg>
  );
}

export function QueueIcon({ size = 14 }: IconSizeProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M3 12h18M3 18h10" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function PlayingIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-playing">
      <path d="M6 4l14 8-14 8z" />
    </svg>
  );
}

export function AlbumPlaceholderIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

export function EqIcon({ size = 14 }: IconSizeProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="10" width="3" height="10" rx="1" />
      <rect x="10.5" y="4" width="3" height="16" rx="1" />
      <rect x="17" y="8" width="3" height="12" rx="1" />
    </svg>
  );
}
