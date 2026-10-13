'use client';

import { useId, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import { NavigationLink as Link } from '@/components/navigation-motion';
import { Empty, Loading, PageHeading, Pagination, Protected } from '@/components/common';
import { useSession } from '@/components/providers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldSelect } from '@/components/ui/field-select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError, hasPermission } from '@/lib/api';
import type { BeatmapAvailability, Page } from '@/lib/types';
import { BeatmapAvailabilityAction } from './admin';
import {
  RequestLoadError,
  useRankPrivateData,
  type RankRequestDifficulty,
} from './beatmap-rank-requests';
import styles from './beatmap-rank-requests.module.css';

type LocalSet = {
  native_set_id: number;
  title: string;
  artist: string;
  creator: string;
  difficulty_count: number;
  statuses: string[];
  uploaded_by: { id: number; username: string; country: string; avatar_url: string | null } | null;
  official?: boolean;
  withdrawn: boolean;
  added_at: string;
  representative_id: number;
};
type StaffSet = {
  native_set_id: number;
  source: 'local' | 'official';
  title: string;
  artist: string;
  creator: string;
  difficulties: RankRequestDifficulty[];
  representative_id: number | null;
  availability: BeatmapAvailability;
};
const statuses = ['pending', 'wip', 'graveyard', 'ranked', 'loved', 'unranked'];
const revisionValid = (value: number) => Number.isSafeInteger(value) && value >= 0;
const reasonValid = (value: string) => {
  const length = Array.from(value.trim()).length;
  return length >= 1 && length <= 1000 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
};
function useSetError() {
  const t = useTranslations('rankRequests');
  return (error: unknown) => {
    if (error instanceof ApiError) {
      if (error.status === 401) return t('unauthorized');
      if (error.status === 403) return t('forbidden');
      if (error.status === 409) return t('difficultyConflict');
      if (error.status === 404) return t('missing');
      if (error.status === 410) return t('withdrawnSet');
      if (error.status === 400 || error.status === 422) return t('invalidReason');
    }
    return t('serviceError');
  };
}
function readPage(value: string | null) {
  const page = Number(value ?? 1);
  return Number.isSafeInteger(page) && page > 0 && page <= 4294967295 ? page : 1;
}

export function LocalBeatmapAdminCatalogue() {
  const t = useTranslations('rankRequests');
  const c = useTranslations('common');
  const availability = useTranslations('mapAvailability');
  const maps = useTranslations('mapDiscovery');
  const f = useFormatter();
  const search = useSearchParams();
  const { user } = useSession();
  const q = search.get('local_q') ?? '';
  const page = readPage(search.get('local_page'));
  const rawAvailability = search.get('local_availability');
  const filterAvailability = ['active', 'withdrawn'].includes(rawAvailability ?? '')
    ? rawAvailability!
    : 'all';
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const describe = useSetError();
  const allowed = !!user && hasPermission(user.permissions, 'beatmaps.moderate');
  const collection = useRankPrivateData<Page<LocalSet>>(
    `/admin/beatmapsets?${new URLSearchParams({ q, availability: filterAvailability, page: String(page), page_size: '24' })}`,
    user?.id,
    allowed,
  );
  function select(values: { q?: string; availability?: string; page?: number }) {
    const next = new URLSearchParams(window.location.search);
    next.set('local_q', values.q ?? q);
    next.set('local_availability', values.availability ?? filterAvailability);
    next.set('local_page', String(values.page ?? 1));
    window.history.pushState(null, '', `${window.location.pathname}?${next}`);
  }
  async function refresh() {
    setRefreshing(true);
    setError('');
    try {
      await collection.refresh();
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setRefreshing(false);
    }
  }
  if (!allowed)
    return (
      <Protected permission="beatmaps.moderate">
        <Empty title={c('noPermission')} />
      </Protected>
    );
  return (
    <div className={styles.workbench}>
      <div>
        <h2>{t('localTitle')}</h2>
        <p className="hint">{t('localDescription')}</p>
      </div>
      <div className={styles.toolbar}>
        <LocalSearch key={q} query={q} submit={(value) => select({ q: value })} />
        <div className="field">
          <label htmlFor="local-map-availability">{availability('label')}</label>
          <FieldSelect
            id="local-map-availability"
            value={filterAvailability}
            onValueChange={(value) => select({ availability: value })}
            options={[
              { value: 'all', label: c('all') },
              { value: 'active', label: availability('active') },
              { value: 'withdrawn', label: availability('withdrawn') },
            ]}
          />
        </div>
        <Button type="button" variant="outline" size="sm" disabled={refreshing} onClick={refresh}>
          <RefreshCw aria-hidden="true" />
          {t('refreshMaps')}
        </Button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {collection.error && (
        <RequestLoadError
          error={collection.error}
          description={describe(collection.error)}
          retry={refresh}
        />
      )}
      {collection.isLoading ? (
        <Loading />
      ) : (
        collection.data &&
        (collection.data.items.length ? (
          <section className={`glass ${styles.list}`} aria-label={t('localTitle')}>
            {collection.data.items.map((set) => (
              <article className={styles.localRecord} key={set.native_set_id}>
                <div className={styles.identity}>
                  <h3>
                    <Link href={`/admin/beatmapsets/${set.native_set_id}`}>{set.title}</Link>
                  </h3>
                  <p className={styles.artist}>
                    {set.artist} · {maps('mappedBy', { creator: set.creator })}
                  </p>
                  <div className={styles.meta}>
                    <span>{t('difficulties', { count: set.difficulty_count })}</span>
                    {set.uploaded_by && (
                      <Link data-user-preview href={`/users/${set.uploaded_by.id}`}>
                        {t('uploader')} · {set.uploaded_by.username}
                      </Link>
                    )}
                    <time dateTime={set.added_at}>
                      {f.dateTime(new Date(set.added_at), { dateStyle: 'medium' })}
                    </time>
                  </div>
                  <div className={styles.actions}>
                    {set.statuses.map((status) => (
                      <Badge variant="outline" key={status}>
                        {c(status)}
                      </Badge>
                    ))}
                    {set.official && <Badge variant="outline">{t('officialSet')}</Badge>}
                    {set.withdrawn && <Badge variant="outline">{availability('withdrawn')}</Badge>}
                  </div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/admin/beatmapsets/${set.native_set_id}`}>
                    {t('adminView')}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              </article>
            ))}
          </section>
        ) : (
          <Empty title={t('noLocalMaps')} description={t('localEmptyHint')} />
        ))
      )}
      {collection.data && (
        <Pagination
          page={collection.data.page}
          total={collection.data.total}
          pageSize={collection.data.page_size}
          onChange={(value) => select({ page: value })}
        />
      )}
    </div>
  );
}

function LocalSearch({ query, submit }: { query: string; submit: (value: string) => void }) {
  const t = useTranslations('common');
  const id = useId();
  const [draft, setDraft] = useState(query);
  return (
    <form
      className={styles.search}
      onSubmit={(event) => {
        event.preventDefault();
        submit(draft.trim());
      }}
    >
      <label htmlFor={id}>{t('search')}</label>
      <div>
        <Input
          id={id}
          type="search"
          value={draft}
          maxLength={100}
          onChange={(event) =>
            setDraft(event.target.value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ''))
          }
        />
        <Button type="submit" variant="outline" size="sm">
          <Search aria-hidden="true" />
          {t('search')}
        </Button>
      </div>
    </form>
  );
}

function DifficultyStatusEditor({
  difficulty,
  setId,
  collection,
  withdrawn,
}: {
  difficulty: RankRequestDifficulty;
  setId: number;
  collection: ReturnType<typeof useRankPrivateData<StaffSet>>;
  withdrawn: boolean;
}) {
  const t = useTranslations('rankRequests');
  const c = useTranslations('common');
  const describe = useSetError();
  const id = useId();
  const [snapshot, setSnapshot] = useState(difficulty);
  const [status, setStatus] = useState(difficulty.status);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const revisionsValid =
    revisionValid(snapshot.revision) &&
    (snapshot.status_revision === null || revisionValid(snapshot.status_revision));
  async function refresh() {
    setBusy(true);
    setError('');
    try {
      const latest = await collection.refresh();
      const current = latest.difficulties.find((item) => item.native_id === snapshot.native_id);
      if (!current) throw new ApiError(404, 'missing', '');
      setSnapshot(current);
      setStale(false);
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || stale || withdrawn || !revisionsValid || status === snapshot.status) return;
    if (!reasonValid(reason)) {
      setError(t('invalidReason'));
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await api(`/admin/beatmapsets/${setId}/difficulties/${snapshot.native_id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          reason: reason.trim(),
          expected_revision: snapshot.revision,
          expected_status_revision: snapshot.status_revision,
        }),
      });
      setStale(true);
      setSuccess(t('statusSaved'));
      try {
        await collection.refresh();
      } catch {
        setError(t('refreshFailed'));
      }
    } catch (failure) {
      if (failure instanceof ApiError && [409, 410].includes(failure.status)) setStale(true);
      if (failure instanceof ApiError && [401, 403].includes(failure.status))
        await collection.deny(failure);
      setError(describe(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className={styles.editor}
      data-difficulty-status-editor={snapshot.native_id}
      onSubmit={submit}
      aria-busy={busy}
    >
      <div className="field">
        <label htmlFor={`${id}-status`}>{t('newStatus')}</label>
        <FieldSelect
          id={`${id}-status`}
          value={status}
          onValueChange={setStatus}
          disabled={busy}
          options={statuses.map((value) => ({ value, label: c(value) }))}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-reason`}>{t('statusReason')}</label>
        <Textarea
          id={`${id}-reason`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={2000}
          disabled={busy}
        />
        <p className="hint">{t('statusReasonHint')}</p>
      </div>
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
      <div className={styles.actions}>
        <Button
          type="submit"
          size="sm"
          disabled={busy || stale || withdrawn || !revisionsValid || status === snapshot.status}
        >
          {busy && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {t('saveStatus')}
        </Button>
        {(stale || !revisionsValid) && (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={refresh}>
            <RefreshCw aria-hidden="true" />
            {t('refreshDifficulty')}
          </Button>
        )}
      </div>
    </form>
  );
}
function StaffSetContents({ setId }: { setId: string }) {
  const t = useTranslations('rankRequests');
  const c = useTranslations('common');
  const maps = useTranslations('mapDiscovery');
  const availability = useTranslations('mapAvailability');
  const { user } = useSession();
  const allowed = !!user && hasPermission(user.permissions, 'beatmaps.moderate');
  const valid =
    /^\d+$/.test(setId) &&
    Number.isSafeInteger(Number(setId)) &&
    Number(setId) > 0 &&
    Number(setId) <= 2147483647;
  const collection = useRankPrivateData<StaffSet>(
    `/admin/beatmapsets/${setId}`,
    user?.id,
    allowed && valid,
  );
  const [editing, setEditing] = useState<number | null>(null);
  const withdrawn = collection.data?.availability.withdrawn ?? true;
  const [error, setError] = useState('');
  const describe = useSetError();
  async function refresh() {
    setError('');
    try {
      await collection.refresh();
    } catch (failure) {
      setError(describe(failure));
    }
  }
  async function refreshAvailability() {
    try {
      await collection.refresh();
      return true;
    } catch (failure) {
      setError(describe(failure));
      return false;
    }
  }
  if (!allowed)
    return (
      <Protected permission="beatmaps.moderate">
        <Empty title={c('noPermission')} />
      </Protected>
    );
  if (!valid) return <Empty title={t('missing')} />;
  return (
    <div className={styles.workbench}>
      <div className={styles.toolbar}>
        <Button type="button" variant="outline" size="sm" onClick={refresh}>
          <RefreshCw aria-hidden="true" />
          {t('refreshMaps')}
        </Button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {collection.error && (
        <RequestLoadError
          error={collection.error}
          description={describe(collection.error)}
          retry={refresh}
        />
      )}
      {collection.isLoading ? (
        <Loading />
      ) : (
        collection.data && (
          <>
            <header className={`glass ${styles.setHeading}`}>
              <h2>{collection.data.title}</h2>
              <p>
                {collection.data.artist} · {maps('mappedBy', { creator: collection.data.creator })}
              </p>
              <p className="hint">
                {t('setId', { id: collection.data.native_set_id })} ·{' '}
                {t('difficulties', { count: collection.data.difficulties.length })}
              </p>
              <p className="hint">{t('statusScopeHint')}</p>
              <div className={styles.actions}>
                <Badge variant="outline">
                  {availability(collection.data.availability.withdrawn ? 'withdrawn' : 'active')}
                </Badge>
                <BeatmapAvailabilityAction
                  map={{
                    id: collection.data.native_set_id,
                    native_set_id: collection.data.native_set_id,
                    title: collection.data.title,
                    artist: collection.data.artist,
                    availability: collection.data.availability,
                  }}
                  changed={refreshAvailability}
                  denied={collection.deny}
                />
              </div>
            </header>
            <section className={`glass ${styles.list}`} aria-label={t('difficultyStatuses')}>
              {collection.data.difficulties.map((difficulty) => (
                <article
                  className={styles.record}
                  key={difficulty.native_id}
                  data-staff-difficulty-id={difficulty.native_id}
                >
                  <div className={styles.identity}>
                    <h3>{difficulty.version}</h3>
                    <div className={styles.meta}>
                      <span>{['osu!', 'taiko', 'catch', 'mania'][difficulty.mode]}</span>
                      <span>{difficulty.stars.toFixed(2)}★</span>
                      <Badge variant="outline">{c(difficulty.status)}</Badge>
                    </div>
                  </div>
                  <div>
                    {editing === difficulty.native_id ? (
                      <DifficultyStatusEditor
                        difficulty={difficulty}
                        setId={Number(setId)}
                        collection={collection}
                        withdrawn={withdrawn}
                      />
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={withdrawn}
                        onClick={() => setEditing(difficulty.native_id)}
                      >
                        {t('editStatus')}
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </section>
          </>
        )
      )}
    </div>
  );
}
export function BeatmapAdminViewPage({ setId }: { setId: string }) {
  const t = useTranslations('rankRequests');
  return (
    <div className="page-container">
      <Link href="/admin?tab=beatmaps" className="back-link">
        <ArrowLeft aria-hidden="true" />
        {t('backToMaps')}
      </Link>
      <PageHeading title={t('adminView')} description={t('adminViewDescription')} />
      <Protected permission="beatmaps.moderate">
        <StaffSetContents key={setId} setId={setId} />
      </Protected>
    </div>
  );
}
