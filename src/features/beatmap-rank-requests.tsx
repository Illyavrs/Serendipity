'use client';

import { Markdown } from '@/components/markdown';
import { Suspense, useId, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import useSWR, { unstable_serialize, useSWRConfig } from 'swr';
import { ArrowLeft, ArrowRight, Check, LoaderCircle, RefreshCw } from 'lucide-react';
import { NavigationLink as Link } from '@/components/navigation-motion';
import { Avatar, Empty, Loading, PageHeading, Pagination, Protected } from '@/components/common';
import { useSession } from '@/components/providers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldSelect } from '@/components/ui/field-select';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError, fetcher, hasPermission } from '@/lib/api';
import type { Page } from '@/lib/types';
import { useDeniedResponseGuard } from './admin-moderation';
import styles from './beatmap-rank-requests.module.css';
import { beatmapsetPath, beatmapDifficultyHash } from '@/lib/beatmap-routes';

export type RankRequestStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';
export type RankRequestDifficulty = {
  native_id: number;
  version: string;
  mode: number;
  stars: number;
  status: string;
  revision: number;
  status_revision: number | null;
};
export type RankRequestDifficultyPreview = Pick<
  RankRequestDifficulty,
  'native_id' | 'version' | 'mode' | 'stars'
> & { status?: string };
type RequestActionProps = {
  target: RequestTarget;
  initialDifficulties?: RankRequestDifficultyPreview[];
  localMapId?: number;
};
type Identity = { id: number; username: string; country: string; avatar_url: string | null };
export type BeatmapRankRequest = {
  id: number;
  native_set_id: number;
  source: 'local' | 'official';
  requester: Identity;
  reason: string;
  status: RankRequestStatus;
  revision: number;
  metadata: {
    title: string;
    artist: string;
    creator: string;
    difficulty_count: number;
    official_url: string | null;
  };
  review_reason: string | null;
  reviewer: Identity | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  representative_id: number | null;
  difficulties: RankRequestDifficulty[];
  approved_difficulty_ids: number[] | null;
};
type RequestTarget = { native_set_id: number } | { official_set_id: number };
const statuses: RankRequestStatus[] = ['pending', 'approved', 'rejected', 'withdrawn'];

const validRevision = (value: number) => Number.isSafeInteger(value) && value >= 0;
const validReason = (value: string) => {
  const length = Array.from(value.trim()).length;
  return length >= 1 && length <= 1000 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
};
const denial = (value: unknown): value is ApiError =>
  value instanceof ApiError && [401, 403, 404, 410].includes(value.status);

function useRequestError() {
  const t = useTranslations('rankRequests');
  return (error: unknown) => {
    if (error instanceof ApiError) {
      if (error.code === 'rank_request_exists') return t('duplicate');
      if (error.code === 'rank_request_limit' || error.status === 429) return t('limit');
      if (error.code === 'rank_request_ineligible') return t('ineligible');
      if (error.code === 'rank_request_closed') return t('closed');
      if (error.code === 'beatmap_status_conflict') return t('difficultyConflict');
      if (error.code === 'rank_request_map_changed') return t('manifestChanged');
      if (error.status === 409) return t('conflict');
      if (error.status === 401) return t('unauthorized');
      if (error.status === 403) return t('forbidden');
      if (error.status === 404 || error.status === 410) return t('missing');
      if (error.status === 400 || error.status === 422) return t('invalidReason');
    }
    return t('serviceError');
  };
}

/** Every private read and manual cache write stays bound to its account/filter. */
export function useRankPrivateData<T>(path: string, userId: number | undefined, allowed: boolean) {
  const { mutate: mutateCache } = useSWRConfig();
  const guard = useDeniedResponseGuard();
  const requestKey = allowed && userId !== undefined ? ([path, userId] as const) : null;
  const scope = unstable_serialize(requestKey);
  const [accessFailure, setAccessFailure] = useState<{ scope: string; error: ApiError } | null>(
    null,
  );
  async function deny(error: ApiError) {
    guard.deny(scope);
    setAccessFailure({ scope, error });
    await mutateCache(requestKey, undefined, { revalidate: false });
  }
  async function read<T>(url: string): Promise<T> {
    const ticket = guard.begin(scope);
    try {
      const result = await fetcher<T>(url);
      guard.check(ticket);
      return result;
    } catch (error) {
      if (denial(error)) await deny(error);
      throw error;
    }
  }
  const {
    data,
    error: loadError,
    isLoading,
  } = useSWR<T>(requestKey, ([url]: readonly [string, number]) => read<T>(url), {
    keepPreviousData: false,
    dedupingInterval: 0,
    shouldRetryOnError: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    onSuccess: (_value, key) =>
      setAccessFailure((current) => (current?.scope === key ? null : current)),
    onError: (error) => {
      if (denial(error)) void deny(error);
    },
  });
  const error = accessFailure?.scope === scope ? accessFailure.error : loadError;
  async function refresh() {
    const ticket = guard.begin(scope);
    const result = await read<T>(path);
    guard.check(ticket);
    await mutateCache(requestKey, result, { revalidate: false });
    guard.check(ticket);
    setAccessFailure((current) => (current?.scope === scope ? null : current));
    return result;
  }
  return { data: denial(error) ? undefined : data, error, isLoading, read, refresh, deny };
}
function useRequests(path: string, userId: number | undefined, allowed: boolean) {
  return useRankPrivateData<Page<BeatmapRankRequest>>(path, userId, allowed);
}
type Collection = ReturnType<typeof useRequests>;

function Feedback({ error, success }: { error?: string; success?: string }) {
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="form-success" role="status">
          {success}
        </p>
      )}
    </>
  );
}
export function RequestLoadError({
  error,
  retry,
  description,
}: {
  error: unknown;
  retry: () => void;
  description?: string;
}) {
  const t = useTranslations('rankRequests');
  const describe = useRequestError();
  return (
    <div className={styles.feedback} role="alert">
      <p>{description ?? describe(error)}</p>
      <Button type="button" variant="outline" size="sm" onClick={retry}>
        <RefreshCw aria-hidden="true" />
        {t('refresh')}
      </Button>
    </div>
  );
}

export function RankDifficultySelection({
  difficulties,
  selected,
  onChange,
  disabled = false,
  legend,
  requesting = false,
}: {
  difficulties: RankRequestDifficultyPreview[];
  selected: number[];
  onChange: (value: number[]) => void;
  disabled?: boolean;
  legend?: string;
  requesting?: boolean;
}) {
  const t = useTranslations('rankRequests');
  const c = useTranslations('common');
  const id = useId();
  return (
    <fieldset className={styles.difficulties} disabled={disabled}>
      <legend>{legend ?? t('selectDifficulties')}</legend>
      <p className="hint">
        {t(requesting ? 'createSelectedCount' : 'selectedCount', {
          selected: selected.length,
          total: difficulties.length,
        })}
      </p>
      <div className={styles.difficultyOptions}>
        {difficulties.map((difficulty) => (
          <label
            key={difficulty.native_id}
            className={styles.difficulty}
            htmlFor={`${id}-${difficulty.native_id}`}
          >
            <Checkbox
              id={`${id}-${difficulty.native_id}`}
              aria-label={difficulty.version}
              className={styles.checkbox}
              checked={selected.includes(difficulty.native_id)}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onChange(
                  checked === true
                    ? Array.from(new Set([...selected, difficulty.native_id]))
                    : selected.filter((value) => value !== difficulty.native_id),
                )
              }
            />
            <span>
              <strong>{difficulty.version}</strong>
              <small>
                {['osu!', 'taiko', 'catch', 'mania'][difficulty.mode]} ·{' '}
                {difficulty.stars.toFixed(2)}★{' '}
                {difficulty.status ? `· ${c(difficulty.status)}` : ''}
              </small>
            </span>
          </label>
        ))}
      </div>
      <div className={styles.actions}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || !difficulties.length}
          onClick={() =>
            onChange(
              Array.from(
                new Set([...selected, ...difficulties.map((difficulty) => difficulty.native_id)]),
              ),
            )
          }
        >
          {t('selectShown')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || !selected.length}
          onClick={() => onChange([])}
        >
          {t('clearSelection')}
        </Button>
      </div>
    </fieldset>
  );
}

function requestHref(item: BeatmapRankRequest) {
  const first = item.difficulties[0];
  return `${beatmapsetPath(item.native_set_id, item.source)}${first ? beatmapDifficultyHash(first.mode, first.native_id) : ''}`;
}
function RequestRecord({
  item,
  collection,
  staff,
}: {
  item: BeatmapRankRequest;
  collection: Collection;
  staff: boolean;
}) {
  const t = useTranslations('rankRequests');
  const maps = useTranslations('mapDiscovery');
  const f = useFormatter();
  const [editing, setEditing] = useState(false);
  return (
    <article className={styles.record} data-rank-request-id={item.id}>
      <div className={styles.identity}>
        <div className={styles.recordHeading}>
          <h3>
            <Link href={requestHref(item)}>{item.metadata.title}</Link>
          </h3>
          <Badge variant="outline" className={styles[item.status]}>
            {t(`status.${item.status}`)}
          </Badge>
        </div>
        <p className={styles.artist}>
          {item.metadata.artist} · {maps('mappedBy', { creator: item.metadata.creator })}
        </p>
        <div className={styles.meta}>
          <span>{t('requestId', { id: item.id })}</span>
          <span>{t('setId', { id: item.native_set_id })}</span>
          <span>{t('difficulties', { count: item.metadata.difficulty_count })}</span>
          <time dateTime={item.created_at}>
            {f.dateTime(new Date(item.created_at), { dateStyle: 'medium', timeStyle: 'short' })}
          </time>
        </div>
        <p className={styles.person}>
          <span>{t('requester')}</span>
          <Link href={`/users/${item.requester.id}`}>
            <Avatar name={item.requester.username} url={item.requester.avatar_url} />
            {item.requester.username}
          </Link>
        </p>
        <div className={styles.reason}>
          <strong>{t('reason')}</strong>
          <Markdown>{item.reason}</Markdown>
        </div>
        {item.review_reason && (
          <div className={styles.reason}>
            <strong>{t('reviewReason')}</strong>
            <Markdown>{item.review_reason}</Markdown>
            {item.reviewer && (
              <Link href={`/users/${item.reviewer.id}`}>
                {t('reviewer')} · {item.reviewer.username}
              </Link>
            )}
          </div>
        )}
        {item.approved_difficulty_ids?.length ? (
          <p className="hint">
            {t('approvedCount', { count: item.approved_difficulty_ids.length })}
          </p>
        ) : null}
      </div>
      {item.status === 'pending' && (
        <div className={styles.recordAction}>
          {!editing ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
              {t(staff ? 'review' : 'withdraw')}
            </Button>
          ) : (
            <RequestDecision item={item} collection={collection} staff={staff} />
          )}
        </div>
      )}
    </article>
  );
}

function RequestDecision({
  item,
  collection,
  staff,
}: {
  item: BeatmapRankRequest;
  collection: Collection;
  staff: boolean;
}) {
  const t = useTranslations('rankRequests');
  const { user } = useSession();
  const describe = useRequestError();
  const id = useId();
  const [snapshot, setSnapshot] = useState(item);
  const [decision, setDecision] = useState('rejected');
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const canApprove = !!user && hasPermission(user.permissions, 'beatmaps.moderate');
  async function refresh() {
    setBusy(true);
    setError('');
    try {
      const latest = await collection.read<BeatmapRankRequest>(
        `/beatmap-rank-requests/${snapshot.id}`,
      );
      setSnapshot(latest);
      setSelected((current) =>
        current.filter((value) =>
          latest.difficulties.some((difficulty) => difficulty.native_id === value),
        ),
      );
      await collection.refresh();
      setStale(false);
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || stale || snapshot.status !== 'pending' || !validRevision(snapshot.revision)) return;
    if (staff && !validReason(reason)) {
      setError(t('invalidReason'));
      return;
    }
    if (staff && decision === 'approved' && !canApprove) return;
    if (staff && decision === 'approved' && !selected.length) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await api(
        staff
          ? `/admin/beatmap-rank-requests/${snapshot.id}`
          : `/beatmap-rank-requests/${snapshot.id}/withdraw`,
        {
          method: staff ? 'PATCH' : 'POST',
          body: JSON.stringify(
            staff
              ? {
                  decision,
                  reason: reason.trim(),
                  expected_revision: snapshot.revision,
                  ...(decision === 'approved'
                    ? {
                        difficulty_ids: selected,
                        difficulty_revisions: snapshot.difficulties
                          .filter((difficulty) => selected.includes(difficulty.native_id))
                          .map((difficulty) => ({
                            native_id: difficulty.native_id,
                            expected_revision: difficulty.revision,
                            expected_status_revision: difficulty.status_revision,
                          })),
                      }
                    : {}),
                }
              : { expected_revision: snapshot.revision },
          ),
        },
      );
      setStale(true);
      setSuccess(t(staff ? 'reviewSaved' : 'withdrawn'));
      try {
        await collection.refresh();
      } catch {
        setError(t('refreshFailed'));
      }
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409) setStale(true);
      if (denial(failure)) await collection.deny(failure);
      setError(describe(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className={styles.editor}
      data-rank-request-editor={item.id}
      onSubmit={submit}
      aria-busy={busy}
    >
      {staff ? (
        <>
          <div className="field">
            <label htmlFor={`${id}-decision`}>{t('decision')}</label>
            <FieldSelect
              id={`${id}-decision`}
              value={decision}
              onValueChange={setDecision}
              disabled={busy}
              options={[
                { value: 'rejected', label: t('reject') },
                { value: 'approved', label: t('approve'), disabled: !canApprove },
              ]}
            />
          </div>
          {!canApprove && <p className="hint">{t('approvalPermission')}</p>}
          {decision === 'approved' && (
            <>
              <RankDifficultySelection
                difficulties={snapshot.difficulties}
                selected={selected}
                onChange={setSelected}
                disabled={busy || stale}
              />
              <p className="hint">{t('approvalHint')}</p>
            </>
          )}
          <div className="field">
            <label htmlFor={`${id}-reason`}>{t('reviewReason')}</label>
            <Textarea
              id={`${id}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={2000}
              disabled={busy}
              aria-describedby={`${id}-hint`}
            />
            <p className="hint" id={`${id}-hint`}>
              {t('reviewReasonHint')}
            </p>
          </div>
        </>
      ) : (
        <p className="hint">{t('withdrawHint')}</p>
      )}
      {snapshot.status !== 'pending' && (
        <Badge variant="outline">{t(`status.${snapshot.status}`)}</Badge>
      )}
      {!validRevision(snapshot.revision) && <p className="hint">{t('invalidRevision')}</p>}
      <Feedback error={error} success={success} />
      <div className={styles.actions}>
        <Button
          type="submit"
          size="sm"
          disabled={
            busy ||
            stale ||
            snapshot.status !== 'pending' ||
            !validRevision(snapshot.revision) ||
            (staff &&
              decision === 'approved' &&
              (!canApprove ||
                !selected.length ||
                snapshot.difficulties.some(
                  (difficulty) =>
                    selected.includes(difficulty.native_id) &&
                    (!validRevision(difficulty.revision) ||
                      (difficulty.status_revision !== null &&
                        !validRevision(difficulty.status_revision))),
                )))
          }
        >
          {busy && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {t(staff ? 'saveDecision' : 'withdraw')}
        </Button>
        {(stale || !validRevision(snapshot.revision)) && (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={refresh}>
            <RefreshCw aria-hidden="true" />
            {t('refreshRequest')}
          </Button>
        )}
      </div>
    </form>
  );
}

function RequestCollection({ staff }: { staff: boolean }) {
  const t = useTranslations('rankRequests');
  const { user } = useSession();
  const search = useSearchParams();
  const rawStatus = search.get('rank_status');
  const status =
    rawStatus === 'all' || statuses.includes(rawStatus as RankRequestStatus)
      ? rawStatus!
      : staff
        ? 'pending'
        : 'all';
  const parsedPage = Number(search.get('rank_page') ?? 1);
  const page =
    Number.isSafeInteger(parsedPage) && parsedPage > 0 && parsedPage <= 4294967295 ? parsedPage : 1;
  const allowed = !!user && (!staff || hasPermission(user.permissions, 'beatmaps.rank.review'));
  const path = `${staff ? '/admin' : '/me'}/beatmap-rank-requests?${new URLSearchParams({ status, page: String(page), page_size: '24' })}`;
  const collection = useRequests(path, user?.id, allowed);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const describe = useRequestError();
  function select(value: string, nextPage = 1) {
    const next = new URLSearchParams(window.location.search);
    next.set('rank_status', value);
    next.set('rank_page', String(nextPage));
    window.history.pushState(null, '', `${window.location.pathname}?${next}`);
  }
  async function refresh() {
    setRefreshing(true);
    setRefreshError('');
    try {
      await collection.refresh();
    } catch (failure) {
      setRefreshError(describe(failure));
    } finally {
      setRefreshing(false);
    }
  }
  if (!allowed)
    return (
      <Protected permission={staff ? 'beatmaps.rank.review' : undefined}>
        <Empty title={t('empty')} />
      </Protected>
    );
  return (
    <div className={styles.workbench}>
      {staff && (
        <div className={styles.collectionHeading}>
          <h2>{t('queueTitle')}</h2>
          <p className="hint">{t('queueDescription')}</p>
        </div>
      )}
      <div className={styles.toolbar}>
        <div className="field">
          <label htmlFor="rank-request-status">{t('statusFilter')}</label>
          <FieldSelect
            id="rank-request-status"
            value={status}
            onValueChange={(value) => select(value)}
            options={[
              { value: 'all', label: t('all') },
              ...statuses.map((value) => ({ value, label: t(`status.${value}`) })),
            ]}
          />
        </div>
        <Button type="button" variant="outline" disabled={refreshing} onClick={refresh}>
          <RefreshCw aria-hidden="true" className={refreshing ? 'spin' : undefined} />
          {t('refresh')}
        </Button>
      </div>
      <Feedback error={refreshError} />
      {collection.error && <RequestLoadError error={collection.error} retry={refresh} />}
      {collection.isLoading ? (
        <Loading />
      ) : (
        collection.data &&
        (collection.data.items.length ? (
          <section
            className={`glass ${styles.list}`}
            key={`${user.id}:${status}:${page}`}
            aria-label={t(staff ? 'queueTitle' : 'title')}
          >
            {collection.data.items.map((item) => (
              <RequestRecord key={item.id} item={item} collection={collection} staff={staff} />
            ))}
          </section>
        ) : (
          <Empty title={t('empty')} description={t(staff ? 'emptyQueueHint' : 'emptyOwnHint')} />
        ))
      )}
      {collection.data && (
        <Pagination
          page={collection.data.page}
          total={collection.data.total}
          pageSize={collection.data.page_size}
          onChange={(next) => select(status, next)}
        />
      )}
      <p className="hint">{t('privacy')}</p>
    </div>
  );
}
export function AdminRankRequests() {
  return <RequestCollection staff />;
}
export function BeatmapRankRequestsPage() {
  const t = useTranslations('rankRequests');
  return (
    <div className="page-container">
      <Link href="/beatmaps" className="back-link">
        <ArrowLeft aria-hidden="true" />
        {t('back')}
      </Link>
      <PageHeading title={t('title')} description={t('description')} />
      <Protected>
        <Suspense fallback={<Loading />}>
          <RequestCollection staff={false} />
        </Suspense>
      </Protected>
    </div>
  );
}

function RequestAction({ target, initialDifficulties = [], localMapId }: RequestActionProps) {
  const t = useTranslations('rankRequests');
  const { user } = useSession();
  const describe = useRequestError();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saved, setSaved] = useState(false);
  const [difficultyPage, setDifficultyPage] = useState(1);
  const eligible = (difficulty: RankRequestDifficultyPreview) =>
    Number.isSafeInteger(difficulty.native_id) &&
    difficulty.native_id > 0 &&
    (!difficulty.status || ['pending', 'graveyard', 'unranked'].includes(difficulty.status));
  const [selected, setSelected] = useState(() =>
    initialDifficulties.filter(eligible).map((difficulty) => difficulty.native_id),
  );
  const localDifficulties = useRankPrivateData<Page<RankRequestDifficultyPreview>>(
    `/beatmaps/${localMapId}/set/difficulties?page=${difficultyPage}&page_size=100`,
    user?.id,
    open && !!user && localMapId !== undefined,
  );
  const difficulties = (
    localMapId !== undefined
      ? (localDifficulties.data?.items ?? initialDifficulties)
      : initialDifficulties
  ).filter(eligible);
  const invalidSelected = (
    localMapId !== undefined
      ? (localDifficulties.data?.items ?? initialDifficulties)
      : initialDifficulties
  ).some((difficulty) => selected.includes(difficulty.native_id) && !eligible(difficulty));
  const setId = 'native_set_id' in target ? target.native_set_id : target.official_set_id;
  const collection = useRequests(
    `/me/beatmap-rank-requests?${new URLSearchParams({ native_set_id: String(setId), status: 'all', page: '1', page_size: '24' })}`,
    user?.id,
    open && !!user,
  );
  const canRequest = !!user && hasPermission(user.permissions, 'beatmaps.rank.request');
  const active = collection.data?.items.some((item) => item.status === 'pending') ?? false;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      busy ||
      saved ||
      active ||
      !canRequest ||
      !selected.length ||
      selected.length > 512 ||
      invalidSelected
    )
      return;
    if (!validReason(reason)) {
      setError(t('invalidReason'));
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await api('/beatmap-rank-requests', {
        method: 'POST',
        body: JSON.stringify({ ...target, reason: reason.trim(), difficulty_ids: selected }),
      });
      setSaved(true);
      setSuccess(t('submitted'));
      try {
        await collection.refresh();
      } catch {
        setError(t('refreshFailed'));
      }
    } catch (failure) {
      if (denial(failure)) await collection.deny(failure);
      setError(describe(failure));
    } finally {
      setBusy(false);
    }
  }
  if (!user)
    return (
      <Button asChild variant="outline" size="sm">
        <Link href="/login">{t('signIn')}</Link>
      </Button>
    );
  return (
    <div className={styles.requestAction}>
      <div className={styles.actions}>
        {canRequest && !open && (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Check aria-hidden="true" />
            {t('request')}
          </Button>
        )}
        <Link className="text-link" href="/beatmaps/rank-requests">
          {t('myRequests')}
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>
      {open && (
        <div className={styles.requestBody}>
          <p className="hint">{t('formHint')}</p>
          <p className="hint">{t('official_set_id' in target ? 'officialHint' : 'localHint')}</p>
          {collection.error && (
            <RequestLoadError
              error={collection.error}
              retry={() => void collection.refresh().catch(() => undefined)}
            />
          )}
          {collection.isLoading ? (
            <Loading />
          ) : active ? (
            <p role="status" className="hint">
              {t('duplicate')}
            </p>
          ) : (
            <form onSubmit={submit} aria-busy={busy}>
              {localDifficulties.error && (
                <RequestLoadError
                  error={localDifficulties.error}
                  retry={() => void localDifficulties.refresh().catch(() => undefined)}
                />
              )}
              {localDifficulties.isLoading ? (
                <Loading />
              ) : (
                <RankDifficultySelection
                  difficulties={difficulties}
                  selected={selected}
                  onChange={setSelected}
                  disabled={busy || saved}
                  legend={t('requestDifficulties')}
                  requesting
                />
              )}
              {localDifficulties.data && (
                <Pagination
                  page={localDifficulties.data.page}
                  total={localDifficulties.data.total}
                  pageSize={localDifficulties.data.page_size}
                  onChange={setDifficultyPage}
                />
              )}
              {!difficulties.length && !localDifficulties.isLoading && (
                <p className="hint">{t('noEligibleDifficulties')}</p>
              )}
              {invalidSelected && <p className="hint">{t('ineligible')}</p>}
              {localMapId !== undefined && <p className="hint">{t('selectionPages')}</p>}
              <div className="field">
                <label htmlFor={`${id}-reason`}>{t('reason')}</label>
                <Textarea
                  id={`${id}-reason`}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  disabled={busy || saved}
                  maxLength={2000}
                  aria-describedby={`${id}-hint`}
                />
                <p id={`${id}-hint`} className="hint">
                  {t('reasonHint')}
                </p>
              </div>
              <div className={styles.actions}>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    busy ||
                    saved ||
                    !canRequest ||
                    !!collection.error ||
                    !!localDifficulties.error ||
                    localDifficulties.isLoading ||
                    !selected.length ||
                    selected.length > 512 ||
                    invalidSelected
                  }
                >
                  {busy && <LoaderCircle aria-hidden="true" className="animate-spin" />}
                  {t('send')}
                </Button>
              </div>
            </form>
          )}
          <Feedback error={error} success={success} />
          {collection.data?.items.map((item) => (
            <RequestRecord key={item.id} item={item} collection={collection} staff={false} />
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              setReason('');
              setError('');
              setSuccess('');
              setSaved(false);
              setSelected(
                initialDifficulties.filter(eligible).map((difficulty) => difficulty.native_id),
              );
            }}
          >
            {t('cancel')}
          </Button>
        </div>
      )}
    </div>
  );
}
export function BeatmapRankRequestAction({
  target,
  initialDifficulties,
  localMapId,
}: RequestActionProps) {
  const { user, loading } = useSession();
  if (loading) return null;
  const identity =
    'native_set_id' in target
      ? `local:${target.native_set_id}`
      : `official:${target.official_set_id}`;
  return (
    <RequestAction
      key={`${user?.id ?? 'anonymous'}:${identity}:${localMapId ?? ''}`}
      target={target}
      initialDifficulties={initialDifficulties}
      localMapId={localMapId}
    />
  );
}
