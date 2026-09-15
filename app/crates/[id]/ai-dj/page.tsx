import { AiDjCrateView } from "@/components/crates/aidj/AiDjCrateView";

export default async function CrateAiDjPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AiDjCrateView playlistId={Number(id)} />;
}
