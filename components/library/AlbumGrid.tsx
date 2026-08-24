"use client";

import type { AlbumSummary } from "@/lib/api-client";
import { usePlayerStore } from "@/lib/store/player";
import { AlbumCard } from "./AlbumCard";

export function AlbumGrid({ albums }: { albums: AlbumSummary[] }) {
  const currentAlbumId = usePlayerStore((s) => s.currentTrack?.albumId);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-6">
      {albums.map((album) => (
        <AlbumCard
          key={album.id}
          album={album}
          isPlaying={isPlaying && currentAlbumId === album.id}
        />
      ))}
    </div>
  );
}
