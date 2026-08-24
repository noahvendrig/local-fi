import Link from "next/link";
import { withAuthQuery } from "@/lib/api/http";
import type { AlbumSummary } from "@/lib/api-client";
import { FormatBadge } from "./FormatBadge";

export function AlbumCard({ album, isPlaying }: { album: AlbumSummary; isPlaying?: boolean }) {
  return (
    <Link
      href={`/albums/${album.id}`}
      className="lf-card lf-album-card group min-w-0 rounded-2xl p-4 transition-[background,border-color] duration-150 hover:border-t3 hover:bg-surf-2"
    >
      <div className="lf-hatch relative aspect-square overflow-hidden rounded-[20px] shadow-[var(--lf-art-shadow)]">
        {album.coverArtUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- local-only images, no benefit from next/image's remote optimization pipeline
          <img
            src={withAuthQuery(album.coverArtUrl)}
            alt=""
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center px-3 text-center" aria-hidden>
            <span className="font-mono text-[10.5px] leading-[1.4] text-t3">no art · {album.format ?? "album"}</span>
          </div>
        )}
        {album.format && (
          <div className="absolute left-2.5 top-2.5">
            <FormatBadge format={album.format} lossless={album.lossless} />
          </div>
        )}
      </div>
      <div className="mt-3.5 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className={`truncate text-base font-semibold leading-[1.4] ${isPlaying ? "text-playing" : "text-t1"}`} title={album.title}>
            {album.title}
          </p>
          <p className="truncate text-sm leading-[1.5] text-t2" title={album.albumArtistName}>
            {album.albumArtistName}
          </p>
        </div>
        {album.year ? <span className="pt-0.5 font-mono text-xs text-t3">{album.year}</span> : null}
      </div>
    </Link>
  );
}
