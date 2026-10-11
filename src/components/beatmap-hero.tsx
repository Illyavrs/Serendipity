'use client';
import { NavigationLink as Link } from './navigation-motion';
import { useTranslations } from 'next-intl';
import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';
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

/** Outline mode glyphs drawn in the difficulty colour, in the style of the game's own mode icons. */
function ModeGlyph({ mode }: { mode: number }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (mode === 1)
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="4.5" />
        <path d="M12 3v4.5M12 16.5V21" />
      </svg>
    );
  if (mode === 2)
    return (
      <svg {...common}>
        <path d="M12 4c4 4 6 7 6 10a6 6 0 0 1-12 0c0-3 2-6 6-10z" />
        <path d="M12 4c1-1.5 2.4-2 4-2" />
      </svg>
    );
  if (mode === 3)
    return (
      <svg {...common}>
        <path d="M5 4v16M10 4v16M15 4v16M20 4v16" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

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
  // Hovering or focusing a chip previews that difficulty's name in the line below the chips.
  const [previewKey, setPreviewKey] = useState<string | number | null>(null);
  const preview = difficulties.find((item) => item.key === previewKey);
  const shown = preview
    ? { version: preview.version, mode: preview.mode, stars: preview.stars }
    : { version: selectedVersion, mode: selectedMode, stars: stats.stars };
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
              const content = <ModeGlyph mode={item.mode} />;
              const props = {
                className: 'bm-diff',
                style: difficultyStyle(item.stars) as CSSProperties,
                title: `${item.version} · ${MODES[item.mode] ?? ''} · ${item.stars.toFixed(2)} ★`,
                'aria-label': `${item.version}, ${MODES[item.mode] ?? ''}, ${item.stars.toFixed(2)} ★`,
                'aria-current': item.current ? ('true' as const) : undefined,
                onMouseEnter: () => setPreviewKey(item.key),
                onMouseLeave: () => setPreviewKey(null),
                onFocus: () => setPreviewKey(item.key),
                onBlur: () => setPreviewKey(null),
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
        <div className="bm-selected" style={difficultyStyle(shown.stars)}>
          <span className="bm-star-pill">
            <Star aria-hidden="true" />
            {shown.stars.toFixed(2)}
          </span>
          <strong>{shown.version}</strong>
          <span className="bm-mode">{MODES[shown.mode]}</span>
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
