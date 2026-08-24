"use client";

import { useSettingsStore } from "@/lib/store/settings";

// Overlay-style format chip from Local-fi.dc.html: hairline surface, lossless → ok, lossy → warn.
export function FormatBadge({ format, lossless }: { format: string; lossless: boolean }) {
  const showFormatBadges = useSettingsStore((s) => s.showFormatBadges);
  if (!showFormatBadges) return null;

  return (
    <span
      className={`inline-flex items-center rounded border border-line bg-surf px-[7px] py-[3px] font-mono text-[10px] uppercase tracking-wide ${
        lossless ? "text-ok" : "text-warn"
      }`}
    >
      {format}
    </span>
  );
}
