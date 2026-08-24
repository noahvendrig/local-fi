import { ArtistDetailView } from "@/components/library/ArtistDetailView";

export default async function ArtistDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ArtistDetailView artistId={Number(id)} />;
}
