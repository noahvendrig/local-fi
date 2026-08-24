// Format badge — color-coded per ARCHITECTURE.md §9 semantic rules: `ok` marks a
// meaningfully "good" state (lossless), everything else stays neutral (`t2`/`surf-2`).
export function FormatBadge({ format, lossless }: { format: string; lossless: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide ${
        lossless ? "bg-ok/20 text-ok" : "bg-surf-2 text-t2"
      }`}
    >
      {format}
    </span>
  );
}
