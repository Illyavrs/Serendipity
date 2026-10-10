import { LegacyBeatmapPage } from '@/features/canonical-beatmapset';
import { notFound } from 'next/navigation';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) notFound();
  return <LegacyBeatmapPage id={Number(id)} />;
}
