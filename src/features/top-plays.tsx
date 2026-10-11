'use client';
import { NavigationLink as Link } from '@/components/navigation-motion';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import useSWR from 'swr';
import { Badge } from '@/components/ui/badge';
import {
  PageHeading,
  GameMode,
  Loading,
  LoadError,
  Empty,
  Pagination,
  Avatar,
} from '@/components/common';
import { ScoreVariantControl } from '@/components/score-selection';
import { CountryFlag } from '@/components/country-flag';
import { CountrySelect } from '@/components/country-select';
import { fetcher } from '@/lib/api';
import { scoreMods } from '@/lib/score-display';
import type { Page, Score } from '@/lib/types';
import { readRankingSelection, updateRankingSelection } from '@/lib/ranking-url-state';

type TopPlay = Score & { country?: string | null; avatar_url?: string | null };

export function RankingsTabs({ active }: { active: 'players' | 'top-plays' }) {
  const t = useTranslations('rankings');
  const search = useSearchParams();
  const query = new URLSearchParams();
  for (const key of ['mode', 'variant', 'country']) {
    const value = search.get(key);
    if (value) query.set(key, value);
  }
  const suffix = query.toString() ? `?${query}` : '';
  return (
    <nav className="filter-bar" aria-label={t('title')}>
      <Link
        href={`/rankings${suffix}`}
        aria-current={active === 'players' ? 'page' : undefined}
        className={active === 'players' ? 'font-semibold' : 'hint'}
      >
        {t('playersTab')}
      </Link>
      <Link
        href={`/rankings/top-plays${suffix}`}
        aria-current={active === 'top-plays' ? 'page' : undefined}
        className={active === 'top-plays' ? 'font-semibold' : 'hint'}
      >
        {t('topPlaysTab')}
      </Link>
    </nav>
  );
}

export function TopPlaysPage() {
  const t = useTranslations('rankings');
  const c = useTranslations('common');
  const f = useFormatter();
  const search = useSearchParams();
  const options = { country: true };
  const { mode, variant, country, page } = readRankingSelection(search, options);
  const query = new URLSearchParams({ mode, variant, page: String(page), page_size: '24' });
  if (country) query.set('country', country);
  const { data, error, isLoading, mutate } = useSWR<Page<TopPlay>>(
    `/leaderboard/top-plays?${query}`,
    fetcher,
    { keepPreviousData: false, dedupingInterval: 0 },
  );
  return (
    <div className="page-container rankings-page">
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
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label={t('topPlaysTitle')}
            >
              <table className="data-table rankings-table">
                <thead>
                  <tr>
                    <th scope="col">{t('rank')}</th>
                    <th scope="col">{t('player')}</th>
                    <th scope="col">{t('beatmap')}</th>
                    <th scope="col">{t('performance')}</th>
                    <th scope="col">{c('accuracy')}</th>
                    <th scope="col">{t('mods')}</th>
                    <th scope="col">{t('playedAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((play) => {
                    const mods = scoreMods(play).labels;
                    return (
                      <tr
                        key={play.id}
                        data-rank={(play.position ?? 0) <= 3 ? play.position : undefined}
                      >
                        <td className="rank-cell">#{f.number(play.position ?? 0)}</td>
                        <td>
                          <Link
                            href={`/users/${play.user_id}?mode=${play.mode}&variant=${play.score_variant ?? 'vanilla'}`}
                            className="player-cell"
                          >
                            <Avatar name={play.username} url={play.avatar_url ?? null} />
                            {play.username}
                          </Link>
                          {play.country && <CountryFlag country={play.country} />}
                        </td>
                        <td>
                          <Link href={`/scores/${play.id}`} className="score-title">
                            {play.artist ? `${play.artist} - ` : ''}
                            {play.title} [{play.version}]
                          </Link>
                        </td>
                        <td className="pp-value">
                          {f.number(play.pp, { maximumFractionDigits: 2 })} <span>pp</span>
                        </td>
                        <td>{play.accuracy.toFixed(2)}%</td>
                        <td>
                          {mods.length
                            ? mods.map((mod) => (
                                <Badge key={mod} variant="outline">
                                  {mod}
                                </Badge>
                              ))
                            : '—'}
                        </td>
                        <td>
                          <time dateTime={play.created_at}>
                            {f.dateTime(new Date(play.created_at), { dateStyle: 'medium' })}
                          </time>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
