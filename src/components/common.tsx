'use client';
import { NavigationLink as Link } from './navigation-motion';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, Disc3, RefreshCw, AlertCircle, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from './providers';
import { hasPermission } from '@/lib/api';
import { usePublicUserCard } from '@/lib/public-user-cards';
import type { User } from '@/lib/types';
import { RewardAvatarFrame, type RewardDecoration } from './reward-cosmetics';
import type { ReactNode } from 'react';

export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </header>
  );
}
export function Loading() {
  const t = useTranslations('common');
  return (
    <div className="loading-block" role="status" aria-label={t('loading')}>
      <Skeleton className="h-8 w-2/5" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}
export function LoadError({ retry }: { retry?: () => void }) {
  const t = useTranslations('common');
  return (
    <div className="empty-state" role="alert">
      <AlertCircle />
      <h2>{t('error')}</h2>
      {retry && (
        <Button variant="outline" onClick={retry}>
          <RefreshCw />
          {t('retry')}
        </Button>
      )}
    </div>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Disc3 className="empty-disc" />
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}
export function Pagination({
  page,
  total,
  pageSize = 24,
  onChange,
}: {
  page: number;
  total: number;
  pageSize?: number;
  onChange: (page: number) => void;
}) {
  const t = useTranslations('common');
  return total > pageSize ? (
    <div className="pagination">
      <Button
        type="button"
        variant="outline"
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
      >
        <ArrowLeft />
        {t('previous')}
      </Button>
      <span>
        {page} / {Math.ceil(total / pageSize)}
      </span>
      <Button
        type="button"
        variant="outline"
        disabled={page * pageSize >= total}
        onClick={() => onChange(page + 1)}
      >
        {t('next')}
        <ArrowRight />
      </Button>
    </div>
  ) : null;
}
export function Protected({ permission, children }: { permission?: string; children: ReactNode }) {
  const { user, loading } = useSession();
  const t = useTranslations('common');
  if (loading) return <Loading />;
  if (!user)
    return (
      <Empty title={t('signInRequired')}>
        <Button asChild>
          <Link href="/login">{t('signInRequired')}</Link>
        </Button>
      </Empty>
    );
  if (permission && !hasPermission(user.permissions, permission))
    return <Empty title={t('noPermission')} />;
  return children;
}
export function Avatar({
  name,
  url,
  size = 'normal',
  userId,
  cosmetics,
  frame,
}: {
  name: string;
  url?: string | null;
  size?: 'normal' | 'large';
  userId?: number;
  cosmetics?: User['cosmetics'];
  frame?: RewardDecoration | null;
}) {
  const card = usePublicUserCard(
    cosmetics === undefined && frame === undefined ? userId : undefined,
  );
  const decoration =
    frame !== undefined ? frame : (cosmetics?.avatar_frame ?? card?.cosmetics?.avatar_frame);
  const imageUrl = url === undefined ? card?.avatar_url : url;
  return (
    <RewardAvatarFrame reward={decoration}>
      <span className={`avatar avatar-${size}`} data-user-avatar>
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt=""
            width={size === 'large' ? 104 : 32}
            height={size === 'large' ? 104 : 32}
            unoptimized
          />
        ) : (
          name.slice(0, 1).toUpperCase()
        )}
      </span>
    </RewardAvatarFrame>
  );
}
export function GameMode({
  value,
  onChange,
  all = false,
  allowedModes,
  starred,
}: {
  value: string;
  onChange: (value: string) => void;
  all?: boolean;
  allowedModes?: readonly string[];
  /** Mode id marked with a star, for the player's preferred mode. */
  starred?: string;
}) {
  const t = useTranslations('common');
  return (
    <div className="mode-control" role="group" aria-label={t('mode')}>
      {[
        ...(all ? [['all', t('all')]] : []),
        ['0', 'osu!'],
        ['1', 'taiko'],
        ['2', 'catch'],
        ['3', 'mania'],
      ].map(([id, name]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          disabled={allowedModes !== undefined && !allowedModes.includes(id)}
          onClick={() => onChange(id)}
        >
          {name}
          {starred === id && <Star className="mode-star" aria-label={t('preferred')} />}
        </button>
      ))}
    </div>
  );
}
