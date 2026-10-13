import Image from 'next/image';
import type { CSSProperties, ReactNode } from 'react';
import type { Reward } from '@/lib/rewards';
import styles from './reward-cosmetics.module.css';

export type RewardDecoration = Pick<Reward, 'name' | 'kind' | 'style' | 'color' | 'image_url'>;
type Cosmetic = RewardDecoration | null | undefined;
function presentation(reward: Cosmetic): CSSProperties {
  return {
    '--reward-color':
      reward?.color && /^#[0-9a-f]{6}$/i.test(reward.color)
        ? reward.color
        : 'var(--profile-accent, var(--card-accent, var(--user-accent, #f28eb6)))',
  } as CSSProperties;
}

export function RewardTitle({ reward }: { reward: Cosmetic }) {
  if (reward?.kind !== 'title') return null;
  return (
    <span className={styles.title} style={presentation(reward)} data-reward-title>
      {reward.name}
    </span>
  );
}

export function RewardAvatarFrame({ reward, children }: { reward: Cosmetic; children: ReactNode }) {
  if (
    reward?.kind !== 'avatar_frame' ||
    !['line', 'double', 'corners', 'image'].includes(reward.style ?? '') ||
    (reward.style === 'image' &&
      !/^\/media\/reward-frames\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/.test(
        reward.image_url ?? '',
      ))
  )
    return <>{children}</>;
  return (
    <span className={styles.frame} data-reward-frame={reward.style} style={presentation(reward)}>
      {children}
      {reward.style === 'image' && reward.image_url && (
        <Image
          src={reward.image_url}
          alt=""
          aria-hidden="true"
          width={512}
          height={512}
          className={styles.frameImage}
          unoptimized
          draggable={false}
        />
      )}
    </span>
  );
}
