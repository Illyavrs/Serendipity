import { BeatmapAdminViewPage } from '@/features/beatmap-admin-view';

export default async function Page({ params }: { params: Promise<{ setId: string }> }) {
  const { setId } = await params;
  return <BeatmapAdminViewPage setId={setId} />;
}
