"use client";

import { withAuthQuery } from "@/lib/api/http";
import { AlbumPlaceholderIcon } from "@/components/shell/PlayerIcons";

// Small album art for track rows. Falls back to hatch + placeholder when missing.
// Inside .lf-track-row, size comes from --lf-track-cover-size in globals.css.
export function TrackCoverThumb({
  coverArtUrl,
  size = 36,
  className,
}: {
  coverArtUrl: string | null;
  size?: number;
  className?: string;
}) {
  const usesRowSize = className?.includes("lf-track-cover");
  return (
    <div
      className={`lf-hatch shrink-0 overflow-hidden rounded-md ${className ?? ""}`}
      style={usesRowSize ? undefined : { width: size, height: size }}
    >
      {coverArtUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- local-only images
        <img src={withAuthQuery(coverArtUrl)} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-t3" aria-hidden>
          <AlbumPlaceholderIcon />
        </div>
      )}
    </div>
  );
}
