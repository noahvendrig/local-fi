import type { AlbumSummary } from "@/lib/api-client";
import { AlbumCard } from "./AlbumCard";

export function AlbumGrid({ albums }: { albums: AlbumSummary[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
      {albums.map((album) => (
        <AlbumCard key={album.id} album={album} />
      ))}
    </div>
  );
}
