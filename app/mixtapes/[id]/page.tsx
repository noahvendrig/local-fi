import { MixtapeDetailView } from "@/components/mixtapes/MixtapeDetailView";

export default async function MixtapeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MixtapeDetailView mixtapeId={Number(id)} />;
}
