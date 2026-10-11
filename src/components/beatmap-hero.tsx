'use client';
import { NavigationLink as Link } from './navigation-motion';
import { useTranslations } from 'next-intl';
import type { CSSProperties, ReactNode } from 'react';
import { Clock, Music2, Star, Target } from 'lucide-react';
import { MapArtwork } from '@/features/map-discovery';
import { difficultyStyle } from '@/lib/difficulty-color';
import './beatmap-hero.css';

const MODES = ['osu!', 'taiko', 'catch', 'mania'];

export type HeroDifficulty = {
  key: string | number;
  mode: number;
  version: string;
  stars: number;
  current: boolean;
  /** Link target; chips without one act as buttons through `onSelect`. */
  href?: string;
  onSelect?: () => void;
};

export type HeroStats = {
  stars: number;
  lengthSeconds: number;
  bpm: number | null;
  maxCombo: number | null;
  cs?: number | null;
  hp?: number | null;
  ar?: number | null;
  od?: number | null;
};

function duration(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function Bar({ label, value, max = 10 }: { label: string; value: number; max?: number }) {
  return (
    <div className="bm-bar">
      <span>{label}</span>
      <span className="bm-bar-track" aria-hidden="true">
        <span style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
      </span>
      <b>{value.toFixed(1)}</b>
    </div>
  );
}

/**
 * Beatmapset header: cover as the backdrop, a row of difficulty chips, the selected difficulty,
 * title, artist and mapper on the left, and a stats panel with parameter bars on the right.
 */
export function BeatmapHero({
  coverSource,
  coverSetId,
  status,
  badges,
  title,
  artist,
  creator,
  difficulties,
  selectedVersion,
  selectedMode,
  stats,
  actions,
  notes,
}: {
  coverSource: string;
  coverSetId?: number;
  status: ReactNode;
  badges?: ReactNode;
  title: string;
  artist: string;
  creator: string;
  difficulties: HeroDifficulty[];
  selectedVersion: string;
  selectedMode: number;
  stats: HeroStats;
  actions?: ReactNode;
  notes?: ReactNode;
}) {
  const t = useTranslations('maps');
  const c = useTranslations('common');
  const bars: [string, number | null | undefined][] = [
    ['CS', stats.cs],
    ['HP', stats.hp],
    ['AR', stats.ar],
    ['OD', stats.od],
  ];
  return (
    <section className="bm-hero glass" aria-label={title}>
      <MapArtwork source={coverSource} nativeSetId={coverSetId} className="bm-hero-art" priority />
      <div className="bm-hero-shade" aria-hidden="true" />
      <div className="bm-hero-main">
        {difficulties.length > 0 && (
          <div className="bm-diffs" role="group" aria-label={t('currentDifficulty')}>
            {difficulties.map((item) => {
              const content = (
                <>
                  <span className="bm-diff-dot" aria-hidden="true" />
                  <span className="bm-diff-stars">{item.stars.toFixed(2)}</span>
                </>
              );
              const props = {
                className: 'bm-diff',
                style: difficultyStyle(item.stars) as CSSProperties,
                title: `${item.version} · ${MODES[item.mode] ?? ''} · ${item.stars.toFixed(2)} ★`,
                'aria-label': `${item.version}, ${MODES[item.mode] ?? ''}, ${item.stars.toFixed(2)} ★`,
                'aria-current': item.current ? ('true' as const) : undefined,
              };
              return item.href ? (
                <Link key={item.key} href={item.href} {...props}>
                  {content}
                </Link>
              ) : (
                <button key={item.key} type="button" onClick={item.onSelect} {...props}>
                  {content}
                </button>
              );
            })}
          </div>
        )}
        <div className="bm-selected" style={difficultyStyle(stats.stars)}>
          <span className="bm-star-pill">
            <Star aria-hidden="true" />
            {stats.stars.toFixed(2)}
          </span>
          <strong>{selectedVersion}</strong>
          <span className="bm-mode">{MODES[selectedMode]}</span>
        </div>
        <h1>{title}</h1>
        <p className="bm-artist">{artist}</p>
        <p className="bm-mapper">
          {t('creator')} <strong>{creator}</strong>
        </p>
        {actions && <div className="bm-actions">{actions}</div>}
      </div>
      <aside className="bm-hero-side">
        <div className="bm-status">
          {status}
          {badges}
        </div>
        <div className="bm-panel" aria-label={t('currentDifficulty')}>
          <div className="bm-facts">
            <span title={t('length')}>
              <Clock aria-hidden="true" />
              {duration(stats.lengthSeconds)}
            </span>
            <span title={t('bpm')}>
              <Music2 aria-hidden="true" />
              {stats.bpm === null ? '—' : stats.bpm.toFixed(0)}
            </span>
            <span title={c('combo')}>
              <Target aria-hidden="true" />
              {stats.maxCombo === null ? '—' : `${stats.maxCombo}x`}
            </span>
          </div>
          <div className="bm-bars">
            {bars
              .filter((bar): bar is [string, number] => typeof bar[1] === 'number')
              .map(([label, value]) => (
                <Bar key={label} label={label} value={value} />
              ))}
            <Bar label={t('stars')} value={stats.stars} />
          </div>
        </div>
      </aside>
      {notes && <div className="bm-notes">{notes}</div>}
    </section>
  );
}
