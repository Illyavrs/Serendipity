'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import useSWR, { useSWRConfig } from 'swr';
import {
  ArrowRight,
  Bell,
  Check,
  CheckCheck,
  LoaderCircle,
  Megaphone,
  MessageSquare,
  Newspaper,
  RefreshCw,
  Trophy,
} from 'lucide-react';
import { NavigationLink as Link } from '@/components/navigation-motion';
import { Empty, PageHeading, Pagination, Protected } from '@/components/common';
import { useSession } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api';
import type { Notification, NotificationPage, NotificationReadResult } from '@/lib/types';
import './notifications.css';

const PAGE_SIZE = 20;
const isAccessError = (error: unknown) =>
  error instanceof ApiError && [401, 403].includes(error.status);

function useNotifications(userId: number, page: number, poll = false) {
  const { mutate: revalidate } = useSWRConfig();
  const { refresh } = useSession();
  const mounted = useRef(true);
  const saving = useRef(false);
  const [pending, setPending] = useState<number | 'all' | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [feedback, setFeedback] = useState<'read' | 'continue' | null>(null);
  const request = useSWR<NotificationPage>(
    ['notifications', userId, page, PAGE_SIZE],
    () => api<NotificationPage>(`/me/notifications?page=${page}&page_size=${PAGE_SIZE}`),
    {
      refreshInterval: poll ? 10000 : 0,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
      revalidateOnFocus: true,
      focusThrottleInterval: 5000,
      shouldRetryOnError: false,
      keepPreviousData: false,
    },
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function markRead(id: number | 'all') {
    const snapshot = request.data?.snapshot_id;
    if (
      saving.current ||
      (id === 'all' && (!snapshot || !request.data?.snapshot_size || request.error))
    )
      return;
    saving.current = true;
    setPending(id);
    setActionError(null);
    setFeedback(null);
    try {
      // The signed snapshot contains only the observed unread IDs. Consume it
      // once; a refreshed snapshot always needs another deliberate user action.
      const result = await api<NotificationReadResult>('/me/notifications/read', {
        method: 'POST',
        body: JSON.stringify(id === 'all' ? { through_id: snapshot } : { ids: [id] }),
      });
      if (!mounted.current) return;
      setFeedback(id === 'all' && result.unread_count > 0 ? 'continue' : 'read');
      await revalidate(
        (key: unknown) => Array.isArray(key) && key[0] === 'notifications' && key[1] === userId,
      );
    } catch (error) {
      if (!mounted.current) return;
      setActionError(error);
      if (isAccessError(error)) void refresh().catch(() => undefined);
    } finally {
      saving.current = false;
      if (mounted.current) setPending(null);
    }
  }
  async function reload() {
    if (saving.current) return;
    setActionError(null);
    setFeedback(null);
    await request.mutate();
  }
  const accessError = isAccessError(actionError) ? actionError : null;
  return {
    ...request,
    data: request.error || accessError ? undefined : request.data,
    error: accessError ?? request.error,
    actionError,
    feedback,
    pending,
    markRead,
    reload,
  };
}

function NotificationError({ error, retry }: { error: unknown; retry?: () => void }) {
  const t = useTranslations('notifications');
  const c = useTranslations('common');
  return (
    <div className="notification-error" role="alert">
      <p>{isAccessError(error) ? t('sessionExpired') : c('serviceError')}</p>
      {isAccessError(error) ? (
        <Button asChild variant="outline" size="sm">
          <Link href="/login">{c('signInRequired')}</Link>
        </Button>
      ) : retry ? (
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          <RefreshCw aria-hidden="true" />
          {c('retry')}
        </Button>
      ) : null}
    </div>
  );
}

function NotificationSkeleton({ compact = false }: { compact?: boolean }) {
  const c = useTranslations('common');
  return (
    <div className="notification-skeleton" role="status" aria-label={c('loading')}>
      {Array.from({ length: compact ? 3 : 5 }, (_, index) => (
        <div className="notification-skeleton-row" key={index}>
          <Skeleton className="notification-skeleton-icon" />
          <div>
            <Skeleton className="notification-skeleton-title" />
            <Skeleton className="notification-skeleton-meta" />
          </div>
        </div>
      ))}
    </div>
  );
}

function NotificationRows({
  items,
  pending,
  markRead,
  close,
}: {
  items: Notification[];
  pending: number | 'all' | null;
  markRead: (id: number | 'all') => Promise<void>;
  close?: () => void;
}) {
  const t = useTranslations('notifications');
  const f = useFormatter();
  return (
    <ul className="notification-rows">
      {items.map((item) => {
        const heading =
          item.kind === 'private_message'
            ? t('privateMessageTitle', { name: item.title })
            : item.title;
        return (
          <li key={item.id} data-unread={!item.read_at}>
            <span className="notification-kind-icon" aria-hidden="true">
              {item.kind === 'announcement_published' ? (
                <Newspaper />
              ) : item.kind === 'private_message' ? (
                <MessageSquare />
              ) : item.kind === 'broadcast' ? (
                <Megaphone />
              ) : (
                <Trophy />
              )}
            </span>
            <div className="notification-record">
              {item.href ? (
                <Link href={item.href} className="notification-title" onNavigate={close}>
                  {heading}
                </Link>
              ) : (
                <span className="notification-title">{heading}</span>
              )}
              {item.message && <p className="notification-message">{item.message}</p>}
              <div className="notification-meta">
                <span>{t(item.kind)}</span>
                <time
                  dateTime={item.created_at}
                  title={f.dateTime(new Date(item.created_at), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                >
                  {f.dateTime(new Date(item.created_at), { dateStyle: 'medium' })}
                </time>
                {!item.read_at && <span className="notification-unread-label">{t('unread')}</span>}
              </div>
            </div>
            {!item.read_at ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="notification-read-button"
                aria-label={t('markOne', { title: item.title })}
                title={t('markRead')}
                disabled={pending !== null}
                onClick={() => void markRead(item.id)}
              >
                {pending === item.id || pending === 'all' ? (
                  <LoaderCircle className="spin" aria-hidden="true" />
                ) : (
                  <Check aria-hidden="true" />
                )}
              </Button>
            ) : (
              <span className="notification-read-space" aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function NotificationFeedback({ feed }: { feed: ReturnType<typeof useNotifications> }) {
  const t = useTranslations('notifications');
  return feed.actionError && !feed.error ? (
    <NotificationError error={feed.actionError} retry={() => void feed.reload()} />
  ) : feed.feedback ? (
    <p className="notification-feedback" role="status">
      {t(feed.feedback === 'continue' ? 'readMore' : 'markedRead')}
    </p>
  ) : null;
}

export function NotificationBell({ userId }: { userId: number }) {
  const t = useTranslations('notifications');
  const c = useTranslations('common');
  const [open, setOpen] = useState(false);
  const feed = useNotifications(userId, 1, true);
  const unread = feed.data?.unread_count;
  const markLabel =
    feed.data && feed.data.unread_count > feed.data.snapshot_size
      ? t('markBatch', { count: feed.data.snapshot_size })
      : t('markAll');
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="notification-bell"
          aria-label={unread === undefined ? t('title') : t('open', { count: unread })}
        >
          <Bell aria-hidden="true" />
          {unread !== undefined && unread > 0 && (
            <span className="notification-count" aria-hidden="true">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="notification-popover"
        aria-labelledby="notification-popover-title"
        collisionPadding={12}
      >
        <div className="notification-popover-heading">
          <h2 id="notification-popover-title">{t('title')}</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!unread || feed.pending !== null}
            onClick={() => void feed.markRead('all')}
          >
            {feed.pending === 'all' ? (
              <LoaderCircle className="spin" aria-hidden="true" />
            ) : (
              <CheckCheck aria-hidden="true" />
            )}
            {markLabel}
          </Button>
        </div>
        <div className="notification-popover-body" aria-busy={feed.isLoading}>
          {feed.error ? (
            <NotificationError error={feed.error} retry={() => void feed.reload()} />
          ) : feed.isLoading ? (
            <NotificationSkeleton compact />
          ) : feed.data?.items.length ? (
            <NotificationRows
              items={feed.data.items.slice(0, 5)}
              pending={feed.pending}
              markRead={feed.markRead}
              close={() => setOpen(false)}
            />
          ) : (
            <p className="notification-empty">{t('empty')}</p>
          )}
          <NotificationFeedback feed={feed} />
        </div>
        <Link
          href="/notifications"
          className="notification-all-link"
          onNavigate={() => setOpen(false)}
        >
          {c('viewAll')}
          <ArrowRight aria-hidden="true" />
        </Link>
      </PopoverContent>
    </Popover>
  );
}

function NotificationInbox({ userId }: { userId: number }) {
  const t = useTranslations('notifications');
  const [page, setPage] = useState(1);
  const feed = useNotifications(userId, page);
  const lastPage = feed.data ? Math.max(1, Math.ceil(feed.data.total / PAGE_SIZE)) : page;
  const markLabel =
    feed.data && feed.data.unread_count > feed.data.snapshot_size
      ? t('markBatch', { count: feed.data.snapshot_size })
      : t('markAll');
  return (
    <section className="glass notification-inbox" aria-busy={feed.isLoading}>
      <div className="notification-inbox-toolbar" data-material="section">
        <p aria-live="polite">
          {feed.data ? t('unreadCount', { count: feed.data.unread_count }) : t('subtitle')}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!feed.data?.unread_count || feed.pending !== null}
          onClick={() => void feed.markRead('all')}
        >
          {feed.pending === 'all' ? (
            <LoaderCircle className="spin" aria-hidden="true" />
          ) : (
            <CheckCheck aria-hidden="true" />
          )}
          {markLabel}
        </Button>
      </div>
      {feed.error ? (
        <NotificationError error={feed.error} retry={() => void feed.reload()} />
      ) : feed.isLoading ? (
        <NotificationSkeleton />
      ) : feed.data?.items.length ? (
        <NotificationRows items={feed.data.items} pending={feed.pending} markRead={feed.markRead} />
      ) : (
        <Empty title={t('empty')} description={t('emptyDescription')} />
      )}
      <NotificationFeedback feed={feed} />
      {feed.data && page > lastPage ? (
        <div className="notification-page-recovery">
          <Button type="button" variant="outline" size="sm" onClick={() => setPage(lastPage)}>
            {t('lastPage')}
          </Button>
        </div>
      ) : feed.data ? (
        <Pagination page={page} total={feed.data.total} pageSize={PAGE_SIZE} onChange={setPage} />
      ) : null}
    </section>
  );
}

export function NotificationsPage() {
  const t = useTranslations('notifications');
  const { user } = useSession();
  return (
    <div className="page-container notification-page">
      <PageHeading title={t('title')} description={t('subtitle')} />
      <Protected>{user && <NotificationInbox key={user.id} userId={user.id} />}</Protected>
    </div>
  );
}
