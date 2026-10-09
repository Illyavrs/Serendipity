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
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
          <path d="M7.5 6.5 14.5 10.5l-7 4Z" fill="currentColor" />
          <path d="m11.5 9.5 7 4-7 4Z" fill="currentColor" />
        </svg>
      ) : client === 'stable' ? (
        <Circle aria-hidden="true" />
      ) : (
        <Braces aria-hidden="true" />
      )}
    </span>
  );
}
