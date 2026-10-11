'use client';

import { useEffect } from 'react';
import useSWR from 'swr';
import { useSearchParams } from 'next/navigation';
import { Empty, Loading, LoadError } from '@/components/common';
import { useNavigationProgress } from '@/components/navigation-motion';
import { useTranslations } from 'next-intl';
import { BeatmapPage } from './beatmaps';
import { usePublicData } from './map-discovery';
import {
  canonicalBeatmapHref,
  rememberCatalogueReturn,
  beatmapsetPath,
  beatmapDifficultyHash,
  parseBeatmapDifficultyHash,
} from '@/lib/beatmap-routes';
import {
  setBeatmapDifficultyLocation,
  useBeatmapDifficultyHash,
  useCatalogueReturn,
} from './beatmap-route-state';
import { ApiError, fetcher } from '@/lib/api';
import type { Beatmap } from '@/lib/types';

export function LocalBeatmapsetPage({ setId }: { setId: number }) {
  const hash = useBeatmapDifficultyHash();
  const selected = parseBeatmapDifficultyHash(hash);
  useCatalogueReturn();
  const c = useTranslations('common');
  const availability = useTranslations('mapAvailability');
  const suffix = selected?.id
    ? `?difficulty=${selected.id}`
    : selected
      ? `?mode=${selected.mode}`
      : '';
  const { data, error, loading, retry } = usePublicData<Beatmap>(`/beatmapsets/${setId}${suffix}`);
  const map =
    data?.source === 'local' &&
    data.native_set_id === setId &&
    (!selected?.id || data.native_id === selected.id)
      ? data
      : undefined;
  useEffect(() => {
    if (
      !map ||
      window.location.pathname !== beatmapsetPath(setId, 'local') ||
      window.location.hash !== hash
    )
      return;
    const canonical = new URL(canonicalBeatmapHref(map), window.location.origin);
    canonical.search = window.location.search;
    canonical.searchParams.delete('difficulty');
    canonical.searchParams.delete('returnTo');
    setBeatmapDifficultyLocation(`${canonical.pathname}${canonical.search}${canonical.hash}`, true);
  }, [map, setId, hash]);
  if (loading)
    return (
      <div className="page-container">
        <Loading />
      </div>
    );
  if (error || !map)
    return (
      <div className="page-container">
        {error instanceof ApiError && error.status === 410 ? (
          <Empty title={availability('publicTitle')} description={availability('publicHint')} />
        ) : error instanceof ApiError && error.status === 404 ? (
          <Empty title={c('empty')} />
        ) : (
          <LoadError retry={retry} />
        )}
      </div>
    );
  return <BeatmapPage key={map.id} id={map.id} />;
}

type ResolvedDifficulty = { source: string; set_id: number; mode: number; id: number };

/**
 * `/beatmaps/<difficulty id>` is the short link osu! uses: it resolves the difficulty to its set and
 * opens `/beatmapsets/<set>#<mode>/<id>`. Ids that match no known difficulty fall back to the old
 * database-ID links, which keep working but share as native mapset identity.
 */
export function LegacyBeatmapPage({ id }: { id: number }) {
  const search = useSearchParams();
  const { navigate } = useNavigationProgress();
  const management = search.get('management') === '1';
  const resolved = useSWR<ResolvedDifficulty>(
    management ? null : `/official/beatmaps/${id}/resolve`,
    fetcher,
    { shouldRetryOnError: false, revalidateOnFocus: false },
  );
  // The old database-ID lookup only starts once the short link is known not to apply.
  const legacy = management || !!resolved.error;
  const { data } = useSWR<Beatmap>(legacy && !management ? `/beatmaps/${id}` : null, fetcher, {
    shouldRetryOnError: false,
  });
  useEffect(() => {
    const target = resolved.data;
    if (!target || window.location.pathname !== `/beatmaps/${id}`) return;
    const href = `${beatmapsetPath(target.set_id, target.source === 'local' ? 'local' : 'official')}${beatmapDifficultyHash(target.mode, target.id)}`;
    let current = true;
    queueMicrotask(() => {
      if (current && window.location.pathname === `/beatmaps/${id}`)
        navigate(href, { replace: true, scroll: false });
    });
    return () => {
      current = false;
    };
  }, [resolved.data, navigate, id]);
  useEffect(() => {
    if (
      !data ||
      management ||
      window.location.pathname !== `/beatmaps/${id}` ||
      new URLSearchParams(window.location.search).toString() !== search.toString()
    )
      return;
    const href = canonicalBeatmapHref(data, {
      mode: search.get('mode') ?? undefined,
      variant: search.get('variant') === 'relax' ? 'relax' : 'vanilla',
    });
    if (!href.startsWith('/beatmapsets/')) return;
    let current = true;
    // Navigation paints a transition synchronously; schedule it outside React's lifecycle.
    queueMicrotask(() => {
      if (
        !current ||
        window.location.pathname !== `/beatmaps/${id}` ||
        new URLSearchParams(window.location.search).toString() !== search.toString()
      )
        return;
      rememberCatalogueReturn(href, search.get('returnTo'));
      navigate(href, { replace: true, scroll: false });
    });
    return () => {
      current = false;
    };
  }, [data, management, navigate, search, id]);
  if (!legacy) return <Loading />;
  return <BeatmapPage id={id} />;
}
