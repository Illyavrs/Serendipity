import { test, expect, type Page } from '@playwright/test';
import {
  canonicalBeatmapHref,
  canonicalScoreBeatmapHref,
  parseBeatmapsetRoute,
  parseBeatmapDifficultyHash,
  safeCatalogueReturn,
} from '../src/lib/beatmap-routes';
import { officialArchiveFilename } from '../src/lib/archive-download';

const setId = 2_000_000_050;
const nativeIds = [2_000_000_101, 2_000_000_102];
function localMap(index = 0) {
  return {
    id: 76001 + index,
    native_id: nativeIds[index],
    native_set_id: setId,
    official_id: null,
    official_set_id: null,
    source: 'local',
    mode: 0,
    title: 'Local canonical fixture',
    artist: 'Fixture artist',
    creator: 'Fixture mapper',
    version: index ? 'Hard' : 'Normal',
    status: 'ranked',
    stars: index ? 4 : 2,
    length_seconds: 90,
    bpm: 180,
    max_combo: 500,
    play_count: 0,
    uploaded_by: 990501,
    md5: String(index).repeat(32),
    download_url: `/api/v1/beatmaps/${76001 + index}/download`,
    download_kind: 'osz',
    package: {
      id: '00000000-0000-4000-8000-000000000050',
      native_set_id: setId,
      kind: 'osz',
      legacy: false,
      difficulty_count: 2,
      beatmap_ids: [76001, 76002],
      download_url: '/api/v1/beatmaps/76001/archive',
    },
    availability: { withdrawn: false, revision: 0, reason: null, changed_at: null },
  };
}
function officialSet() {
  return {
    official_set_id: 42,
    title: 'Official canonical fixture',
    artist: 'Fixture artist',
    creator: 'Fixture mapper',
    status: 'ranked',
    cover_url: 'https://assets.ppy.sh/beatmaps/42/covers/cover.jpg',
    official_url: 'https://osu.ppy.sh/beatmapsets/42',
    download_disabled: false,
    archive_download_available: true,
    archive_download_url: '/api/v1/official/beatmapsets/42/archive',
    difficulties: [0, 1, 2].map((index) => ({
      official_id: 4200 + index,
      local_id: 77001 + index,
      version: ['Normal', 'Hard', 'Taiko'][index],
      mode: index === 2 ? 1 : 0,
      stars: 2 + index,
      status: 'ranked',
      length_seconds: 90,
      checksum: 'a'.repeat(32),
      bpm: 180,
      ar: 9,
      cs: 4,
      od: 8,
      hp: 6,
      max_combo: 500,
    })),
    local: { stored_count: 3, archive_available: false, withdrawn: false },
  };
}

async function fixture(page: Page) {
  await page
    .context()
    .addCookies([
      { name: 'illya_locale', value: 'en', url: test.info().project.use.baseURL as string },
    ]);
  const state = {
    scores: [] as { mapId: number; mode: string | null; variant: string | null }[],
    resolvers: [] as URLSearchParams[],
    mutations: [] as string[],
    errors: [] as string[],
    withdrawn: false,
  };
  page.on('pageerror', (error) => state.errors.push(error.message));
  await page.route('https://assets.ppy.sh/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="160"><rect width="600" height="160" fill="#38333d"/></svg>',
    }),
  );
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const endpoint = url.pathname.replace('/api/v1', '');
    if (request.method() !== 'GET') {
      state.mutations.push(endpoint);
      return route.fulfill({ status: 405, json: {} });
    }
    if (endpoint === '/me')
      return route.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } });
    if (endpoint === '/official/beatmapsets/search')
      return route.fulfill({ json: { items: [officialSet()], total: 1, cursor_string: null } });
    if (endpoint === '/official/beatmapsets/42') return route.fulfill({ json: officialSet() });
    if (endpoint === `/beatmapsets/${setId}`) {
      state.resolvers.push(new URLSearchParams(url.searchParams));
      if (state.withdrawn)
        return route.fulfill({ status: 410, json: { error: { code: 'beatmapset_withdrawn' } } });
      const id = url.searchParams.get('difficulty');
      const index = id ? nativeIds.findIndex((value) => String(value) === id) : 0;
      return index < 0
        ? route.fulfill({ status: 404, json: { error: { code: 'not_found' } } })
        : route.fulfill({ json: localMap(index) });
    }
    const scores = /^\/beatmaps\/(\d+)\/scores$/.exec(endpoint);
    if (scores) {
      state.scores.push({
        mapId: Number(scores[1]),
        mode: url.searchParams.get('mode'),
        variant: url.searchParams.get('variant'),
      });
      return route.fulfill({
        json: {
          items: [],
          total: 0,
          page: Number(url.searchParams.get('page') ?? 1),
          page_size: 24,
          mode: Number(url.searchParams.get('mode') ?? 0),
          score_variant: url.searchParams.get('variant') ?? 'vanilla',
          ordered_by: 'pp',
        },
      });
    }
    const details = /^\/beatmaps\/(76001|76002)$/.exec(endpoint);
    if (details) return route.fulfill({ json: localMap(Number(details[1]) - 76001) });
    if (/^\/beatmaps\/(76001|76002)\/set\/difficulties$/.test(endpoint))
      return route.fulfill({
        json: { items: [localMap(0), localMap(1)], total: 2, page: 1, page_size: 24 },
      });
    return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });
  return state;
}

test('canonical helpers distinguish namespaces and preserve converted score mode', () => {
  expect(canonicalBeatmapHref(localMap(1))).toBe(`/beatmapsets/local-${setId}#osu/${nativeIds[1]}`);
  expect(
    canonicalBeatmapHref(
      { id: 8, source: 'official', official_set_id: 42, official_id: 4200, mode: 0 },
      { mode: '1', variant: 'relax', returnTo: '/beatmaps?q=private' },
    ),
  ).toBe('/beatmapsets/42?mode=1&variant=relax#osu/4200');
  expect(
    canonicalScoreBeatmapHref({
      beatmap_id: 8,
      native_beatmapset_id: 42,
      native_beatmap_id: 4200,
      beatmap_mode: 0,
      beatmap_source: 'official',
      mode: 1,
    }),
  ).toBe('/beatmapsets/42?mode=1#osu/4200');
  expect(
    canonicalScoreBeatmapHref({
      beatmap_id: 8,
      native_beatmapset_id: 42,
      native_beatmap_id: 4200,
      mode: 1,
    }),
  ).toBe('/beatmaps/8?mode=1');
  expect(parseBeatmapsetRoute('local-42')).toBeNull();
  expect(parseBeatmapsetRoute('2147483648')).toBeNull();
  expect(parseBeatmapDifficultyHash('#fruits/4200')).toEqual({ mode: 2, id: 4200 });
  expect(parseBeatmapDifficultyHash('#osu/9007199254740992')).toBeNull();
  expect(safeCatalogueReturn('//evil.invalid/beatmaps')).toBeNull();
  expect(safeCatalogueReturn('/admin?tab=beatmaps')).toBeNull();
});

test('archive blob filenames honor Unicode server disposition and reject path injection', () => {
  const set = { official_set_id: 42, artist: 'Yorushika', title: 'Song (TV Size)' };
  const filename = '42 ヨルシカ - 雲 (TV Size).osz';
  expect(
    officialArchiveFilename(
      new Response(null, {
        headers: {
          'content-disposition': `attachment; filename="fallback.osz"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        },
      }),
      set,
    ),
  ).toBe(filename);
  expect(
    officialArchiveFilename(
      new Response(null, {
        headers: { 'content-disposition': "attachment; filename*=UTF-8''..%2Fevil.osz" },
      }),
      set,
    ),
  ).toBe('42 Yorushika - Song (TV Size).osz');
});

test('official canonical deep link selects difficulty and back-forward restores selection', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/beatmapsets/42#osu/4201');
  await expect(page.locator('.public-official-selected h3')).toHaveText('Hard');
  await expect.poll(() => state.scores.at(-1)?.mapId).toBe(77002);
  await page.locator('.public-official-difficulty-list button').nth(0).click();
  await expect(page).toHaveURL(/\/beatmapsets\/42#osu\/4200$/);
  await expect(page.locator('.public-official-selected h3')).toHaveText('Normal');
  await page.goBack();
  await expect(page.locator('.public-official-selected h3')).toHaveText('Hard');
  await page.goForward();
  await expect(page.locator('.public-official-selected h3')).toHaveText('Normal');
  expect(state.errors).toEqual([]);
  expect(state.mutations).toEqual([]);
});

test('difficulty change updates leaderboard query and clears old conversion and pagination', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/beatmapsets/42?mode=2&variant=relax&page=9#osu/4200');
  await expect(page.locator('.public-official-selected h3')).toHaveText('Normal');
  await page.locator('.public-official-difficulty-list button').nth(2).click();
  await expect(page).toHaveURL(/\/beatmapsets\/42\?variant=relax#taiko\/4202$/);
  await expect
    .poll(() => state.scores.at(-1))
    .toEqual({ mapId: 77003, mode: '1', variant: 'relax' });
  expect(state.errors).toEqual([]);
});

test('catalogue filters live in tab state and survive detail reload without public returnTo', async ({
  page,
}) => {
  const state = await fixture(page);
  const catalogue = '/beatmaps?q=remember&mode=0&view=list';
  await page.goto(catalogue);
  const card = page.locator('.discovery-set-main').first();
  await expect(card).toHaveAttribute('href', '/beatmapsets/42#osu/4200');
  await card.click();
  await expect(page).toHaveURL(/\/beatmapsets\/42#osu\/4200$/);
  await expect(page.locator('.back-link')).toHaveAttribute('href', catalogue);
  await page.reload();
  await expect(page.locator('.back-link')).toHaveAttribute('href', catalogue);
  expect(new URL(page.url()).searchParams.has('returnTo')).toBe(false);
  expect(state.errors).toEqual([]);
});

test('legacy official redirect preserves hash and removes safe return query', async ({ page }) => {
  await fixture(page);
  await page.goto('/beatmaps/official/42?returnTo=%2Fbeatmaps%3Fq%3Dremember#taiko/4202');
  await expect(page).toHaveURL(/\/beatmapsets\/42#taiko\/4202$/);
  await expect(page.locator('.public-official-selected h3')).toHaveText('Taiko');
  await expect(page.locator('.back-link')).toHaveAttribute('href', '/beatmaps?q=remember');
});

test('local canonical deep links select native difficulty and keep old database routes working', async ({
  page,
}) => {
  const lifecycleWarnings: string[] = [];
  page.on('console', (message) => {
    if (/flushSync was called from inside a lifecycle/.test(message.text()))
      lifecycleWarnings.push(message.text());
  });
  const state = await fixture(page);
  await page.goto(`/beatmapsets/local-${setId}#osu/${nativeIds[1]}`);
  await expect(page.locator('.map-selected-name h2')).toHaveText('Hard');
  await expect.poll(() => state.scores.at(-1)?.mapId).toBe(76002);
  await expect(page.locator('.set-difficulty-strip a').first()).toHaveAttribute(
    'href',
    `/beatmapsets/local-${setId}#osu/${nativeIds[0]}`,
  );
  await page.locator('.set-difficulty-strip a').first().click();
  await expect(page.locator('.map-selected-name h2')).toHaveText('Normal');
  await page.goBack();
  await expect(page.locator('.map-selected-name h2')).toHaveText('Hard');
  await page.goto('/beatmaps/76001?variant=relax');
  await expect(page).toHaveURL(
    new RegExp(`/beatmapsets/local-${setId}\\?variant=relax#osu/${nativeIds[0]}$`),
  );
  await expect
    .poll(() => state.scores.at(-1))
    .toEqual({ mapId: 76001, mode: '0', variant: 'relax' });
  expect(state.errors).toEqual([]);
  expect(lifecycleWarnings).toEqual([]);
});

test('numeric native local alias preserves difficulty fragment', async ({ page }) => {
  await fixture(page);
  await page.goto(`/beatmapsets/${setId}#osu/${nativeIds[1]}`);
  await expect(page).toHaveURL(new RegExp(`/beatmapsets/local-${setId}#osu/${nativeIds[1]}$`));
  await expect(page.locator('.map-selected-name h2')).toHaveText('Hard');
});

test('withdrawn local canonical sets expose no score, archive or difficulty links', async ({
  page,
}) => {
  const state = await fixture(page);
  state.withdrawn = true;
  await page.goto(`/beatmapsets/local-${setId}#osu/${nativeIds[0]}`);
  await expect(
    page.locator('a[href*="/archive"], .beatmap-leaderboard, .set-difficulty-selector'),
  ).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'This beatmap set was withdrawn' })).toBeVisible();
  expect(state.scores).toEqual([]);
  expect(state.errors).toEqual([]);
});
