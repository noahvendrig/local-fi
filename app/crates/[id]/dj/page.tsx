import { DjCrateView } from "@/components/crates/dj/DjCrateView";

export default async function CrateDjPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DjCrateView playlistId={Number(id)} />;
}
