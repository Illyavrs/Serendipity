'use client';
import { NavigationLink as Link } from './navigation-motion';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Ban,
  MessageCircle,
  MoreHorizontal,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { useSession } from './providers';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { hasPermission } from '@/lib/api';
import { useRelationship } from '@/lib/relationships';

/**
 * Round friend button in the card's top row: grey when not friends, pink when the viewer added
 * them, green when mutual, and a "+" prompt when only they added the viewer. Clicking toggles.
 */
export function FriendToggle({ target }: { target: number }) {
  const t = useTranslations('social');
  const { user } = useSession();
  const state = useRelationship(target);
  if (!user || user.id === target || !hasPermission(user.permissions, 'social.manage')) return null;
  if (state.blocked || state.loadError) return null;
  const kind = state.friend
    ? state.friendedBy
      ? 'mutual'
      : 'mine'
    : state.friendedBy
      ? 'theirs'
      : 'none';
  const label = {
    mutual: t('friendMutual'),
    mine: t('friendMine'),
    theirs: t('friendTheirs'),
    none: t('addFriend'),
  }[kind];
  return (
    <button
      type="button"
      className="card-friend"
      data-kind={kind}
      title={label}
      aria-label={label}
      aria-pressed={state.friend}
      disabled={!state.ready || state.busy}
      onClick={() => void state.change('friend', state.friend)}
    >
      {kind === 'theirs' ? (
        <UserPlus aria-hidden="true" />
      ) : kind === 'mutual' ? (
        <UserCheck aria-hidden="true" />
      ) : (
        <Users aria-hidden="true" />
      )}
    </button>
  );
}

/** The "…" menu in the card's status bar: message, remove friend, block. */
export function CardMenu({ target, username }: { target: number; username: string }) {
  const t = useTranslations('social');
  const c = useTranslations('common');
  const { user } = useSession();
  const state = useRelationship(target);
  const [confirm, setConfirm] = useState(false);
  if (!user || user.id === target) return null;
  const canManage = hasPermission(user.permissions, 'social.manage');
  const canMessage = hasPermission(user.permissions, 'chat.send');
  if (!canManage && !canMessage) return null;
  return (
    <div className="card-menu">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t('actions')} title={t('actions')}>
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canMessage && (
            <DropdownMenuItem asChild>
              <Link href={`/chat?recipient=${encodeURIComponent(username)}`}>
                <MessageCircle aria-hidden="true" />
                {t('message')}
              </Link>
            </DropdownMenuItem>
          )}
          {canManage && !state.loadError && (
            <>
              {state.friend && (
                <DropdownMenuItem
                  disabled={state.busy}
                  onSelect={() => void state.change('friend', true)}
                >
                  <UserMinus aria-hidden="true" />
                  {t('removeFriend')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                disabled={!state.ready || state.busy}
                onSelect={() =>
                  state.blocked ? void state.change('block', true) : setConfirm(true)
                }
              >
                <Ban aria-hidden="true" />
                {state.blocked ? t('unblock') : t('block')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirm && (
        <div className="card-menu-confirm" role="group" aria-label={t('block')}>
          <p>{t('blockConfirm')}</p>
          <div className="actions">
            <Button
              size="sm"
              disabled={state.busy}
              onClick={async () => {
                if (await state.change('block')) setConfirm(false);
              }}
            >
              {t('confirmBlock')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={state.busy}
              onClick={() => setConfirm(false)}
            >
              {c('cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
