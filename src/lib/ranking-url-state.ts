import type { ScoreVariant } from './types';

type Query = Pick<URLSearchParams, 'get'>;
export type RankingSelection = {
  mode: string;
  variant: ScoreVariant;
  country: string;
  page: number;
};
export type RankingUrlOptions = {
  defaultMode?: number;
  lockedMode?: number;
  country?: boolean;
  compact?: boolean;
};

export function readRankingSelection(
  query: Query,
  options: RankingUrlOptions = {},
): RankingSelection {
  const fallback = String(options.defaultMode ?? 0);
  const rawMode = query.get('mode') ?? fallback;
  const mode =
    options.lockedMode !== undefined
      ? String(options.lockedMode)
      : /^[0-3]$/.test(rawMode)
        ? rawMode
        : fallback;
  const rawPage = query.get('page') ?? '1';
  const page = /^\d+$/.test(rawPage) ? Number(rawPage) : 1;
  const country = query.get('country') ?? '';
  return {
    mode,
    variant: mode !== '3' && query.get('variant') === 'relax' ? 'relax' : 'vanilla',
    country: options.country && /^[a-z]{2}$/i.test(country) ? country.toUpperCase() : '',
    page: Number.isSafeInteger(page) ? Math.max(1, Math.min(page, 1_000_000)) : 1,
  };
}

function writeSelection(
  query: URLSearchParams,
  selection: RankingSelection,
  options: RankingUrlOptions,
) {
  if (options.compact && selection.mode === String(options.defaultMode ?? 0)) query.delete('mode');
  else query.set('mode', selection.mode);
  if (options.compact && selection.variant === 'vanilla') query.delete('variant');
  else query.set('variant', selection.variant);
  if (selection.page > 1) query.set('page', String(selection.page));
  else query.delete('page');
  if (options.country) {
    if (selection.country) query.set('country', selection.country);
    else query.delete('country');
  }
  const search = query.toString();
  return `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;
}

export function updateRankingSelection(
  change: Partial<RankingSelection>,
  options: RankingUrlOptions = {},
) {
  // Read the live URL so successive controls compose even before React has rendered.
  const query = new URLSearchParams(window.location.search);
  const next = { ...readRankingSelection(query, options), ...change };
  if (change.mode !== undefined || change.variant !== undefined || change.country !== undefined)
    next.page = 1;
  const validated = new URLSearchParams({
    mode: next.mode,
    variant: next.variant,
    page: String(next.page),
    country: next.country,
  });
  const url = writeSelection(query, readRankingSelection(validated, options), options);
  if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`)
    window.history.pushState(null, '', url);
}

export function correctRankingLocation(
  pathname: string,
  search: string,
  options: RankingUrlOptions,
  result?: {
    total: number;
    page: number;
    page_size: number;
    mode?: number;
    score_variant?: ScoreVariant;
  },
) {
  // A delayed result or effect from a previous partition must never rewrite a newer URL.
  if (
    window.location.pathname !== pathname ||
    new URLSearchParams(window.location.search).toString() !== search
  )
    return;
  const query = new URLSearchParams(search);
  const next = readRankingSelection(query, options);
  if (options.lockedMode !== undefined && query.has('mode') && query.get('mode') !== next.mode)
    next.page = 1;
  else if (
    result &&
    result.page === next.page &&
    result.page_size === 24 &&
    Number.isSafeInteger(result.total) &&
    result.total >= 0 &&
    (result.mode === undefined || String(result.mode) === next.mode) &&
    (result.score_variant === undefined || result.score_variant === next.variant)
  )
    next.page = Math.min(next.page, Math.max(1, Math.ceil(result.total / 24)));
  const url = writeSelection(query, next, options);
  if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`)
    window.history.replaceState(null, '', url);
}
