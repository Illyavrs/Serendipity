'use client';
import { NavigationLink as Link } from '@/components/navigation-motion';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import useSWR from 'swr';
import { PageHeading, Loading, LoadError, Empty, Pagination, Avatar } from '@/components/common';
import { CountryFlag } from '@/components/country-flag';
import { CountrySelect } from '@/components/country-select';
import { fetcher } from '@/lib/api';
import type { Page } from '@/lib/types';
import { RankingsTabs } from './top-plays';
import { readRankingSelection, updateRankingSelection } from '@/lib/ranking-url-state';

type PlaytimeRow = {
  id: number;
  username: string;
  country: string;
  avatar_url: string | null;
  play_time: number;
  play_count: number;
  position: number;
};

/** Players ranked by total time spent playing, across every mode. */
export function PlaytimeRankingsPage() {
  const t = useTranslations('rankings');
  const p = useTranslations('profile');
  const f = useFormatter();
  const search = useSearchParams();
  const options = { country: true };
  const { country, page } = readRankingSelection(search, options);
  const query = new URLSearchParams({ page: String(page), page_size: '50' });
  if (country) query.set('country', country);
  const { data, error, isLoading, mutate } = useSWR<Page<PlaytimeRow>>(
    `/leaderboard/playtime?${query}`,
    fetcher,
    { keepPreviousData: false, dedupingInterval: 0 },
  );
  return (
    <div className="page-container rankings-page">
      <PageHeading title={t('playtimeTitle')} description={t('playtimeSubtitle')} />
      <RankingsTabs active="playtime" />
      <section className="rankings-records glass" aria-label={t('playtimeTitle')}>
        <div className="filter-bar rankings-toolbar">
          <CountrySelect
            className="ranking-country-select"
            allowAll
            aria-label={t('country')}
            value={country}
            onValueChange={(next) => updateRankingSelection({ country: next }, options)}
          />
          <p className="hint">{t('playtimeNotice')}</p>
        </div>
        <div className="rankings-results">
          {isLoading ? (
            <Loading />
          ) : error ? (
            <LoadError retry={() => mutate()} />
          ) : !data?.items.length ? (
            <Empty title={t('playtimeEmptyTitle')} description={t('playtimeEmptyDescription')} />
          ) : (
            <div className="table-scroll">
              <table className="data-table rankings-table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">{t('player')}</th>
                    <th scope="col">{t('playtimeColumn')}</th>
                    <th scope="col">{t('playsColumn')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id}>
                      <td>{f.number(row.position)}</td>
                      <td>
                        <Link data-user-preview href={`/users/${row.id}`} className="player-cell">
                          <Avatar userId={row.id} name={row.username} url={row.avatar_url} />
                          <span>{row.username}</span>
                          <CountryFlag country={row.country} />
                        </Link>
                      </td>
                      <td>
                        {p('playTimeValue', {
                          hours: Math.floor(row.play_time / 3600),
                          minutes: Math.floor((row.play_time % 3600) / 60),
                        })}
                      </td>
                      <td>{f.number(row.play_count)}</td>
                    </tr>
                  ))}
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
          pageSize={50}
          onChange={(next) => updateRankingSelection({ page: next }, options)}
        />
      )}
    </div>
  );
}
