// Label that appears above a control on hover/focus. Used by the transport bar
// (and anything else wrapping with `group relative`).
export function HoverTip({ text }: { text: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded border border-line bg-bg px-2 py-1 font-mono text-[11px] text-t1 opacity-0 shadow-[var(--lf-shadow)] transition-opacity delay-75 group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {text}
    </span>
  );
}

// Small icon-only control button shared by the transport bar and Now Playing overlay.
export function IconButton({
  onClick,
  label,
  active,
  size = "sm",
  disabled,
  children,
}: {
  onClick: () => void;
  label: string;
  active?: boolean;
  size?: "sm" | "lg" | "xl";
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const dimension = size === "xl" ? "h-14 w-14" : size === "lg" ? "h-11 w-11" : "h-8 w-8";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={`group relative flex ${dimension} shrink-0 items-center justify-center rounded-md ${active ? "text-acc-text" : "text-t2"} ${disabled ? "cursor-default opacity-40" : "hover:bg-surf-2 hover:text-t1"}`}
    >
      {children}
      <HoverTip text={label} />
    </button>
  );
}
