import { notFound, permanentRedirect } from 'next/navigation';
import { parseBeatmapsetRoute, beatmapsetPath } from '@/lib/beatmap-routes';
import { LocalBeatmapsetPage } from '@/features/canonical-beatmapset';
import { OfficialBeatmapsetPage } from '@/features/public-official-maps';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ setId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { setId } = await params;
  const route = parseBeatmapsetRoute(setId);
  if (!route) notFound();
  if (route.local && !setId.startsWith('local-')) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams)) {
      if (Array.isArray(value)) value.forEach((item) => query.append(key, item));
      else if (value !== undefined) query.set(key, value);
    }
    permanentRedirect(`${beatmapsetPath(route.id, 'local')}${query.size ? `?${query}` : ''}`);
  }
  return route.local ? (
    <LocalBeatmapsetPage setId={route.id} />
  ) : (
    <OfficialBeatmapsetPage setId={String(route.id)} />
  );
}
