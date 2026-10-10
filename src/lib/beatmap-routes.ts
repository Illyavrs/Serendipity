import type { ScoreVariant } from './types';

export const beatmapModeSlugs = ['osu', 'taiko', 'fruits', 'mania'] as const;
export const LOCAL_BEATMAP_ID_MIN = 2_000_000_000;
export const MAX_BEATMAP_ID = 2_147_483_647;

function validId(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_BEATMAP_ID
  );
}

export function parseBeatmapsetRoute(value: string) {
  const local = value.startsWith('local-');
  const raw = local ? value.slice(6) : value;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  if (!validId(id) || (local && id < LOCAL_BEATMAP_ID_MIN)) return null;
  return { id, local: local || id >= LOCAL_BEATMAP_ID_MIN };
}

export function beatmapsetPath(setId: number, source: string = 'official') {
  return `/beatmapsets/${source === 'local' ? 'local-' : ''}${setId}`;
}

export function beatmapDifficultyHash(mode: number, nativeId: number) {
  return validId(nativeId) && beatmapModeSlugs[mode]
    ? `#${beatmapModeSlugs[mode]}/${nativeId}`
    : '';
}

export function parseBeatmapDifficultyHash(hash: string) {
  const match = /^#(osu|taiko|fruits|mania)(?:\/([1-9]\d*))?$/.exec(hash);
  if (!match) return null;
  const mode = beatmapModeSlugs.indexOf(match[1] as (typeof beatmapModeSlugs)[number]);
  const id = match[2] ? Number(match[2]) : null;
  return id !== null && !validId(id) ? null : { mode, id };
}

export type BeatmapRouteIdentity = {
  id: number;
  source?: string;
  mode: number;
  native_id?: number;
  native_set_id?: number;
  official_id?: number | null;
  official_set_id?: number | null;
  package?: { native_set_id: number } | null;
};

export type BeatmapNavigation = {
  returnTo?: string | null;
  mode?: string;
  variant?: ScoreVariant;
  management?: boolean;
};

/** Database map IDs stay on API/admin routes; public links use native set/difficulty identity. */
export function canonicalBeatmapHref(
  map: BeatmapRouteIdentity,
  navigation: BeatmapNavigation = {},
) {
  const query = new URLSearchParams();
  if (navigation.mode !== undefined || navigation.variant !== undefined) {
    const mode =
      map.mode === 0 && /^[0-3]$/.test(navigation.mode ?? '') ? navigation.mode! : String(map.mode);
    if (mode !== String(map.mode)) query.set('mode', mode);
    if (mode !== '3' && navigation.variant === 'relax') query.set('variant', 'relax');
  }
  if (navigation.management) {
    query.set('management', '1');
    if (navigation.returnTo) query.set('returnTo', navigation.returnTo);
    return `/beatmaps/${map.id}?${query}`;
  }
  const setId = map.official_set_id ?? map.native_set_id ?? map.package?.native_set_id;
  const nativeId = map.official_id ?? map.native_id;
  const suffix = query.size ? `?${query}` : '';
  // Older DTOs are resolved by the compatibility page rather than fabricating native IDs.
  if (!validId(setId) || !validId(nativeId)) return `/beatmaps/${map.id}${suffix}`;
  const source = map.source === 'local' || setId >= LOCAL_BEATMAP_ID_MIN ? 'local' : 'official';
  return `${beatmapsetPath(setId, source)}${suffix}${beatmapDifficultyHash(map.mode, nativeId)}`;
}

export function canonicalScoreBeatmapHref(score: {
  beatmap_id: number;
  beatmapset_id?: number | null;
  native_beatmapset_id?: number | null;
  native_beatmap_id?: number | null;
  beatmap_source?: string | null;
  beatmap_mode?: number | null;
  mode: number;
  score_variant?: ScoreVariant;
}) {
  if (
    !Number.isInteger(score.beatmap_mode) ||
    Number(score.beatmap_mode) < 0 ||
    Number(score.beatmap_mode) > 3
  ) {
    const query = new URLSearchParams({ mode: String(score.mode) });
    if (score.mode !== 3 && score.score_variant === 'relax') query.set('variant', 'relax');
    return `/beatmaps/${score.beatmap_id}?${query}`;
  }
  return canonicalBeatmapHref(
    {
      id: score.beatmap_id,
      source: score.beatmap_source ?? undefined,
      native_set_id: score.native_beatmapset_id ?? score.beatmapset_id ?? undefined,
      native_id: score.native_beatmap_id ?? undefined,
      mode: score.beatmap_mode ?? score.mode,
    },
    { mode: String(score.mode), variant: score.score_variant },
  );
}

export function safeCatalogueReturn(value: string | null) {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    new TextEncoder().encode(value).length > 2048
  )
    return null;
  try {
    const url = new URL(value, 'https://illya.invalid');
    const result = `${url.pathname}${url.search}`;
    return url.origin === 'https://illya.invalid' &&
      url.pathname === '/beatmaps' &&
      new TextEncoder().encode(result).length <= 2048
      ? result
      : null;
  } catch {
    return null;
  }
}

const catalogueReturns = new Map<string, string>();
const storageKey = 'illyaverse:map-catalogue-return';

/** A return filter is tab navigation state, never part of a public/shareable map URL. */
export function rememberCatalogueReturn(href: string, returnTo: string | null | undefined) {
  const safe = safeCatalogueReturn(returnTo ?? null);
  if (!safe || typeof window === 'undefined') return;
  const path = new URL(href, window.location.origin).pathname;
  if (!path.startsWith('/beatmapsets/')) return;
  catalogueReturns.set(path, safe);
  if (catalogueReturns.size > 100) catalogueReturns.delete(catalogueReturns.keys().next().value!);
  try {
    sessionStorage.setItem(storageKey, JSON.stringify({ path, returnTo: safe }));
  } catch {
    /* Navigation still works with storage disabled. */
  }
  window.dispatchEvent(new Event('illyaverse:map-catalogue-return'));
}

export function readCatalogueReturn(path: string) {
  const current = catalogueReturns.get(path);
  if (current) return current;
  if (typeof window === 'undefined') return null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
    return saved?.path === path && typeof saved?.returnTo === 'string'
      ? safeCatalogueReturn(saved.returnTo)
      : null;
  } catch {
    return null;
  }
}
