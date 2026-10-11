'use client';
import { NavigationLink as Link } from '@/components/navigation-motion';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';
import { PageHeading, Loading, LoadError, Empty, Pagination } from '@/components/common';
import { useSession } from '@/components/providers';
import { UserCard, type CardUser } from '@/components/user-card';
import { RelationshipActions, useRelationships } from './social';
import { fetcher } from '@/lib/api';
import type { Page } from '@/lib/types';

const PAGE_SIZE = 24;

/** Everyone with a game client connected right now. */
export function OnlinePage() {
  const t = useTranslations('people');
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const page = Math.max(1, Number(search.get('page')) || 1);
  const { data, error, isLoading, mutate } = useSWR<Page<CardUser>>(
    `/users/online?page=${page}&page_size=${PAGE_SIZE}`,
    fetcher,
    { refreshInterval: 30_000, keepPreviousData: true },
  );
  return (
    <div className="page-container">
      <PageHeading title={t('onlineTitle')} description={t('onlineSubtitle')} />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <LoadError retry={() => mutate()} />
      ) : !data?.items.length ? (
        <Empty title={t('onlineEmptyTitle')} description={t('onlineEmptyDescription')} />
      ) : (
        <>
          <p className="hint">{t('onlineCount', { count: data.total })}</p>
          <ul className="user-card-grid">
            {data.items.map((user) => (
              <li key={user.id}>
                <UserCard user={user} />
              </li>
            ))}
          </ul>
        </>
      )}
      {data && !error && (
        <Pagination
          page={page}
          total={data.total}
          pageSize={PAGE_SIZE}
          onChange={(next) => router.push(next > 1 ? `${pathname}?page=${next}` : pathname)}
        />
      )}
    </div>
  );
}

/** The signed-in player's friend list as cards, with who is online first. */
export function FriendsPage() {
  const t = useTranslations('people');
  const c = useTranslations('common');
  const nav = useTranslations('nav');
  const { user } = useSession();
  const { data, error, mutate } = useRelationships();
  if (!user)
    return (
      <div className="page-container">
        <PageHeading title={t('friendsTitle')} description={t('friendsSubtitle')} />
        <Empty title={c('signInRequired')}>
          <Link href="/login">{nav('signIn')}</Link>
        </Empty>
      </div>
    );
  const friends = [...(data?.friends ?? [])].sort(
    (a, b) => Number(b.target.online) - Number(a.target.online),
  );
  return (
    <div className="page-container">
      <PageHeading title={t('friendsTitle')} description={t('friendsSubtitle')} />
      {error ? (
        <LoadError retry={() => mutate()} />
      ) : !data ? (
        <Loading />
      ) : !friends.length ? (
        <Empty title={t('friendsEmptyTitle')} description={t('friendsEmptyDescription')} />
      ) : (
        <ul className="user-card-grid">
          {friends.map((friend) => (
            <li key={friend.target_id}>
              <UserCard
                user={friend.target}
                showStatus
                actions={
                  <RelationshipActions
                    target={friend.target_id}
                    targetUsername={friend.target.username}
                    compact
                  />
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
