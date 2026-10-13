'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { CardUser } from '@/components/user-card';
import { api } from './api';

type Entry = { card: CardUser | null; expires: number };
const cards = new Map<number, Entry>();
const pending = new Map<number, Promise<CardUser | null>>();
type Queued = {
  resolve: (card: CardUser | null) => void;
  version: number;
  request: Promise<CardUser | null>;
};
const queued = new Map<number, Queued>();
const listeners = new Set<() => void>();
const versions = new Map<number, number>();
let batchTimer: ReturnType<typeof setTimeout> | undefined;
const freshFor = 60_000;

function validId(id: number | undefined): id is number {
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0;
}

function notify() {
  for (const listener of listeners) listener();
}

/** Public presentation only: no wallet, inventory or relationship data belongs in this cache. */
export function primePublicUserCards(users: CardUser[]) {
  for (const user of users) {
    if (!validId(user.id)) continue;
    versions.set(user.id, (versions.get(user.id) ?? 0) + 1);
    queued.get(user.id)?.resolve(null);
    queued.delete(user.id);
    pending.delete(user.id);
    cards.set(user.id, { card: user, expires: Date.now() + freshFor });
  }
  notify();
}

export function invalidatePublicUserCards(ids?: number[]) {
  if (ids) {
    for (const id of ids) {
      cards.delete(id);
      versions.set(id, (versions.get(id) ?? 0) + 1);
      queued.get(id)?.resolve(null);
      queued.delete(id);
      pending.delete(id);
    }
  } else {
    for (const id of new Set([...cards.keys(), ...pending.keys()]))
      versions.set(id, (versions.get(id) ?? 0) + 1);
    cards.clear();
    for (const entry of queued.values()) entry.resolve(null);
    queued.clear();
    pending.clear();
  }
  notify();
}

async function flush() {
  batchTimer = undefined;
  const entries = [...queued.entries()];
  queued.clear();
  // Lists of players can mount many avatars together. Bound every API batch rather than
  // making one request for every avatar, and share pending reads with hover previews.
  await Promise.all(
    Array.from({ length: Math.ceil(entries.length / 60) }, async (_, index) => {
      const batch = entries.slice(index * 60, (index + 1) * 60);
      let found = new Map<number, CardUser>();
      try {
        const result = await api<{ items: CardUser[] }>(
          `/users/cards?ids=${batch.map(([id]) => id).join(',')}`,
        );
        found = new Map(result.items.map((card) => [card.id, card]));
      } catch {
        // Unavailable/restricted players do not produce a fabricated or stale preview.
      }
      for (const [id, entry] of batch) {
        const card = found.get(id) ?? null;
        const current = entry.version === (versions.get(id) ?? 0);
        if (current) {
          cards.set(id, { card, expires: Date.now() + (card ? freshFor : 5_000) });
          if (pending.get(id) === entry.request) pending.delete(id);
        }
        entry.resolve(current ? card : null);
      }
      notify();
    }),
  );
}

function cachedOrPending(id: number) {
  const cached = cards.get(id);
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.card);
  return pending.get(id);
}

function queuePublicUserCard(id: number): Promise<CardUser | null> {
  if (!validId(id)) return Promise.resolve(null);
  const existing = cachedOrPending(id);
  if (existing) return existing;
  let complete!: (card: CardUser | null) => void;
  const request = new Promise<CardUser | null>((resolve) => {
    complete = resolve;
  });
  queued.set(id, { resolve: complete, version: versions.get(id) ?? 0, request });
  pending.set(id, request);
  batchTimer ??= setTimeout(() => void flush(), 10);
  return request;
}

/** Hover reads are lazy; an existing avatar batch or public card is reused when available. */
export function fetchPublicUserCard(id: number): Promise<CardUser | null> {
  if (!validId(id)) return Promise.resolve(null);
  const existing = cachedOrPending(id);
  if (existing) return existing;
  const requestVersion = versions.get(id) ?? 0;
  const request = api<CardUser>(`/users/${id}/card`)
    .catch(() => null)
    .then((value) => {
      const card = value?.id === id ? value : null;
      const current = requestVersion === (versions.get(id) ?? 0);
      if (current) {
        cards.set(id, { card, expires: Date.now() + (card ? freshFor : 5_000) });
        if (pending.get(id) === request) pending.delete(id);
        notify();
      }
      return current ? card : null;
    });
  pending.set(id, request);
  return request;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Missing avatar metadata is fetched in a shared batch; known list/profile data can seed it. */
export function usePublicUserCard(userId?: number, initialCard?: CardUser | null) {
  const snapshot = useCallback(
    () => (validId(userId) ? (cards.get(userId)?.card ?? undefined) : undefined),
    [userId],
  );
  const serverSnapshot = useCallback(() => undefined, []);
  const card = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const versionSnapshot = useCallback(
    () => (validId(userId) ? (versions.get(userId) ?? 0) : 0),
    [userId],
  );
  const version = useSyncExternalStore(subscribe, versionSnapshot, () => 0);
  useEffect(() => {
    if (!validId(userId)) return;
    if (initialCard?.id === userId) primePublicUserCards([initialCard]);
  }, [userId, initialCard]);
  useEffect(() => {
    if (validId(userId)) void queuePublicUserCard(userId);
  }, [userId, version]);
  return card ?? (initialCard?.id === userId ? initialCard : undefined);
}
