'use client';

import { useTranslations } from 'next-intl';

const officialStatuses = [
  'ranked',
  'approved',
  'qualified',
  'loved',
  'pending',
  'wip',
  'graveyard',
];

/** Display the supplied status without inferring it from a set or star rating. */
export function MapStatus({
  value,
  context = 'difficulty',
}: {
  value: string | undefined;
  context?: 'set' | 'difficulty';
}) {
  const t = useTranslations('mapDiscovery');
  const official = useTranslations('maps.officialSearch');
  if (!value) return null;
  const known = officialStatuses.includes(value);
  const label =
    value === 'unranked' ? t('status.unranked') : known ? official(`statuses.${value}`) : value;
  const fact = t(context === 'set' ? 'setStatusFact' : 'difficultyStatusFact', { status: label });
  return (
    <span
      className={`discovery-status${known || value === 'unranked' ? ` status-${value}` : ''}`}
      data-status={value}
      aria-label={fact}
      title={fact}
    >
      {label}
    </span>
  );
}
