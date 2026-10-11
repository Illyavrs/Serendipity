'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { useSession } from '@/components/providers';
import { api, ApiError } from '@/lib/api';
import type { CardUser } from '@/components/user-card';

export type Relationship = {
  target_id: number;
  relation_type: 'friend' | 'block';
  mutual: boolean;
  target: CardUser;
};
export type Relationships = {
  friends: Relationship[];
  blocks: Relationship[];
  /** Ids of players who added the signed-in player as a friend. */
  friended_by?: number[];
};

export function useRelationships() {
  const { user } = useSession();
  return useSWR<Relationships>(user ? ['relationships', user.id] : null, () =>
    api('/me/relationships'),
  );
}

/** How the signed-in player and `target` are related, plus the mutations for it. */
export function useRelationship(target: number) {
  const { data, error: loadError, mutate } = useRelationships();
  const [busy, setBusy] = useState(false);
  const friend = !!data?.friends.some((r) => r.target_id === target);
  const blocked = !!data?.blocks.some((r) => r.target_id === target);
  const friendedBy = !!data?.friended_by?.includes(target);
  async function change(kind: 'friend' | 'block', remove = false) {
    if (busy) return false;
    setBusy(true);
    try {
      await api(`/me/relationships/${target}${remove ? `?relation_type=${kind}` : ''}`, {
        method: remove ? 'DELETE' : 'POST',
        ...(remove ? {} : { body: JSON.stringify({ relation_type: kind }) }),
      });
      await mutate();
      return true;
    } catch (e) {
      // A blocked player cannot be friended; refresh so the controls match the server.
      if (!(e instanceof ApiError)) throw e;
      await mutate();
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { ready: !!data, loadError, friend, blocked, friendedBy, busy, change };
}
