"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchArtist } from "@/lib/api-client";
import { AlbumGrid } from "./AlbumGrid";

export function ArtistDetailView({ artistId }: { artistId: number }) {
  const {
    data: artist,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["artist", artistId],
    queryFn: () => fetchArtist(artistId),
  });

  if (isLoading) return null;

  if (error || !artist) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
        <h1 className="font-serif text-2xl text-t1">Artist not found</h1>
        <Link href="/" className="text-sm font-medium text-acc-text hover:underline">
          Back to library
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-8 py-8">
      <Link href="/" className="w-fit text-xs font-medium text-t3 hover:text-t1">
        ← Library
      </Link>

      <h1 className="mt-4 font-serif text-3xl text-t1">{artist.name}</h1>
      <p className="mt-1 text-sm text-t2">
        {artist.albums.length} album{artist.albums.length === 1 ? "" : "s"}
      </p>

      <div className="mt-6">
        {artist.albums.length === 0 ? (
          <p className="text-sm text-t3">No albums yet.</p>
        ) : (
          <AlbumGrid albums={artist.albums} />
        )}
      </div>
    </div>
  );
}
