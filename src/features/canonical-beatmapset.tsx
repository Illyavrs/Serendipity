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

/** Old database-ID links keep working, but sharing resolves to native mapset identity. */
export function LegacyBeatmapPage({ id }: { id: number }) {
  const search = useSearchParams();
  const { navigate } = useNavigationProgress();
  const management = search.get('management') === '1';
  const { data } = useSWR<Beatmap>(management ? null : `/beatmaps/${id}`, fetcher, {
    shouldRetryOnError: false,
  });
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
  return <BeatmapPage id={id} />;
}
