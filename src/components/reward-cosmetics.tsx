import type { CSSProperties, ReactNode } from 'react';
import type { Reward } from '@/lib/rewards';
import styles from './reward-cosmetics.module.css';

type Cosmetic = Pick<Reward, 'name' | 'kind' | 'style' | 'color'> | null | undefined;
function presentation(reward: Cosmetic): CSSProperties {
  return {
    '--reward-color':
      reward?.color && /^#[0-9a-f]{6}$/i.test(reward.color)
        ? reward.color
        : 'var(--profile-accent, var(--accent))',
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
    !['line', 'double', 'corners'].includes(reward.style ?? '')
  )
    return <>{children}</>;
  return (
    <span className={styles.frame} data-reward-frame={reward.style} style={presentation(reward)}>
      {children}
    </span>
  );
}
