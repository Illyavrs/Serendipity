'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

export type ChatStatus = {
  can_send: boolean;
  send_restriction: 'silenced' | 'no_permission' | null;
  silenced_until: string | null;
  server_time: string;
};
type Snapshot = { value: ChatStatus; receivedAt: number; remainingAtReceipt: number };
type State = {
  userId: number | undefined;
  snapshot: Snapshot | null;
  checking: boolean;
  error: boolean;
};

function snapshot(value: ChatStatus): Snapshot {
  const timestamp = (text: unknown) =>
    typeof text === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(text);
  const serverTime = Date.parse(value.server_time);
  const until = value.silenced_until === null ? null : Date.parse(value.silenced_until);
  if (
    !timestamp(value.server_time) ||
    !Number.isFinite(serverTime) ||
    (value.silenced_until !== null && !timestamp(value.silenced_until)) ||
    (until !== null && !Number.isFinite(until)) ||
    typeof value.can_send !== 'boolean' ||
    ![null, 'silenced', 'no_permission'].includes(value.send_restriction) ||
    value.can_send !== (value.send_restriction === null) ||
    (value.send_restriction === 'silenced' && until === null) ||
    (value.send_restriction === null && until !== null)
  )
    throw new Error('Invalid chat status');
  return {
    value,
    receivedAt: performance.now(),
    remainingAtReceipt: until === null ? 0 : Math.max(0, until - serverTime),
  };
}

// Server time anchors the countdown. Wall-clock changes on this device never grant sending.
export function useChatStatus(userId: number | undefined) {
  const [state, setState] = useState<State>({
    userId,
    snapshot: null,
    checking: userId !== undefined,
    error: false,
  });
  const [elapsed, setElapsed] = useState(0);
  const alive = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const expiredSnapshot = useRef<Snapshot | null>(null);

  const refresh = useCallback(
    async (invalidate = false) => {
      if (userId === undefined || !alive.current) return;
      // Ordinary timer/focus/retry calls share the current check. A policy event invalidates it.
      if (controller.current && !invalidate) return;
      controller.current?.abort();
      const request = new AbortController();
      controller.current = request;
      setState((previous) => ({
        userId,
        snapshot: previous.userId === userId ? previous.snapshot : null,
        checking: true,
        error: false,
      }));
      const timeout = setTimeout(() => request.abort(), 10000);
      try {
        const value = snapshot(
          await api<ChatStatus>('/chat/status', { signal: request.signal, cache: 'no-store' }),
        );
        if (!alive.current || controller.current !== request) return;
        setElapsed(0);
        setState({ userId, snapshot: value, checking: false, error: false });
      } catch {
        if (!alive.current || controller.current !== request) return;
        setState((previous) => ({ ...previous, checking: false, error: true }));
      } finally {
        clearTimeout(timeout);
        if (controller.current === request) controller.current = null;
      }
    },
    [userId],
  );

  useEffect(() => {
    alive.current = true;
    if (userId === undefined) return;
    queueMicrotask(() => void refresh());
    const timer = setInterval(() => void refresh(), 30000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    return () => {
      alive.current = false;
      controller.current?.abort();
      controller.current = null;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
    };
  }, [refresh, userId]);

  const current = state.userId === userId ? state.snapshot : null;
  useEffect(() => {
    if (!current || current.value.send_restriction !== 'silenced') return;
    const tick = () => {
      if (!alive.current) return;
      const passed = Math.max(0, performance.now() - current.receivedAt);
      setElapsed(passed);
      if (passed >= current.remainingAtReceipt && expiredSnapshot.current !== current) {
        expiredSnapshot.current = current;
        // Reaching zero requests authority; it does not turn an old denial into permission.
        void refresh();
      }
    };
    const timer = setInterval(tick, 1000);
    queueMicrotask(tick);
    return () => clearInterval(timer);
  }, [current, refresh]);

  return {
    status: current?.value ?? null,
    checking: state.userId !== userId || state.checking,
    error: state.userId === userId && state.error,
    remainingSeconds: current
      ? Math.ceil(Math.max(0, current.remainingAtReceipt - elapsed) / 1000)
      : 0,
    canSend:
      userId !== undefined &&
      state.userId === userId &&
      !state.checking &&
      !state.error &&
      current?.value.can_send === true,
    refresh,
  };
}

export type ChatSendPolicy = ReturnType<typeof useChatStatus>;
