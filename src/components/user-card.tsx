'use client';
import { NavigationLink as Link } from './navigation-motion';
import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import type { User } from '@/lib/types';
import { Avatar } from './common';
import { CountryFlag } from './country-flag';
import { RoleBadge } from './role-badge';
import { CardMenu, FriendToggle } from './card-relationship';
import { RewardTitle } from './reward-cosmetics';
import './user-card.css';

export type CardUser = {
  id: number;
  username: string;
  avatar_url: string | null;
  country: string;
  banner_url?: string | null;
  banner_position_x?: number;
  banner_position_y?: number;
  accent_color?: string;
  online?: boolean;
  cosmetics?: User['cosmetics'];
  groups?: {
    id: number;
    name: string;
    short_name: string;
    colour: string | null;
    icon?: string | null;
  }[];
};

const hex = /^#[0-9a-f]{6}$/i;

/**
 * Compact player card for any list of people: banner as a dim backdrop, avatar with a presence
 * dot, name, flag, group badges and equipped cosmetics. The whole card opens the profile.
 */
export function UserCard({ user }: { user: CardUser }) {
  const t = useTranslations('people');
  const style = hex.test(user.accent_color ?? '')
    ? ({ '--card-accent': user.accent_color } as CSSProperties)
    : undefined;
  return (
    <article className="user-card" style={style} data-online={user.online ? '' : undefined}>
      {user.banner_url && (
        <div
          className="user-card-cover"
          aria-hidden="true"
          style={{
            backgroundImage: `url(${JSON.stringify(user.banner_url)})`,
            backgroundPosition: `${user.banner_position_x ?? 50}% ${user.banner_position_y ?? 50}%`,
          }}
        />
      )}
      <div className="user-card-avatar">
        <Avatar
          name={user.username}
          url={user.avatar_url}
          size="large"
          frame={user.cosmetics?.avatar_frame ?? null}
        />
      </div>
      <div className="user-card-body">
        <div className="user-card-meta">
          <CountryFlag country={user.country} display="flag" />
          <FriendToggle target={user.id} />
        </div>
        <div className="user-card-title">
          <Link href={`/users/${user.id}`} className="user-card-name" data-user-preview>
            {user.username}
          </Link>
          {user.groups?.map((group) => (
            <RoleBadge
              key={group.id}
              id={group.id}
              label={group.short_name}
              name={group.name}
              colour={group.colour}
              icon={group.icon}
              compact
            />
          ))}
        </div>
        {user.cosmetics?.title?.kind === 'title' && (
          <div className="user-card-cosmetic">
            <RewardTitle reward={user.cosmetics.title} />
          </div>
        )}
      </div>
      {user.online !== undefined && (
        <div className="user-card-status">
          <span
            className="user-card-presence"
            data-online={user.online ? '' : undefined}
            aria-hidden="true"
          />
          <span>{user.online ? t('online') : t('offline')}</span>
          <CardMenu target={user.id} username={user.username} />
        </div>
      )}
    </article>
  );
}
