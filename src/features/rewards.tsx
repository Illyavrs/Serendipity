'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import useSWR, { unstable_serialize, useSWRConfig } from 'swr';
import { Check, RefreshCw, Sparkles, Upload } from 'lucide-react';
import { Avatar, Empty, Loading, PageHeading, Pagination, Protected } from '@/components/common';
import { useSession } from '@/components/providers';
import { RewardTitle } from '@/components/reward-cosmetics';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FieldSelect } from '@/components/ui/field-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, ApiError, fetcher, hasPermission } from '@/lib/api';
import type { Page } from '@/lib/types';
import { invalidatePublicUserCards } from '@/lib/public-user-cards';
import {
  adminRewardsPath,
  claimRewardMission,
  createReward,
  deleteReward,
  purchaseReward,
  rewardsPath,
  updateReward,
  updateRewardEquipment,
  uploadRewardImage,
  type AdminReward,
  type Reward,
  type RewardInput,
  type RewardKind,
  type RewardMutation,
  type RewardState,
  type RewardStyle,
} from '@/lib/rewards';
import styles from './rewards.module.css';

const pageSize = 12;
const denied = (cause: unknown): cause is ApiError =>
  cause instanceof ApiError && [401, 403].includes(cause.status);

function useRewardError(management = false) {
  const t = useTranslations('rewards');
  return (cause: unknown) => {
    if (!(cause instanceof ApiError)) return t('errors.service');
    const codes = {
      reward_conflict: 'conflict',
      reward_in_use: 'inUse',
      mission_incomplete: 'incomplete',
      reward_incomplete: 'incomplete',
      mission_week_changed: 'weekChanged',
      reward_week_changed: 'weekChanged',
      insufficient_stardust: 'balance',
      reward_balance_insufficient: 'balance',
      reward_unavailable: 'unavailable',
      reward_not_owned: 'notOwned',
      reward_image_required: 'imageRequired',
    } as const;
    const known = codes[cause.code as keyof typeof codes];
    if (known === 'conflict' && !management) return t('errors.changed');
    if (known) return t(`errors.${known}`);
    if (cause.status === 401) return t('errors.unauthorized');
    if (cause.status === 403) return t('errors.forbidden');
    if (cause.status === 404) return t('errors.notFound');
    if (cause.status === 409) return t(management ? 'errors.conflict' : 'errors.changed');
    if (cause.status === 400) return t('errors.invalid');
    return t('errors.service');
  };
}

type Ticket = { scope: string; generation: number };

/** Private cache entries and in-flight responses belong to a single account. */
function useRewardCollection<T>(
  path: string,
  userId: number,
  onDenied?: () => void,
  onLoaded?: (value: T) => void,
) {
  const { clear } = useSession();
  const { cache, mutate: mutateCache } = useSWRConfig();
  const key = useMemo(() => [path, userId] as const, [path, userId]);
  const scope = unstable_serialize(key);
  const generations = useRef(new Map<string, number>());
  const controllers = useRef(new Map<string, Set<AbortController>>());
  const activeScope = useRef(scope);
  const mounted = useRef(true);
  const [accessFailure, setAccessFailure] = useState<{ scope: string; error: ApiError } | null>(
    null,
  );
  const begin = () => ({ scope, generation: generations.current.get(scope) ?? 0 });
  const current = (ticket: Ticket) =>
    mounted.current &&
    activeScope.current === ticket.scope &&
    (generations.current.get(ticket.scope) ?? 0) === ticket.generation;

  useLayoutEffect(() => {
    mounted.current = true;
    activeScope.current = scope;
    const generationsMap = generations.current;
    const controllersMap = controllers.current;
    return () => {
      mounted.current = false;
      // React's development effect replay remounts the same scope immediately.
      // Actual navigation/account changes still invalidate it before a response can render.
      setTimeout(() => {
        if (mounted.current && activeScope.current === scope) return;
        generationsMap.set(scope, (generationsMap.get(scope) ?? 0) + 1);
        controllersMap.get(scope)?.forEach((controller) => controller.abort());
        controllersMap.delete(scope);
        // The account's SWR provider may already be unregistered. Its captured
        // cache remains safe to clear without consulting SWR's global registry.
        cache.delete(scope);
      }, 0);
    };
  }, [key, scope, cache]);

  async function deny(cause: ApiError, ticket: Ticket) {
    if (!current(ticket)) return;
    generations.current.set(scope, ticket.generation + 1);
    controllers.current.get(scope)?.forEach((controller) => controller.abort());
    setAccessFailure({ scope, error: cause });
    onDenied?.();
    await mutateCache(
      (candidate) =>
        Array.isArray(candidate) &&
        candidate[1] === userId &&
        typeof candidate[0] === 'string' &&
        (candidate[0] === '/me/rewards' || candidate[0].startsWith('/admin/rewards')),
      undefined,
      { revalidate: false },
    );
    if (cause.status === 401 && mounted.current && activeScope.current === scope) await clear();
  }

  async function read<R>(readPath: string, ticket = begin()): Promise<R> {
    const controller = new AbortController();
    const requests = controllers.current.get(ticket.scope) ?? new Set<AbortController>();
    controllers.current.set(ticket.scope, requests);
    requests.add(controller);
    try {
      const value = await api<R>(readPath, { signal: controller.signal });
      if (!current(ticket)) throw new DOMException('Request superseded', 'AbortError');
      return value;
    } catch (cause) {
      if (denied(cause)) await deny(cause, ticket);
      throw cause;
    } finally {
      requests.delete(controller);
    }
  }

  const result = useSWR<T>(
    key,
    ([requestPath]: readonly [string, number]) => read<T>(requestPath),
    {
      keepPreviousData: false,
      shouldRetryOnError: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      onSuccess: (value, responseScope) => {
        setAccessFailure((old) => (old?.scope === responseScope ? null : old));
        if (mounted.current && activeScope.current === responseScope) onLoaded?.(value);
      },
    },
  );
  const error = accessFailure?.scope === scope ? accessFailure.error : result.error;

  async function accept(value: T, ticket: Ticket) {
    if (!current(ticket)) return;
    await mutateCache(key, value, { revalidate: false });
    if (current(ticket)) {
      setAccessFailure((old) => (old?.scope === scope ? null : old));
      onLoaded?.(value);
    }
  }
  async function refresh() {
    const ticket = begin();
    const value = await read<T>(path, ticket);
    await accept(value, ticket);
    return value;
  }
  return {
    data: denied(error) ? undefined : result.data,
    error,
    isLoading: result.isLoading,
    begin,
    current,
    read,
    accept,
    deny,
    refresh,
  };
}

function Feedback({ error, success }: { error: string; success?: string }) {
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

function RewardPreview({
  reward,
  name,
}: {
  reward: Pick<Reward, 'name' | 'kind' | 'color' | 'style' | 'image_url'>;
  name: string;
}) {
  return (
    <div className={styles.preview}>
      {reward.kind === 'title' ? (
        <RewardTitle reward={reward} />
      ) : (
        <Avatar name={name} frame={reward} />
      )}
    </div>
  );
}

export function RewardsPage() {
  const t = useTranslations('rewards');
  const { user } = useSession();
  return (
    <>
      <PageHeading title={t('title')} description={t('description')} />
      <Protected>
        {user && <RewardsWorkbench key={user.id} userId={user.id} name={user.username} />}
      </Protected>
    </>
  );
}

function RewardsWorkbench({ userId, name }: { userId: number; name: string }) {
  const t = useTranslations('rewards');
  const format = useFormatter();
  const describe = useRewardError();
  const { refresh: refreshSession } = useSession();
  const state = useRewardCollection<RewardState>('/me/rewards', userId);
  const [page, setPage] = useState(1);
  const shop = useSWR<Page<Reward>>(rewardsPath(page, pageSize), fetcher, {
    keepPreviousData: false,
    shouldRetryOnError: false,
    onSuccess: (value) =>
      setPage((current) => Math.min(current, Math.max(1, Math.ceil(value.total / pageSize)))),
  });
  const [filter, setFilter] = useState('all');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [refreshRequired, setRefreshRequired] = useState(false);
  const writing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function mutate(
    operation: () => Promise<RewardMutation>,
    message: string | ((result: RewardMutation) => string),
    equipment = false,
  ) {
    if (writing.current || !state.data || state.error || refreshRequired) return;
    writing.current = true;
    setPending(true);
    setError('');
    setSuccess('');
    const ticket = state.begin();
    try {
      const result = await operation();
      if (!state.current(ticket)) return;
      await state.accept(result.state, ticket);
      if (!state.current(ticket)) return;
      setSuccess(typeof message === 'function' ? message(result) : message);
      if (equipment) {
        invalidatePublicUserCards([userId]);
        await refreshSession();
      }
    } catch (cause) {
      if (!state.current(ticket)) return;
      setError(describe(cause));
      if (cause instanceof ApiError && [404, 409].includes(cause.status)) setRefreshRequired(true);
      if (denied(cause)) await state.deny(cause, ticket);
    } finally {
      writing.current = false;
      if (mounted.current) setPending(false);
    }
  }
  async function refresh() {
    if (writing.current) return;
    writing.current = true;
    setPending(true);
    setError('');
    setSuccess('');
    const ticket = state.begin();
    try {
      await state.refresh();
      await shop.mutate();
      if (state.current(ticket)) {
        setRefreshRequired(false);
        setSuccess(t('refreshed'));
      }
    } catch (cause) {
      if (state.current(ticket)) setError(describe(cause));
    } finally {
      writing.current = false;
      if (mounted.current) setPending(false);
    }
  }
  function equip(reward: Reward | null, kind: RewardKind) {
    const equipment = state.data?.equipment;
    if (!equipment) return;
    const input = {
      title_id: kind === 'title' ? (reward?.id ?? null) : (equipment.title?.id ?? null),
      avatar_frame_id:
        kind === 'avatar_frame' ? (reward?.id ?? null) : (equipment.avatar_frame?.id ?? null),
    };
    void mutate(() => updateRewardEquipment(input), t('equipmentSaved'), true);
  }
  function date(value: string) {
    return format.dateTime(new Date(value), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Taipei',
    });
  }

  const data = state.data;
  const inventory =
    data?.inventory.filter((reward) => filter === 'all' || reward.kind === filter) ?? [];
  const blocked = pending || !!state.error || refreshRequired;
  return (
    <div className={styles.workbench}>
      <div className={styles.sectionHeader}>
        <span className={styles.hint}>{t('weeklyReset')}</span>
        <Button variant="outline" disabled={pending} onClick={() => void refresh()}>
          <RefreshCw className={pending ? 'animate-spin' : ''} />
          {t(pending ? 'refreshing' : 'refresh')}
        </Button>
      </div>
      <Feedback error={error || (state.error ? describe(state.error) : '')} success={success} />
      {!data && !state.error && <Loading />}
      {data && (
        <>
          <div className={`glass ${styles.summary}`} data-material="content">
            <div className={styles.balance}>
              <Sparkles aria-hidden="true" />
              {t('balance', { amount: data.balance })}
            </div>
            <p className={styles.hint}>{t('nextReset', { time: date(data.resets_at) })}</p>
          </div>
          <Tabs defaultValue="missions">
            <TabsList className={styles.tabs}>
              <TabsTrigger value="missions">{t('missionsTab')}</TabsTrigger>
              <TabsTrigger value="shop">{t('shopTab')}</TabsTrigger>
              <TabsTrigger value="inventory">{t('inventoryTab')}</TabsTrigger>
            </TabsList>
            <TabsContent value="missions" className={styles.section}>
              <div>
                <h2>{t('missionsTitle')}</h2>
                <p className={styles.hint}>{t('missionsHint')}</p>
              </div>
              <div className={styles.grid}>
                {data.missions.map((mission) => (
                  <article
                    className={`glass ${styles.card}`}
                    data-material="content"
                    key={mission.key}
                    data-mission-key={mission.key}
                  >
                    <h3>{t(`missionLabels.${mission.key}`)}</h3>
                    <p className={styles.hint}>{t(`missionDescriptions.${mission.key}`)}</p>
                    <progress
                      className={styles.progress}
                      max={mission.goal}
                      value={Math.min(mission.progress, mission.goal)}
                      aria-label={t(`missionLabels.${mission.key}`)}
                    />
                    <div className={styles.cardHeader}>
                      <span>
                        {t('progress', {
                          progress: Math.min(mission.progress, mission.goal),
                          goal: mission.goal,
                        })}
                      </span>
                      <span>{t('price', { amount: mission.reward })}</span>
                    </div>
                    <Button
                      disabled={blocked || mission.claimed || mission.progress < mission.goal}
                      onClick={() =>
                        void mutate(
                          () => claimRewardMission(mission.key, data.week_start),
                          (result) =>
                            result.idempotent
                              ? t('claimed')
                              : t('claimSuccess', { amount: mission.reward }),
                        )
                      }
                    >
                      {mission.claimed && <Check aria-hidden="true" />}
                      {t(mission.claimed ? 'claimed' : 'claim')}
                    </Button>
                  </article>
                ))}
              </div>
            </TabsContent>
            <TabsContent value="shop" className={styles.section}>
              {shop.error && <Feedback error={describe(shop.error)} />}
              {shop.isLoading && <Loading />}
              {shop.data?.total === 0 && (
                <Empty title={t('shopEmpty')} description={t('shopEmptyDescription')} />
              )}
              <div className={styles.grid}>
                {shop.data?.items.map((reward) => {
                  const owned = data.inventory.some((item) => item.id === reward.id);
                  const equipped = data.equipment[reward.kind]?.id === reward.id;
                  return (
                    <article
                      key={reward.id}
                      className={`glass ${styles.card}`}
                      data-material="content"
                      data-reward-id={reward.id}
                    >
                      <RewardPreview reward={reward} name={name} />
                      <div className={styles.cardHeader}>
                        <h3>{reward.name}</h3>
                        <span className={styles.status}>{t(`type.${reward.kind}`)}</span>
                      </div>
                      <p className={styles.hint}>{reward.description}</p>
                      <strong>{t('price', { amount: reward.price })}</strong>
                      {equipped && <span className={styles.status}>{t('equipped')}</span>}
                      {owned ? (
                        <Button disabled variant="secondary">
                          {t('owned')}
                        </Button>
                      ) : (
                        <Button
                          disabled={
                            blocked || !!shop.error || data.balance < reward.price || !reward.active
                          }
                          onClick={() =>
                            void mutate(
                              () => purchaseReward(reward),
                              (result) => t(result.idempotent ? 'alreadyOwned' : 'purchaseSuccess'),
                            )
                          }
                        >
                          {t('purchase')}
                        </Button>
                      )}
                      {!owned && data.balance < reward.price && (
                        <p className={styles.hint}>{t('insufficientBalance')}</p>
                      )}
                    </article>
                  );
                })}
              </div>
              {shop.data && (
                <Pagination
                  page={page}
                  total={shop.data.total}
                  pageSize={pageSize}
                  onChange={setPage}
                />
              )}
            </TabsContent>
            <TabsContent value="inventory" className={styles.section}>
              <h2>{t('equipmentTitle')}</h2>
              <div className={styles.equipment}>
                {(['title', 'avatar_frame'] as const).map((kind) => {
                  const reward = data.equipment[kind];
                  return (
                    <article key={kind} className={`glass ${styles.card}`} data-material="content">
                      <h3>{t(`type.${kind}`)}</h3>
                      {reward ? (
                        <>
                          <RewardPreview reward={reward} name={name} />
                          <p>{reward.name}</p>
                          <Button
                            variant="outline"
                            disabled={blocked}
                            onClick={() => equip(null, kind)}
                          >
                            {t('unequip')}
                          </Button>
                        </>
                      ) : (
                        <p className={styles.hint}>{t(kind === 'title' ? 'noTitle' : 'noFrame')}</p>
                      )}
                    </article>
                  );
                })}
              </div>
              <FieldSelect
                aria-label={t('kind')}
                value={filter}
                onValueChange={setFilter}
                options={(['all', 'title', 'avatar_frame'] as const).map((value) => ({
                  value,
                  label: t(`filter.${value}`),
                }))}
              />
              {inventory.length === 0 && (
                <Empty
                  title={t(data.inventory.length === 0 ? 'inventoryEmpty' : 'filterEmpty')}
                  description={t(
                    data.inventory.length === 0
                      ? 'inventoryEmptyDescription'
                      : 'filterEmptyDescription',
                  )}
                />
              )}
              <div className={styles.grid}>
                {inventory.map((reward) => {
                  const equipped = data.equipment[reward.kind]?.id === reward.id;
                  return (
                    <article
                      key={reward.id}
                      className={`glass ${styles.card}`}
                      data-material="content"
                      data-reward-id={reward.id}
                    >
                      <RewardPreview reward={reward} name={name} />
                      <div className={styles.cardHeader}>
                        <h3>{reward.name}</h3>
                        <span className={styles.status}>{t(`type.${reward.kind}`)}</span>
                      </div>
                      <p className={styles.hint}>{reward.description}</p>
                      <p className={styles.metadata}>
                        {t('acquired', { time: date(reward.acquired_at) })}
                        <br />
                        {t('paid', { amount: reward.paid })}
                      </p>
                      {!reward.active && <p className={styles.hint}>{t('ownedInactive')}</p>}
                      <Button
                        variant={equipped ? 'secondary' : 'default'}
                        disabled={blocked || equipped}
                        onClick={() => equip(reward, reward.kind)}
                      >
                        {equipped && <Check aria-hidden="true" />}
                        {t(equipped ? 'equipped' : 'equip')}
                      </Button>
                    </article>
                  );
                })}
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

type Draft = Omit<RewardInput, 'price' | 'color'> & { price: string; color: string };
const emptyDraft = (): Draft => ({
  name: '',
  description: '',
  kind: 'title',
  price: '',
  color: '',
  style: null,
  active: true,
});
const draftFrom = (reward: Reward): Draft => ({
  ...inputFrom(reward),
  price: String(reward.price),
  color: reward.color ?? '',
});
const inputFrom = (reward: Reward): RewardInput => ({
  name: reward.name,
  description: reward.description,
  kind: reward.kind,
  price: reward.price,
  color: reward.color,
  style: reward.style,
  active: reward.active,
});
function validInput(draft: Draft): RewardInput | null {
  const name = draft.name.trim();
  const description = draft.description.replace(/\r\n/g, '\n');
  const color = draft.color.trim();
  const control = (value: string, multiline = false) =>
    Array.from(value).some((character) => {
      const code = character.codePointAt(0)!;
      return (code < 32 && !(multiline && [9, 10].includes(code))) || (code >= 127 && code <= 159);
    });
  const price = Number(draft.price);
  if (
    Array.from(name).length < 1 ||
    Array.from(name).length > 32 ||
    control(name) ||
    Array.from(description).length > 300 ||
    control(description, true) ||
    !/^\d+$/.test(draft.price.trim()) ||
    !Number.isSafeInteger(price) ||
    price < 1 ||
    price > 100000 ||
    (color && !/^#[0-9a-f]{6}$/i.test(color)) ||
    (draft.kind === 'avatar_frame' &&
      !['line', 'double', 'corners', 'image'].includes(draft.style ?? ''))
  )
    return null;
  return {
    name,
    description,
    kind: draft.kind,
    price,
    color: color || null,
    style: draft.kind === 'title' ? null : draft.style,
    active: draft.active,
  };
}

export function AdminRewards() {
  const { user } = useSession();
  const allowed = user && hasPermission(user.permissions, 'rewards.manage');
  return (
    <Protected permission="rewards.manage">
      {allowed && <AdminRewardsWorkbench key={user.id} userId={user.id} name={user.username} />}
    </Protected>
  );
}

function AdminRewardsWorkbench({ userId, name }: { userId: number; name: string }) {
  const t = useTranslations('rewards');
  const format = useFormatter();
  const describe = useRewardError(true);
  const { refresh: refreshSession } = useSession();
  const [page, setPage] = useState(1);
  const [observed, setObserved] = useState<AdminReward | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [stale, setStale] = useState(false);
  const [listConflict, setListConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageInputVersion, setImageInputVersion] = useState(0);
  const clearEditor = useCallback(() => {
    setObserved(null);
    setDraft(emptyDraft());
    setStale(false);
    setSuccess('');
    setImageFile(null);
    setImageInputVersion((version) => version + 1);
  }, []);
  const alignPage = useCallback((value: Page<AdminReward>) => {
    setPage((current) => Math.min(current, Math.max(1, Math.ceil(value.total / pageSize))));
  }, []);
  const collection = useRewardCollection<Page<AdminReward>>(
    adminRewardsPath(page, pageSize),
    userId,
    clearEditor,
    alignPage,
  );
  const writing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const preview = {
    name: draft.name || t('preview'),
    kind: draft.kind,
    color: draft.color || null,
    style: draft.style,
    image_url: observed?.image_url ?? null,
  };
  const imageFrame = draft.kind === 'avatar_frame' && draft.style === 'image';
  const imageMissing = imageFrame && !observed?.image_url;
  const canUploadImage = imageFrame && observed?.kind === 'avatar_frame';

  function edit(reward: AdminReward | null) {
    if (busy) return;
    setObserved(reward);
    setDraft(reward ? draftFrom(reward) : emptyDraft());
    setStale(false);
    setError('');
    setSuccess('');
    setImageFile(null);
    setImageInputVersion((version) => version + 1);
  }
  async function write<R>(
    operation: (ticket: Ticket) => Promise<R>,
    message: string,
    done: (value: R) => void,
    editor = false,
    imageUpload = false,
  ) {
    if (writing.current || collection.error || !collection.data) return;
    writing.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    const ticket = collection.begin();
    let committed = false;
    try {
      const value = await operation(ticket);
      if (!collection.current(ticket)) return;
      done(value);
      committed = true;
      invalidatePublicUserCards();
      setSuccess(message);
      // The mutation is confirmed. Session reads update known equipped cosmetics,
      // and the session provider handles their failures without retrying the write.
      await refreshSession().catch(() => {});
      if (!collection.current(ticket)) return;
      await collection.refresh();
    } catch (cause) {
      if (!collection.current(ticket)) return;
      const uncertain =
        imageUpload && !committed && (!(cause instanceof ApiError) || cause.status >= 500);
      setError(
        imageUpload && cause instanceof ApiError && cause.status === 400
          ? t('errors.invalidImage')
          : uncertain
            ? t('errors.uploadUncertain')
            : describe(cause),
      );
      if (cause instanceof ApiError && [404, 409].includes(cause.status)) {
        setListConflict(true);
        if (editor) setStale(true);
      }
      if (uncertain) {
        setListConflict(true);
        setStale(true);
      }
      if (denied(cause)) await collection.deny(cause, ticket);
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (stale) return;
    const input = validInput(draft);
    if (!input) {
      setSuccess('');
      setError(t('invalidDraft'));
      return;
    }
    if (imageMissing && (input.active || (observed?.owned_count ?? 0) > 0)) {
      setSuccess('');
      setError(t('errors.imageRequired'));
      return;
    }
    await write(
      () => (observed ? updateReward(observed.id, input, observed.revision) : createReward(input)),
      t(observed ? 'updateSuccess' : 'createSuccess'),
      (value) => {
        setObserved(value);
        setDraft(draftFrom(value));
        setStale(false);
      },
      true,
    );
  }
  function chooseImage(file: File | null) {
    setSuccess('');
    setError('');
    if (file && (!['image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024)) {
      setImageFile(null);
      setImageInputVersion((version) => version + 1);
      setError(t('errors.invalidImage'));
      return;
    }
    setImageFile(file);
  }
  async function uploadImage() {
    if (!observed || !canUploadImage || !imageFile || stale) return;
    await write(
      async (ticket) => {
        let bitmap: ImageBitmap;
        try {
          bitmap = await createImageBitmap(imageFile);
        } catch {
          throw new ApiError(400, 'invalid_reward_image', '');
        }
        const valid = bitmap.width === bitmap.height && bitmap.width >= 128 && bitmap.width <= 1024;
        bitmap.close();
        if (!valid) throw new ApiError(400, 'invalid_reward_image', '');
        if (!collection.current(ticket)) throw new DOMException('Request superseded', 'AbortError');
        return uploadRewardImage(observed.id, imageFile, observed.revision);
      },
      t('imageUploadSuccess'),
      (value) => {
        setObserved(value);
        setImageFile(null);
        setImageInputVersion((version) => version + 1);
      },
      true,
      true,
    );
  }
  async function refresh(reloadDraft = false) {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    const ticket = collection.begin();
    try {
      const latest = await collection.refresh();
      if (!collection.current(ticket)) return;
      if (reloadDraft && observed) {
        let reward = latest.items.find((item) => item.id === observed.id);
        // There is no individual admin GET route. An item may have moved pages.
        if (!reward) {
          let lookupPage = 1;
          let more = true;
          while (more && !reward) {
            const result = await collection.read<Page<AdminReward>>(
              adminRewardsPath(lookupPage, 100),
              ticket,
            );
            reward = result.items.find((item) => item.id === observed.id);
            more = lookupPage * result.page_size < result.total;
            lookupPage += 1;
          }
        }
        if (!reward) {
          setStale(true);
          setError(t('errors.notFound'));
          return;
        }
        if (!collection.current(ticket)) return;
        setObserved(reward);
        setDraft(draftFrom(reward));
        setImageFile(null);
        setImageInputVersion((version) => version + 1);
        setStale(false);
      }
      setListConflict(false);
      setSuccess(t(reloadDraft ? 'reloaded' : 'refreshed'));
    } catch (cause) {
      if (collection.current(ticket)) setError(describe(cause));
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const blocked = busy || !!collection.error || !collection.data;
  return (
    <div className={styles.workbench}>
      <PageHeading title={t('adminTitle')} description={t('adminDescription')}>
        <Button variant="outline" disabled={busy} onClick={() => void refresh()}>
          <RefreshCw className={busy ? 'animate-spin' : ''} />
          {t('refresh')}
        </Button>
      </PageHeading>
      <Feedback
        error={error || (collection.error ? describe(collection.error) : '')}
        success={success}
      />
      {!collection.data && !collection.error && <Loading />}
      {collection.data && (
        <>
          <section className={`glass ${styles.card}`} data-material="content">
            <div className={styles.sectionHeader}>
              <h2>{t(observed ? 'edit' : 'create')}</h2>
              {observed && (
                <Button variant="outline" disabled={busy} onClick={() => edit(null)}>
                  {t('cancel')}
                </Button>
              )}
            </div>
            <p className={styles.hint}>{t('draftHint')}</p>
            <form
              className={styles.form}
              aria-label={t('adminTitle')}
              onSubmit={(event) => void save(event)}
            >
              <div className={styles.field}>
                <label htmlFor="reward-name">{t('name')}</label>
                <Input
                  id="reward-name"
                  value={draft.name}
                  disabled={busy}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  required
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="reward-kind">{t('kind')}</label>
                <FieldSelect
                  id="reward-kind"
                  value={draft.kind}
                  disabled={busy || !!observed?.owned_count}
                  onValueChange={(value) => {
                    if (!['title', 'avatar_frame'].includes(value)) return;
                    setDraft((current) => ({
                      ...current,
                      kind: value as RewardKind,
                      style:
                        value === 'title'
                          ? null
                          : current.kind === 'avatar_frame'
                            ? (current.style ?? 'image')
                            : 'image',
                      active:
                        value === 'avatar_frame' && current.kind !== 'avatar_frame'
                          ? false
                          : current.active,
                    }));
                    setImageFile(null);
                    setImageInputVersion((version) => version + 1);
                  }}
                  options={(['title', 'avatar_frame'] as const).map((value) => ({
                    value,
                    label: t(`type.${value}`),
                  }))}
                />
              </div>
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="reward-description">{t('descriptionField')}</label>
                <Textarea
                  id="reward-description"
                  value={draft.description}
                  disabled={busy}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="reward-price">{t('priceField')}</label>
                <Input
                  id="reward-price"
                  type="number"
                  min={1}
                  max={100000}
                  step={1}
                  inputMode="numeric"
                  value={draft.price}
                  disabled={busy}
                  onChange={(event) => setDraft({ ...draft, price: event.target.value })}
                  required
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="reward-color">{t('color')}</label>
                <Input
                  id="reward-color"
                  value={draft.color}
                  placeholder="#RRGGBB"
                  aria-describedby="reward-color-hint"
                  disabled={busy || imageFrame}
                  onChange={(event) => setDraft({ ...draft, color: event.target.value })}
                />
                <span id="reward-color-hint" className={styles.hint}>
                  {t('colorHint')}
                </span>
              </div>
              <div className={styles.field}>
                <label htmlFor="reward-style">{t('style')}</label>
                <FieldSelect
                  id="reward-style"
                  value={draft.style ?? ''}
                  disabled={busy || draft.kind === 'title'}
                  onValueChange={(value) => {
                    // The select's hidden native control may emit an empty value
                    // when an edited reward replaces its options. It is not a frame style.
                    if (!['image', 'line', 'double', 'corners'].includes(value)) return;
                    setDraft((current) => ({
                      ...current,
                      style: value as RewardStyle,
                      active:
                        value === 'image' &&
                        !observed?.image_url &&
                        observed?.kind !== 'avatar_frame'
                          ? false
                          : current.active,
                    }));
                    setImageFile(null);
                    setImageInputVersion((version) => version + 1);
                  }}
                  options={(draft.kind === 'title'
                    ? (['none'] as const)
                    : (['image', 'line', 'double', 'corners'] as const)
                  ).map((value) => ({
                    value: value === 'none' ? '' : value,
                    label: t(`styleLabels.${value}`),
                  }))}
                />
              </div>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={draft.active}
                  disabled={busy || imageMissing}
                  onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
                />
                {t('active')}
              </label>
              <div className={styles.wide}>
                <RewardPreview reward={preview} name={name} />
              </div>
              {imageFrame && (
                <section className={`${styles.imageUpload} ${styles.wide}`}>
                  <div className={styles.field}>
                    <label htmlFor="reward-image">{t('imageLabel')}</label>
                    <p id="reward-image-guidance" className={styles.hint}>
                      {t('imageGuidance')}
                    </p>
                    <p className={styles.hint}>{t('imageTransparencyHint')}</p>
                    <Input
                      key={imageInputVersion}
                      id="reward-image"
                      type="file"
                      accept="image/png,image/webp"
                      aria-describedby="reward-image-guidance"
                      disabled={blocked || stale || !canUploadImage}
                      onChange={(event) => chooseImage(event.target.files?.[0] ?? null)}
                    />
                  </div>
                  {!canUploadImage && <p className={styles.hint}>{t('imageSaveFirst')}</p>}
                  {canUploadImage && observed?.style !== 'image' && (
                    <p className={styles.hint}>{t('imageExistingHint')}</p>
                  )}
                  {imageMissing && !observed?.active && (
                    <p className={styles.hint}>{t('imagePublishHint')}</p>
                  )}
                  <div className={styles.actions}>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={blocked || stale || !imageFile || !canUploadImage}
                      onClick={() => void uploadImage()}
                    >
                      <Upload aria-hidden="true" />
                      {t(busy ? 'imageUploading' : 'imageUpload')}
                    </Button>
                  </div>
                </section>
              )}
              {observed && (
                <div className={`${styles.hint} ${styles.wide}`}>
                  {t('ownedCount', { count: observed.owned_count })}
                  {observed.owned_count > 0 && <p>{t('errors.inUse')}</p>}
                </div>
              )}
              {stale && <p className={`${styles.hint} ${styles.wide}`}>{t('reloadHint')}</p>}
              <div className={`${styles.actions} ${styles.wide}`}>
                <Button type="submit" disabled={blocked || stale}>
                  {t(busy ? 'saving' : 'save')}
                </Button>
                {observed && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void refresh(true)}
                  >
                    {t('reloadLatest')}
                  </Button>
                )}
              </div>
            </form>
          </section>
          {collection.data.total === 0 && <Empty title={t('adminEmpty')} />}
          <div className={styles.grid}>
            {collection.data.items.map((reward) => (
              <article
                key={reward.id}
                className={`glass ${styles.card}`}
                data-material="content"
                data-reward-id={reward.id}
              >
                <RewardPreview reward={reward} name={name} />
                <div className={styles.cardHeader}>
                  <h3>{reward.name}</h3>
                  <span className={styles.status}>{t(reward.active ? 'active' : 'inactive')}</span>
                </div>
                <span className={styles.hint}>{t(`type.${reward.kind}`)}</span>
                <p>{reward.description}</p>
                <strong>{t('price', { amount: reward.price })}</strong>
                <p className={styles.metadata}>
                  {t('ownedCount', { count: reward.owned_count })}
                  <br />
                  {t('updatedAt', {
                    time: format.dateTime(new Date(reward.updated_at), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }),
                  })}
                </p>
                {reward.owned_count > 0 && <p className={styles.hint}>{t('errors.inUse')}</p>}
                <div className={styles.actions}>
                  <Button variant="outline" disabled={blocked} onClick={() => edit(reward)}>
                    {t('edit')}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      blocked ||
                      listConflict ||
                      observed?.id === reward.id ||
                      (!reward.active && reward.style === 'image' && !reward.image_url)
                    }
                    title={
                      reward.style === 'image' && !reward.image_url
                        ? t('errors.imageRequired')
                        : undefined
                    }
                    onClick={() =>
                      void write(
                        () =>
                          updateReward(
                            reward.id,
                            { ...inputFrom(reward), active: !reward.active },
                            reward.revision,
                          ),
                        t('updateSuccess'),
                        () => {},
                      )
                    }
                  >
                    {t(reward.active ? 'delist' : 'publish')}
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={blocked || listConflict || reward.owned_count > 0}
                    onClick={() => {
                      if (window.confirm(t('deleteConfirm', { name: reward.name })))
                        void write(
                          () => deleteReward(reward.id, reward.revision),
                          t('deleteSuccess'),
                          () => {
                            if (observed?.id === reward.id) clearEditor();
                          },
                        );
                    }}
                  >
                    {t('delete')}
                  </Button>
                </div>
              </article>
            ))}
          </div>
          <Pagination
            page={page}
            total={collection.data.total}
            pageSize={pageSize}
            onChange={(next) => {
              if (!busy) setPage(next);
            }}
          />
        </>
      )}
    </div>
  );
}
