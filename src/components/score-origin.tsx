'use client';

import { useTranslations } from 'next-intl';
import { Braces, Circle } from 'lucide-react';
import type { Score } from '@/lib/types';
import './score-origin.css';

/** Submission provenance is independent of ruleset, mods and score conversion. */
export function ScoreOrigin({ client }: Pick<Score, 'client'>) {
  const t = useTranslations('scores');
  if (client !== 'lazer' && client !== 'stable' && client !== 'api') return null;
  const label = t(
    client === 'lazer' ? 'originLazer' : client === 'stable' ? 'originStable' : 'originApi',
  );
  return (
    <span className="score-origin" data-client={client} role="img" aria-label={label} title={label}>
      {client === 'lazer' ? (
        <span className="score-origin-lazer" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M9.5 1.5 3 8.5h4L6.5 14.5 13 7.5H9Z" fill="currentColor" />
          </svg>
          <span>lazer</span>
        </span>
      ) : client === 'stable' ? (
        <Circle aria-hidden="true" />
      ) : (
        <Braces aria-hidden="true" />
      )}
    </span>
  );
}
