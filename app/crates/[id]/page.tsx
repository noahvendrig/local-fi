import { CrateDetailView } from "@/components/crates/CrateDetailView";

export default async function CrateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CrateDetailView playlistId={Number(id)} />;
}
