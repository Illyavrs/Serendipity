'use client';
import { NavigationLink as Link } from './navigation-motion';
import { useFormatter, useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { Avatar } from './common';
import { CountryFlag } from './country-flag';
import { useSession } from './providers';
import { scoreMods } from '@/lib/score-display';
import type { Score, ScoreBoardOrder } from '@/lib/types';
import './beatmap-leaderboard.css';

const GRADE_LABELS: Record<string, string> = {
  ssh: 'SS+',
  xh: 'SS+',
  ss: 'SS',
  x: 'SS',
  sh: 'S+',
  s: 'S',
  a: 'A',
  b: 'B',
  c: 'C',
  d: 'D',
  f: 'F',
};

function hitColumns(mode: number): [string, string][] {
  if (mode === 3)
    return [
      ['ngeki', 'MAX'],
      ['n300', '300'],
      ['nkatu', '200'],
      ['n100', '100'],
      ['n50', '50'],
      ['nmiss', 'miss'],
    ];
  if (mode === 1)
    return [
      ['n300', 'GREAT'],
      ['n100', 'GOOD'],
      ['nmiss', 'miss'],
    ];
  if (mode === 2)
    return [
      ['n300', 'fruits'],
      ['n100', 'ticks'],
      ['n50', 'drops'],
      ['nmiss', 'miss'],
    ];
  return [
    ['n300', '300'],
    ['n100', '100'],
    ['n50', '50'],
    ['nmiss', 'miss'],
  ];
}

function Grade({ score }: { score: Score }) {
  const key = typeof score.grade === 'string' ? score.grade.toLowerCase() : '';
  const label = GRADE_LABELS[key];
  return label ? (
    <span className="lb-grade" data-grade={key}>
      {label}
    </span>
  ) : (
    <span className="lb-grade" data-grade="none">
      —
    </span>
  );
}

function Mods({ score }: { score: Score }) {
  const mods = scoreMods(score);
  const labels = mods.labels.length ? mods.labels : mods.unknownBits ? ['?'] : [];
  return labels.length ? (
    <span className="lb-mods">
      {labels.map((label, index) => (
        <span key={`${label}-${index}`} className="lb-mod">
          {label}
        </span>
      ))}
    </span>
  ) : (
    <span className="lb-none">—</span>
  );
}

/**
 * Map leaderboard: the best play gets a feature card, everyone else a dense row with the figures
 * players compare (score, accuracy, combo, hit counts, pp, when, mods). The signed-in player's
 * own rows are highlighted.
 */
export function BeatmapLeaderboard({
  scores,
  orderedBy,
  mode,
}: {
  scores: Score[];
  orderedBy: ScoreBoardOrder;
  mode: number;
}) {
  const c = useTranslations('common');
  const t = useTranslations('scores');
  const f = useFormatter();
  const { user } = useSession();
  const columns = hitColumns(mode);
  const scoreValue = (score: Score) => score.standardised_score ?? score.score;
  const when = (score: Score) => f.relativeTime(new Date(score.created_at), new Date());
  const hit = (score: Score, key: string) => {
    const value = score.hit_counts?.[key];
    return typeof value === 'number' ? f.number(value) : '—';
  };
  const [top, ...rest] = scores;
  return (
    <div className="lb">
      {top && (
        <article className="lb-top" data-self={user?.id === top.user_id ? '' : undefined}>
          <Link href={`/scores/${top.id}`} className="lb-top-link" aria-label={top.username} />
          <div className="lb-top-player">
            <span className="lb-top-position">#{top.position ?? 1}</span>
            <Grade score={top} />
            <Link
              data-user-preview
              href={`/users/${top.user_id}?mode=${top.mode}&variant=${top.score_variant ?? 'vanilla'}`}
              className="lb-top-avatar"
              aria-label={top.username}
            >
              <Avatar userId={top.user_id} name={top.username} url={top.avatar_url} />
            </Link>
            <div>
              <Link
                data-user-preview
                href={`/users/${top.user_id}?mode=${top.mode}&variant=${top.score_variant ?? 'vanilla'}`}
                className="lb-top-name"
              >
                {top.username}
              </Link>
              <div className="lb-top-sub">
                {top.country && <CountryFlag country={top.country} display="flag" />}
                <time dateTime={top.created_at}>{when(top)}</time>
              </div>
            </div>
          </div>
          <dl className="lb-top-stats">
            <div>
              <dt>{orderedBy === 'pp' ? c('pp') : t('comparisonStandardised')}</dt>
              <dd className="lb-top-score">
                {orderedBy === 'pp' ? top.pp.toFixed(2) : f.number(scoreValue(top))}
              </dd>
            </div>
            <div>
              <dt>{c('accuracy')}</dt>
              <dd data-perfect={top.accuracy >= 100 ? '' : undefined}>
                {top.accuracy.toFixed(2)}%
              </dd>
            </div>
            <div>
              <dt>{c('combo')}</dt>
              <dd>{f.number(top.max_combo)}x</dd>
            </div>
            {columns.map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd data-zero={top.hit_counts?.[key] === 0 ? '' : undefined}>{hit(top, key)}</dd>
              </div>
            ))}
            {orderedBy !== 'pp' && (
              <div>
                <dt>{c('pp')}</dt>
                <dd>{top.pp.toFixed(2)}</dd>
              </div>
            )}
            <div>
              <dt>{c('mods')}</dt>
              <dd>
                <Mods score={top} />
              </dd>
            </div>
          </dl>
        </article>
      )}
      {rest.length > 0 && (
        <div className="lb-scroll" role="region" tabIndex={0} aria-label={c('tableScroll')}>
          <table className="lb-table">
            <thead>
              <tr>
                <th>{t('rankPosition')}</th>
                <th aria-label={c('grade')} />
                <th>{orderedBy === 'pp' ? c('pp') : c('score')}</th>
                <th>{c('accuracy')}</th>
                <th aria-label={c('country')} />
                <th className="lb-left">{c('username')}</th>
                <th>{c('combo')}</th>
                {columns.map(([key, label]) => (
                  <th key={key}>{label}</th>
                ))}
                {orderedBy !== 'pp' && <th>{c('pp')}</th>}
                <th>{c('date')}</th>
                <th className="lb-left">{c('mods')}</th>
                <th aria-label={c('replay')} />
              </tr>
            </thead>
            <tbody>
              {rest.map((score) => (
                <tr key={score.id} data-self={user?.id === score.user_id ? '' : undefined}>
                  <td className="lb-rank">#{score.position ?? ''}</td>
                  <td>
                    <Grade score={score} />
                  </td>
                  <td className="lb-strong">
                    <Link href={`/scores/${score.id}`}>
                      {orderedBy === 'pp' ? score.pp.toFixed(2) : f.number(scoreValue(score))}
                    </Link>
                  </td>
                  <td data-perfect={score.accuracy >= 100 ? '' : undefined}>
                    {score.accuracy.toFixed(2)}%
                  </td>
                  <td>{score.country && <CountryFlag country={score.country} display="flag" />}</td>
                  <td className="lb-left">
                    <Link
                      className="lb-player"
                      data-user-preview
                      href={`/users/${score.user_id}?mode=${score.mode}&variant=${score.score_variant ?? 'vanilla'}`}
                    >
                      {score.username}
                    </Link>
                  </td>
                  <td>{f.number(score.max_combo)}x</td>
                  {columns.map(([key]) => (
                    <td key={key} data-zero={score.hit_counts?.[key] === 0 ? '' : undefined}>
                      {hit(score, key)}
                    </td>
                  ))}
                  {orderedBy !== 'pp' && <td>{score.pp.toFixed(2)}</td>}
                  <td className="lb-when">
                    <time dateTime={score.created_at}>{when(score)}</time>
                  </td>
                  <td className="lb-left">
                    <Mods score={score} />
                  </td>
                  <td>
                    {score.has_replay && (
                      <a
                        className="lb-replay"
                        href={`/api/v1/scores/${score.id}/replay`}
                        aria-label={c('replay')}
                        title={c('replay')}
                      >
                        <Download aria-hidden="true" />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
