'use client';
import { NavigationLink as Link } from '@/components/navigation-motion';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';
import { PageHeading, GameMode, Loading, LoadError, Empty, Pagination } from '@/components/common';
import { ScoreVariantControl } from '@/components/score-selection';
import { CountrySelect } from '@/components/country-select';
import { fetcher } from '@/lib/api';
import type { Page, Score } from '@/lib/types';
import { ProfileScoreList } from '@/components/profile-score-list';
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
  // Same segmented look as the other two-way switches; each option is a real link.
  return (
    <nav className="segmented rankings-tabs" aria-label={t('title')}>
      <Link href={`/rankings${suffix}`} aria-current={active === 'players' ? 'page' : undefined}>
        {t('playersTab')}
      </Link>
      <Link
        href={`/rankings/top-plays${suffix}`}
        aria-current={active === 'top-plays' ? 'page' : undefined}
      >
        {t('topPlaysTab')}
      </Link>
    </nav>
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
    <div className="page-container rankings-page top-plays-page profile-page">
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
            <ProfileScoreList scores={data.items} best={false} ranked showPlayer />
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
