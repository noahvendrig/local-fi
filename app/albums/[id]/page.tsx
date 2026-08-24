import { AlbumDetailView } from "@/components/library/AlbumDetailView";

export default async function AlbumDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AlbumDetailView albumId={Number(id)} />;
}
