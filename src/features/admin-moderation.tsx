'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import useSWR, { unstable_serialize, useSWRConfig } from 'swr';
import { ChevronDown, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import { NavigationLink as Link } from '@/components/navigation-motion';
import { Avatar, Empty, Loading, LoadError, Pagination } from '@/components/common';
import { useSession } from '@/components/providers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FieldSelect } from '@/components/ui/field-select';
import { api, ApiError, fetcher, hasPermission } from '@/lib/api';
import type { AdminChatUser, Audit, Page, Score } from '@/lib/types';
import styles from './admin-moderation.module.css';

type Verification = 'pending' | 'verified' | 'rejected';
const statuses: Verification[] = ['pending', 'verified', 'rejected'];
const modes = ['osu!', 'taiko', 'catch', 'mania'];
type SilencePage = Page<AdminChatUser> & { server_time: string; client_received_at?: number };
type SilenceResult = Pick<AdminChatUser, 'id' | 'chat_silenced_until' | 'chat_silence_revision'> & {
  ok: true;
  server_time: string;
};
type ScoreResult = Pick<Score, 'id' | 'verification' | 'moderation_revision'> & { ok: true };

function safeRevision(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}
function readPage(value: string | null) {
  const page = Number(value ?? '1');
  return Number.isSafeInteger(page) && page > 0 && page <= 4294967295 ? page : 1;
}
function useModerationError() {
  const t = useTranslations('adminModeration');
  return (error: unknown) => {
    if (error instanceof ApiError) {
      if (error.status === 409) return t('conflict');
      if (error.status === 401) return t('unauthorized');
      if (error.status === 403) return t('forbidden');
      if (error.status === 404) return t('missing');
      if (error.status === 400) return t('invalid');
    }
    return t('serviceError');
  };
}
function isReadDenial(error: unknown): error is ApiError {
  return error instanceof ApiError && [401, 403, 404].includes(error.status);
}
export function useDeniedResponseGuard() {
  const generations = useRef(new Map<string, number>());
  return {
    begin: (scope: string) => ({ scope, generation: generations.current.get(scope) ?? 0 }),
    deny: (scope: string) =>
      generations.current.set(scope, (generations.current.get(scope) ?? 0) + 1),
    check: (ticket: { scope: string; generation: number }) => {
      if ((generations.current.get(ticket.scope) ?? 0) !== ticket.generation)
        throw new Error('Response superseded by an access denial.');
    },
  };
}
function useStaffCollection<T>(
  key: string,
  userId: number | undefined,
  allowed: boolean,
  decorate?: (value: T) => T,
) {
  const { mutate: mutateCache } = useSWRConfig();
  const guard = useDeniedResponseGuard();
  const requestKey = allowed && userId !== undefined ? ([key, userId] as const) : null;
  const scope = unstable_serialize(requestKey);
  const [accessFailure, setAccessFailure] = useState<{ scope: string; error: ApiError } | null>(
    null,
  );
  const {
    data,
    error: requestError,
    isLoading,
    mutate,
  } = useSWR<T>(
    requestKey,
    async ([path]: readonly [string, number]) => {
      const value = await read<T>(path);
      return decorate ? decorate(value) : value;
    },
    {
      keepPreviousData: false,
      shouldRetryOnError: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      onSuccess: (_value, responseScope) =>
        setAccessFailure((old) => (old?.scope === responseScope ? null : old)),
      onError: (failure, responseScope) => {
        if (isReadDenial(failure)) {
          setAccessFailure({ scope: responseScope, error: failure });
          void mutateCache(responseScope, undefined, { revalidate: false });
        }
      },
    },
  );
  const error = accessFailure?.scope === scope ? accessFailure.error : requestError;
  async function read<R>(path: string): Promise<R> {
    const ticket = guard.begin(scope);
    try {
      const value = await fetcher<R>(path);
      guard.check(ticket);
      return value;
    } catch (failure) {
      if (isReadDenial(failure)) {
        guard.deny(scope);
        setAccessFailure({ scope, error: failure });
        await mutateCache(requestKey, undefined, { revalidate: false });
      }
      throw failure;
    }
  }
  async function refresh() {
    const ticket = guard.begin(scope);
    const value = await read<T>(key);
    const latest = decorate ? decorate(value) : value;
    // Global mutation keeps late responses attached to their original account/filter.
    guard.check(ticket);
    await mutateCache(requestKey, latest, { revalidate: false });
    guard.check(ticket);
    setAccessFailure((old) => (old?.scope === scope ? null : old));
    return latest;
  }
  return { data: isReadDenial(error) ? undefined : data, error, isLoading, mutate, read, refresh };
}
function Feedback({ error, success }: { error: string; success: string }) {
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

/** Decisions retain the observed revision until the operator explicitly refreshes. */
export function ScoreModerationControls({
  score,
  refresh,
}: {
  score: Score;
  refresh: () => Promise<Score>;
}) {
  const t = useTranslations('adminModeration');
  const { user } = useSession();
  const describe = useModerationError();
  const [observed, setObserved] = useState(score);
  const [decision, setDecision] = useState(score.verification as Verification);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const writing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  if (!user || !hasPermission(user.permissions, 'scores.moderate')) return null;
  const valid = safeRevision(observed.moderation_revision);
  async function reload() {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setSuccess('');
    try {
      const latest = await refresh();
      if (!mounted.current) return;
      setObserved(latest);
      setBlocked(false);
      setError('');
      setSuccess(t('latestLoaded'));
    } catch (failure) {
      if (mounted.current) {
        setError(describe(failure));
        setBlocked(true);
      }
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (writing.current || blocked || !valid || decision === observed.verification) return;
    writing.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await api<ScoreResult>(`/admin/scores/${score.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          verification: decision,
          expected_revision: observed.moderation_revision,
        }),
      });
      if (!mounted.current) return;
      setObserved((old) => ({ ...old, ...result }));
      setSuccess(t('saved'));
      try {
        const latest = await refresh();
        if (mounted.current) setObserved(latest);
      } catch {
        if (mounted.current) {
          setBlocked(true);
          setError(t('savedRefreshFailed'));
        }
      }
    } catch (failure) {
      if (mounted.current) {
        setError(describe(failure));
        if (failure instanceof ApiError && [401, 403, 404, 409].includes(failure.status))
          setBlocked(true);
      }
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <form
      className={styles.decision}
      onSubmit={submit}
      aria-label={t('decisionFor', { id: score.id })}
      aria-busy={busy}
    >
      <p className="hint">
        {t('currentStatus', {
          status: t(
            statuses.includes(observed.verification as Verification)
              ? observed.verification
              : 'unknown',
          ),
        })}
      </p>
      <div className={styles.actions}>
        <FieldSelect
          aria-label={t('decision')}
          value={decision}
          disabled={busy}
          onValueChange={(value) => setDecision(value as Verification)}
          options={statuses.map((value) => ({ value, label: t(`action_${value}`) }))}
        />
        <Button
          type="submit"
          size="sm"
          disabled={busy || blocked || !valid || decision === observed.verification}
        >
          {busy && <LoaderCircle className="spin" aria-hidden="true" />}
          {t('applyDecision')}
        </Button>
      </div>
      {!valid && (
        <p className="form-error" role="alert">
          {t('revisionMissing')}
        </p>
      )}
      <Feedback error={error} success={success} />
      {(error || blocked || !valid) && (
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={reload}>
          <RefreshCw aria-hidden="true" />
          {t('refresh')}
        </Button>
      )}
    </form>
  );
}

export function ScoreModeration() {
  const t = useTranslations('adminModeration');
  const c = useTranslations('common');
  const f = useFormatter();
  const { user } = useSession();
  const query = useSearchParams();
  const status = statuses.includes(query.get('verification') as Verification)
    ? query.get('verification')!
    : query.get('verification') === 'all'
      ? 'all'
      : 'pending';
  const rawMode = /^[0-3]$/.test(query.get('mode') ?? '') ? query.get('mode')! : 'all';
  const rawVariant = ['vanilla', 'relax'].includes(query.get('variant') ?? '')
    ? query.get('variant')!
    : 'all';
  const mode = rawMode === 'all' && rawVariant !== 'all' ? '0' : rawMode;
  const variant = rawVariant === 'all' && rawMode !== 'all' ? 'vanilla' : rawVariant;
  const page = readPage(query.get('page'));
  const params = new URLSearchParams({ page: String(page), page_size: '24' });
  if (status !== 'all') params.set('verification', status);
  // The score API treats an omitted member of a partition as its default.
  if (mode !== 'all' || variant !== 'all') {
    params.set('mode', mode === 'all' ? '0' : mode);
    params.set('variant', variant === 'all' ? 'vanilla' : variant);
  }
  const key = `/scores?${params}`;
  const allowed = !!user && hasPermission(user.permissions, 'scores.moderate');
  const {
    data: records,
    error,
    isLoading,
    mutate,
    read,
    refresh,
  } = useStaffCollection<Page<Score>>(key, user?.id, allowed);
  function select(values: Record<string, string>) {
    const next = new URLSearchParams(window.location.search);
    next.set('tab', 'scores');
    next.delete('page');
    Object.entries(values).forEach(([name, value]) => next.set(name, value));
    // Avoid silently displaying standard-mode results under an "all modes" filter.
    if ('variant' in values && values.variant !== 'all' && mode === 'all') next.set('mode', '0');
    if ('mode' in values && values.mode !== 'all' && variant === 'all')
      next.set('variant', 'vanilla');
    if (values.mode === '3' && variant === 'relax') next.set('variant', 'vanilla');
    if (values.mode === 'all') next.set('variant', 'all');
    if (values.variant === 'all') next.set('mode', 'all');
    window.history.pushState(null, '', `?${next}`);
  }
  if (!allowed) return <Empty title={c('noPermission')} />;
  return (
    <div className={styles.workbench}>
      <div className={styles.filters}>
        <div className="field">
          <label htmlFor="moderation-score-status">{t('scoreStatus')}</label>
          <FieldSelect
            id="moderation-score-status"
            value={status}
            onValueChange={(verification) => select({ verification })}
            options={[
              { value: 'all', label: c('all') },
              ...statuses.map((value) => ({ value, label: t(value) })),
            ]}
          />
        </div>
        <div className="field">
          <label htmlFor="moderation-score-mode">{c('mode')}</label>
          <FieldSelect
            id="moderation-score-mode"
            value={mode}
            onValueChange={(mode) => select({ mode })}
            options={[
              { value: 'all', label: c('all') },
              ...modes.map((label, value) => ({ value: String(value), label })),
            ]}
          />
        </div>
        <div className="field">
          <label htmlFor="moderation-score-variant">{t('category')}</label>
          <FieldSelect
            id="moderation-score-variant"
            value={variant}
            onValueChange={(variant) => select({ variant })}
            options={[
              { value: 'all', label: c('all') },
              { value: 'vanilla', label: c('vanilla') },
              { value: 'relax', label: c('relax'), disabled: mode === '3' },
            ]}
          />
        </div>
      </div>
      <section className="glass content-panel" aria-label={t('scoreTitle')}>
        <p className="hint">{t('scoreHint')}</p>
        {isLoading ? (
          <Loading />
        ) : error && !records ? (
          <LoadError retry={() => mutate()} />
        ) : !records?.items.length ? (
          <Empty title={t('scoreEmpty')} />
        ) : (
          <div className="table-scroll" role="region" tabIndex={0} aria-label={t('scoreTitle')}>
            <table className={`data-table ${styles.table} ${styles.scoreTable}`}>
              <thead>
                <tr>
                  {[c('username'), c('score'), c('status'), c('replay'), t('decision')].map(
                    (label) => (
                      <th scope="col" key={label}>
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {records.items.map((score) => (
                  <tr key={score.id} data-score-id={score.id}>
                    <td data-label={c('username')}>
                      <Link
                        href={`/players/${score.user_id}?mode=${score.mode}&variant=${score.score_variant ?? 'vanilla'}`}
                      >
                        {score.username}
                      </Link>
                    </td>
                    <td data-label={c('score')}>
                      <Link href={`/scores/${score.id}`} className="score-title">
                        {score.title}
                        <span>{score.version}</span>
                      </Link>
                      <p className="hint">
                        {f.number(score.score)} · {score.accuracy.toFixed(2)}% ·{' '}
                        {score.pp.toFixed(2)} pp
                      </p>
                      <p className="hint">
                        {modes[score.mode]} ·{' '}
                        {c(score.score_variant === 'relax' ? 'relax' : 'vanilla')} · #{score.id}
                      </p>
                    </td>
                    <td data-label={c('status')}>
                      <Badge
                        variant={score.verification === 'rejected' ? 'destructive' : 'secondary'}
                      >
                        {t(
                          statuses.includes(score.verification as Verification)
                            ? score.verification
                            : 'unknown',
                        )}
                      </Badge>
                    </td>
                    <td data-label={c('replay')}>
                      {score.has_replay ? (
                        <a href={`/api/v1/scores/${score.id}/replay`} className="text-link">
                          {c('download')}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td data-label={t('decision')}>
                      <ScoreModerationControls
                        score={score}
                        refresh={async () => {
                          const latest = await read<Score>(`/scores/${score.id}`);
                          await refresh();
                          return latest;
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {records && (
        <Pagination
          page={page}
          total={records.total}
          pageSize={records.page_size}
          onChange={(page) => select({ page: String(page) })}
        />
      )}
    </div>
  );
}

function ChatSilenceEditor({
  player,
  serverOffset,
  refresh,
}: {
  player: AdminChatUser;
  serverOffset: number;
  refresh: () => Promise<SilencePage>;
}) {
  const t = useTranslations('adminModeration');
  const f = useFormatter();
  const describe = useModerationError();
  const [observed, setObserved] = useState(player);
  const [clockOffset, setClockOffset] = useState(serverOffset);
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState('60');
  const [minutes, setMinutes] = useState('60');
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const writing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const validRevision = safeRevision(observed.chat_silence_revision);
  async function reload() {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setSuccess('');
    try {
      const latest = await refresh();
      const target = latest.items.find((row) => row.id === player.id);
      if (!target) throw new ApiError(404, 'not_found', '');
      if (mounted.current) {
        setObserved(target);
        setClockOffset(new Date(latest.server_time).getTime() - (latest.client_received_at ?? NaN));
        setError('');
        setBlocked(false);
        setSuccess(t('latestLoaded'));
      }
    } catch (failure) {
      if (mounted.current) {
        setError(describe(failure));
        setBlocked(true);
      }
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function write(lift: boolean) {
    if (writing.current || blocked || !validRevision || !observed.can_silence) return;
    const trimmed = reason.trim();
    const length = Array.from(trimmed).length;
    if (length < 1 || length > 500 || /[\u0000-\u001f\u007f-\u009f]/u.test(trimmed)) {
      setError(t('reasonInvalid'));
      return;
    }
    const count = Number(duration === 'custom' ? minutes : duration);
    if (
      !lift &&
      (!Number.isInteger(count) || count < 1 || count > 43200 || !Number.isFinite(clockOffset))
    ) {
      setError(t('durationInvalid'));
      return;
    }
    writing.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await api<SilenceResult>(`/admin/users/${player.id}/chat-silence`, {
        method: lift ? 'DELETE' : 'PUT',
        body: JSON.stringify({
          reason: trimmed,
          expected_revision: observed.chat_silence_revision,
          ...(!lift && {
            expires_at: new Date(Date.now() + clockOffset + count * 60000).toISOString(),
          }),
        }),
      });
      if (!mounted.current) return;
      setObserved((old) => ({ ...old, ...result }));
      setClockOffset(new Date(result.server_time).getTime() - Date.now());
      setReason('');
      setSuccess(t(lift ? 'lifted' : 'silenced'));
      try {
        await refresh();
      } catch {
        if (mounted.current) {
          setBlocked(true);
          setError(t('savedRefreshFailed'));
        }
      }
    } catch (failure) {
      if (mounted.current) {
        setError(describe(failure));
        if (failure instanceof ApiError && [401, 403, 404, 409].includes(failure.status))
          setBlocked(true);
      }
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <form
      className={styles.silenceEditor}
      aria-label={t('silenceFor', { name: player.username })}
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        void write(false);
      }}
    >
      <p className="hint">
        {observed.chat_silenced_until
          ? t('until', {
              time: f.dateTime(new Date(observed.chat_silenced_until), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })
          : t('notSilenced')}
      </p>
      <div className={styles.silenceFields}>
        <div className="field">
          <label htmlFor={`silence-duration-${player.id}`}>{t('duration')}</label>
          <FieldSelect
            id={`silence-duration-${player.id}`}
            value={duration}
            disabled={busy}
            onValueChange={setDuration}
            options={[
              { value: '15', label: t('minutes15') },
              { value: '60', label: t('hour1') },
              { value: '1440', label: t('hours24') },
              { value: 'custom', label: t('custom') },
            ]}
          />
          {duration === 'custom' && (
            <>
              <label className={styles.customLabel} htmlFor={`silence-minutes-${player.id}`}>
                {t('customMinutes')}
              </label>
              <Input
                id={`silence-minutes-${player.id}`}
                type="number"
                min={1}
                max={43200}
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
                disabled={busy}
              />
            </>
          )}
        </div>
        <div className="field">
          <label htmlFor={`silence-reason-${player.id}`}>{t('reason')}</label>
          <Textarea
            id={`silence-reason-${player.id}`}
            rows={2}
            value={reason}
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
            aria-describedby={`silence-hint-${player.id}`}
          />
          <p id={`silence-hint-${player.id}`} className="hint">
            {t('reasonHint', { count: Array.from(reason).length })}
          </p>
        </div>
      </div>
      <div className={styles.actions}>
        <Button
          type="submit"
          size="sm"
          disabled={busy || blocked || !validRevision || !observed.can_silence}
        >
          {busy && <LoaderCircle className="spin" aria-hidden="true" />}
          {t('applySilence')}
        </Button>
        {observed.chat_silenced_until && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => write(true)}
            disabled={busy || blocked || !validRevision || !observed.can_silence}
          >
            {t('lift')}
          </Button>
        )}
      </div>
      <Feedback error={error} success={success} />
      {!validRevision && (
        <p className="form-error" role="alert">
          {t('revisionMissing')}
        </p>
      )}
      {(error || blocked || !validRevision) && (
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={reload}>
          <RefreshCw aria-hidden="true" />
          {t('refresh')}
        </Button>
      )}
    </form>
  );
}

export function ChatModeration() {
  const t = useTranslations('adminModeration');
  const c = useTranslations('common');
  const { user } = useSession();
  const query = useSearchParams();
  const search = (query.get('search') ?? '').trim();
  const page = readPage(query.get('page'));
  const [selected, setSelected] = useState<number | null>(null);
  const [searchError, setSearchError] = useState('');
  const params = new URLSearchParams({ page: String(page), page_size: '24' });
  if (search) params.set('search', search);
  const allowed = !!user && hasPermission(user.permissions, 'chat.moderate');
  const key = `/admin/chat-silences?${params}`;
  const {
    data: records,
    error,
    isLoading,
    mutate,
    refresh,
  } = useStaffCollection<SilencePage>(key, user?.id, allowed, (value) => ({
    ...value,
    client_received_at: Date.now(),
  }));
  function select(values: Record<string, string>) {
    const next = new URLSearchParams(window.location.search);
    next.set('tab', 'chat');
    next.delete('page');
    Object.entries(values).forEach(([name, value]) =>
      value ? next.set(name, value) : next.delete(name),
    );
    window.history.pushState(null, '', `?${next}`);
    setSelected(null);
    setSearchError('');
  }
  if (!allowed) return <Empty title={c('noPermission')} />;
  return (
    <div className={styles.workbench}>
      <form
        className={styles.search}
        onSubmit={(event) => {
          event.preventDefault();
          const value = String(new FormData(event.currentTarget).get('search') ?? '').trim();
          if (Array.from(value).length > 64) {
            setSearchError(t('searchInvalid'));
            return;
          }
          select({ search: value });
        }}
      >
        <div className="field">
          <label htmlFor="chat-moderation-search">{t('searchPlayers')}</label>
          <Input
            key={search}
            id="chat-moderation-search"
            name="search"
            type="search"
            defaultValue={search}
            maxLength={64}
            aria-describedby="chat-moderation-search-hint"
          />
          <p id="chat-moderation-search-hint" className="hint">
            {t('searchHint')}
          </p>
        </div>
        <Button type="submit" variant="outline" size="sm">
          <Search aria-hidden="true" />
          {c('search')}
        </Button>
        {search && (
          <Button type="button" variant="ghost" size="sm" onClick={() => select({ search: '' })}>
            {t('clearSearch')}
          </Button>
        )}
      </form>
      {searchError && (
        <p className="form-error" role="alert">
          {searchError}
        </p>
      )}
      <section className="glass content-panel" aria-label={t('chatTitle')}>
        <p className="hint">{t('chatHint')}</p>
        {isLoading ? (
          <Loading />
        ) : error && !records ? (
          <LoadError retry={() => mutate()} />
        ) : !records?.items.length ? (
          <Empty title={t('chatEmpty')} />
        ) : (
          <div className="table-scroll" role="region" tabIndex={0} aria-label={t('chatTitle')}>
            <table className={`data-table ${styles.table} ${styles.chatTable}`}>
              <thead>
                <tr>
                  {[c('username'), t('chatStatus'), t('action')].map((label) => (
                    <th scope="col" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.items.map((player) => (
                  <ChatModerationRow
                    key={player.id}
                    player={player}
                    serverOffset={
                      new Date(records.server_time).getTime() - (records.client_received_at ?? NaN)
                    }
                    selected={selected === player.id}
                    choose={() => setSelected(selected === player.id ? null : player.id)}
                    refresh={refresh}
                    actorId={user?.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {records && (
        <Pagination
          page={page}
          total={records.total}
          pageSize={records.page_size}
          onChange={(page) => select({ page: String(page) })}
        />
      )}
    </div>
  );
}
function ChatModerationRow({
  player,
  serverOffset,
  selected,
  choose,
  refresh,
  actorId,
}: {
  player: AdminChatUser;
  serverOffset: number;
  selected: boolean;
  choose: () => void;
  refresh: () => Promise<SilencePage>;
  actorId?: number;
}) {
  const t = useTranslations('adminModeration');
  const f = useFormatter();
  return (
    <>
      <tr data-chat-user-id={player.id}>
        <td>
          <Link href={`/players/${player.id}`} className="player-cell">
            <Avatar name={player.username} url={player.avatar_url} />
            {player.username}
          </Link>
          <p className="hint">
            #{player.id} · {player.country}
          </p>
        </td>
        <td>
          {player.chat_silenced_until ? (
            <time dateTime={player.chat_silenced_until}>
              {t('until', {
                time: f.dateTime(new Date(player.chat_silenced_until), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })}
            </time>
          ) : (
            t('notSilenced')
          )}
        </td>
        <td>
          {player.can_silence ? (
            <Button
              size="sm"
              variant="outline"
              aria-expanded={selected}
              aria-controls={`chat-editor-${player.id}`}
              onClick={choose}
            >
              {t(selected ? 'closeEditor' : 'manageSilence')}
            </Button>
          ) : (
            <p className="hint">{t(player.id === actorId ? 'selfProtected' : 'targetProtected')}</p>
          )}
        </td>
      </tr>
      {selected && (
        <tr id={`chat-editor-${player.id}`} className={styles.editorRow}>
          <td colSpan={3}>
            <ChatSilenceEditor player={player} serverOffset={serverOffset} refresh={refresh} />
          </td>
        </tr>
      )}
    </>
  );
}

function auditEntries(details: Record<string, unknown>) {
  const entries: { label: string; value: string }[] = [];
  function visit(value: unknown, label: string, depth: number) {
    if (entries.length >= 24) return;
    if (value && typeof value === 'object' && !Array.isArray(value) && depth < 2) {
      Object.entries(value).forEach(([key, child]) =>
        visit(child, label ? `${label} · ${key}` : key, depth + 1),
      );
      return;
    }
    const text =
      value == null
        ? '—'
        : Array.isArray(value)
          ? value
              .slice(0, 12)
              .map((child) => (typeof child === 'object' ? '…' : String(child)))
              .join(', ')
          : typeof value === 'object'
            ? '…'
            : String(value);
    entries.push({
      label: label.replaceAll('_', ' '),
      value: text.length > 400 ? `${text.slice(0, 400)}…` : text,
    });
  }
  visit(details, '', 0);
  return entries;
}
export function AuditDisclosure({ audit }: { audit: Audit }) {
  const t = useTranslations('adminModeration');
  const entries = auditEntries(audit.details ?? {});
  return entries.length ? (
    <details className={styles.audit}>
      <summary>
        {t('auditDetails')}
        <ChevronDown aria-hidden="true" />
      </summary>
      <dl>
        {entries.map((entry, index) => (
          <div key={`${entry.label}-${index}`}>
            <dt>{entry.label}</dt>
            <dd>{entry.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  ) : (
    <span className="hint">—</span>
  );
}
