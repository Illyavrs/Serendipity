'use client';
import { NavigationLink as Link } from '@/components/navigation-motion';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';
import { PageHeading, GameMode, Loading, LoadError, Empty, Pagination } from '@/components/common';
import { ScoreVariantControl } from '@/components/score-selection';
import { CountrySelect } from '@/components/country-select';
import { fetcher } from '@/lib/api';
import type { Page, Score } from '@/lib/types';
import { ScoreTable } from './scores';
import { readRankingSelection, updateRankingSelection } from '@/lib/ranking-url-state';

export function RankingsTabs({ active }: { active: 'players' | 'top-plays' }) {
  const t = useTranslations('rankings');
  const search = useSearchParams();
  const query = new URLSearchParams();
  for (const key of ['mode', 'variant', 'country']) {
    const value = search.get(key);
    if (value) query.set(key, value);
  }
  const suffix = query.toString() ? `?${query}` : '';
  // Route-backed tabs: each trigger is a real link, so activation never needs client state.
  return (
    <Tabs value={active} activationMode="manual" className="rankings-tabs">
      <TabsList variant="line" aria-label={t('title')}>
        <TabsTrigger value="players" asChild>
          <Link href={`/rankings${suffix}`}>{t('playersTab')}</Link>
        </TabsTrigger>
        <TabsTrigger value="top-plays" asChild>
          <Link href={`/rankings/top-plays${suffix}`}>{t('topPlaysTab')}</Link>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

export function TopPlaysPage() {
  const t = useTranslations('rankings');
  const c = useTranslations('common');
  const search = useSearchParams();
  const options = { country: true };
  const { mode, variant, country, page } = readRankingSelection(search, options);
  const query = new URLSearchParams({ mode, variant, page: String(page), page_size: '24' });
  if (country) query.set('country', country);
  const { data, error, isLoading, mutate } = useSWR<Page<Score>>(
    `/leaderboard/top-plays?${query}`,
    fetcher,
    { keepPreviousData: false, dedupingInterval: 0 },
  );
  return (
    <div className="page-container rankings-page top-plays-page">
      <PageHeading title={t('topPlaysTitle')} description={t('topPlaysSubtitle')} />
      <RankingsTabs active="top-plays" />
      <section className="rankings-records glass" aria-label={t('topPlaysTitle')}>
        <div className="filter-bar rankings-toolbar">
          <GameMode
            value={mode}
            onChange={(next) => updateRankingSelection({ mode: next }, options)}
          />
          <ScoreVariantControl
            mode={mode}
            value={variant}
            onChange={(next) => updateRankingSelection({ variant: next }, options)}
          />
          <CountrySelect
            className="ranking-country-select"
            allowAll
            aria-label={t('country')}
            value={country}
            onValueChange={(next) => updateRankingSelection({ country: next }, options)}
          />
          <p className="hint">{t('modeNotice')}</p>
        </div>
        {mode === '3' && <p className="hint">{c('relaxUnsupported')}</p>}
        <div className="rankings-results">
          {isLoading ? (
            <Loading />
          ) : error ? (
            <LoadError retry={() => mutate()} />
          ) : !data?.items.length ? (
            <Empty title={t('topPlaysEmptyTitle')} description={t('topPlaysEmptyDescription')} />
          ) : (
            <ScoreTable scores={data.items} topPlays />
          )}
        </div>
      </section>
      {data && !error && (
        <Pagination
          page={page}
          total={data.total}
          onChange={(next) => updateRankingSelection({ page: next }, options)}
        />
      )}
    </div>
  );
}
