'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { ChatSendPolicy } from './chat-status';

export function ChatSendNotice({
  policy,
  noPermission,
}: {
  policy: ChatSendPolicy;
  noPermission: boolean;
}) {
  const t = useTranslations('chat');
  const common = useTranslations('common');
  const f = useFormatter();
  const silenced = policy.status?.send_restriction === 'silenced';
  if (!noPermission && !silenced && !policy.error && !policy.checking) return null;
  const remaining = policy.remainingSeconds;
  const duration = `${Math.floor(remaining / 3600)
    .toString()
    .padStart(2, '0')}:${Math.floor((remaining % 3600) / 60)
    .toString()
    .padStart(2, '0')}:${(remaining % 60).toString().padStart(2, '0')}`;
  return (
    <div
      id="chat-send-notice"
      className="chat-error flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm text-[var(--secondary-text)]"
      data-chat-send-notice
    >
      <p className="min-w-0 flex-1" role="status">
        {noPermission ? (
          t('sendNoPermission')
        ) : silenced ? (
          <>
            {t('silencedUntil', {
              time: f.dateTime(new Date(policy.status!.silenced_until!), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })}{' '}
            {remaining > 0 ? (
              <span className="whitespace-nowrap tabular-nums" aria-live="off">
                {t('silenceRemaining', { duration })}
              </span>
            ) : (
              t('silenceExpiredChecking')
            )}
          </>
        ) : policy.error ? (
          t('statusLoadError')
        ) : (
          t('statusChecking')
        )}
      </p>
      {policy.error && !noPermission ? (
        <>
          {silenced ? <span role="alert">{t('statusLoadError')}</span> : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={policy.checking}
            onClick={() => void policy.refresh()}
          >
            {common('retry')}
          </Button>
        </>
      ) : null}
    </div>
  );
}
