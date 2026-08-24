import Link from "next/link";
import { withAuthQuery } from "@/lib/api/http";
import type { AlbumSummary } from "@/lib/api-client";
import { FormatBadge } from "./FormatBadge";

export function AlbumCard({ album }: { album: AlbumSummary }) {
  return (
    <Link href={`/albums/${album.id}`} className="group flex flex-col gap-2">
      <div className="relative aspect-square overflow-hidden rounded-lg bg-surf-2 shadow-[var(--lf-art-shadow)]">
        {album.coverArtUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- local-only images, no benefit from next/image's remote optimization pipeline
          <img
            src={withAuthQuery(album.coverArtUrl)}
            alt=""
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-t3" aria-hidden>
            <AlbumPlaceholderIcon />
          </div>
        )}
        {album.format && (
          <div className="absolute left-2 top-2">
            <FormatBadge format={album.format} lossless={album.lossless} />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-t1" title={album.title}>
          {album.title}
        </p>
        <p className="truncate text-xs text-t2" title={album.albumArtistName}>
          {album.albumArtistName}
        </p>
      </div>
    </Link>
  );
}

function AlbumPlaceholderIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}
