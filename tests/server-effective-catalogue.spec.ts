import { expect, test, type Page, type Route } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  EffectiveOfficialBeatmapset,
  ServerCatalogueSet,
} from '../src/lib/effective-map-catalogue';
import type { DiscoverySet } from '../src/features/map-discovery';
import { selectField } from './helpers/field-select';

// Synthetic source branches only. No imports, downloads, writes or live osu! API requests.
function official(id = 42, count = 12): EffectiveOfficialBeatmapset {
  return {
    official_set_id: id,
    title: id === 42 ? 'Server ranked metadata fixture' : `Official fixture ${id}`,
    artist: 'Synthetic artist 星の歌',
    creator: 'Fixture mapper',
    status: 'pending',
    official_status: 'graveyard',
    metadata_only: true,
    cover_url: `https://assets.ppy.sh/beatmaps/${id}/covers/card.jpg`,
    official_url: `https://osu.ppy.sh/beatmapsets/${id}`,
    download_disabled: true,
    difficulties: Array.from({ length: count }, (_, index) => ({
      official_id: id * 100 + index,
      version: `Difficulty ${index + 1}`,
      mode: index % 4,
      stars: 1.25 + index * 0.25,
      status: index === 0 ? 'ranked' : index === 1 ? 'wip' : 'graveyard',
      official_status: 'graveyard',
      length_seconds: 90 + index,
      archive_available: false,
      bpm: 180,
      ar: 9,
      cs: 4,
      od: 8,
      hp: 6,
      max_combo: 500,
    })),
    local: { stored_count: 0, archive_available: false, withdrawn: false },
  };
}

function stored(index = 0): DiscoverySet {
  const map = {
    id: 980000 + index,
    native_set_id: 2_010_000_000 + index,
    official_id: null,
    official_set_id: null,
    title: `Uploaded set fixture ${index}`,
    artist: 'Synthetic artist',
    creator: 'Fixture mapper',
    version: 'Normal',
    mode: 0,
    status: 'graveyard',
    source: 'local',
    stars: 2.25,
    length_seconds: 90,
    bpm: 180,
    max_combo: 400,
    play_count: 0,
    uploaded_by: 990501,
    md5: '0'.repeat(32),
    download_url: `/api/v1/beatmaps/${980000 + index}/download`,
    download_kind: 'osu' as const,
    package: null,
  };
  return {
    native_set_id: map.native_set_id,
    representative: map,
    matching_count: 1,
    stored_count: 1,
    matching_modes: [0],
    matching_statuses: ['graveyard'],
    stars_min: 2.25,
    stars_max: 2.25,
    length_min: 90,
    length_max: 90,
    added_at: '2026-10-09T00:00:00Z',
    preview: [map],
  };
}

async function fixture(page: Page, locale = 'en', theme = 'dark') {
  await page
    .context()
    .addCookies([
      { name: 'illya_locale', value: locale, url: test.info().project.use.baseURL as string },
    ]);
  await page.addInitScript(
    ({ locale, theme }) =>
      localStorage.setItem(
        'illya_appearance',
        JSON.stringify({
          locale,
          mode: theme,
          accent_color: '#f28eb6',
          background_url: null,
          background_blur: 0,
          background_dim: 0.76,
          panel_blur: 8,
          panel_opacity: 0.55,
          border_radius: 14,
          glass_level: 100,
        }),
      ),
    { locale, theme },
  );
  const state = {
    items: [
      { kind: 'official_metadata', official: official() },
      ...Array.from({ length: 25 }, (_, index) => ({ kind: 'stored', stored: stored(index) })),
    ] as ServerCatalogueSet[],
    queries: [] as URLSearchParams[],
    officialQueries: [] as URLSearchParams[],
    oldFeedQueries: [] as URLSearchParams[],
    details: [] as number[],
    mutations: [] as string[],
    previewRequests: 0,
    failures: 0,
    holdQuery: null as string | null,
    releases: [] as (() => void)[],
    settled: [] as string[],
  };
  await page.route('https://assets.ppy.sh/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="160"><rect width="600" height="160" fill="#38333d"/></svg>',
    }),
  );
  const fail = (route: Route, status: number, code: string) =>
    route.fulfill({ status, json: { error: { code } } });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const endpoint = url.pathname.slice('/api/v1'.length);
    const query = url.searchParams;
    if (request.method() !== 'GET') {
      state.mutations.push(endpoint);
      throw new Error(`Unexpected fixture mutation: ${endpoint}`);
    }
    if (endpoint === '/me') return fail(route, 401, 'unauthorized');
    if (endpoint === '/server/beatmapsets') {
      state.queries.push(new URLSearchParams(query));
      const search = query.get('q') ?? '';
      const items = state.items.filter((item) => {
        const metadata = item.kind === 'official_metadata';
        if (query.get('source') && query.get('source') !== (metadata ? 'official' : 'local'))
          return false;
        if (metadata && (query.has('uploaded_by') || query.get('uploaded_only') === 'true'))
          return false;
        const record = metadata ? item.official : item.stored.representative;
        if (search && !`${record.title} ${record.artist} ${record.creator}`.includes(search))
          return false;
        const diffs = metadata ? item.official.difficulties : item.stored.preview;
        return diffs.some(
          (diff) =>
            (!query.has('mode') || String(diff.mode) === query.get('mode')) &&
            (!query.has('status') || diff.status === query.get('status')),
        );
      });
      if (search === state.holdQuery)
        await new Promise<void>((resolve) => state.releases.push(resolve));
      state.settled.push(search);
      if (state.failures > 0) {
        state.failures--;
        return fail(route, 503, 'service_unavailable');
      }
      const pageNumber = Number(query.get('page') ?? 1);
      return route
        .fulfill({
          json: {
            items: items.slice((pageNumber - 1) * 24, pageNumber * 24),
            total: items.length,
            page: pageNumber,
            page_size: 24,
          },
        })
        .catch(() => {});
    }
    if (endpoint === '/official/beatmapsets/search') {
      state.officialQueries.push(new URLSearchParams(query));
      return route.fulfill({ json: { items: [], total: 0, cursor_string: null } });
    }
    if (/^\/official\/beatmapsets\/\d+$/.test(endpoint)) {
      const id = Number(endpoint.split('/').at(-1));
      state.details.push(id);
      const item = state.items.find(
        (item) => item.kind === 'official_metadata' && item.official.official_set_id === id,
      );
      return item?.kind === 'official_metadata'
        ? route.fulfill({ json: item.official })
        : fail(route, 404, 'not_found');
    }
    if (/^\/beatmaps\/\d+\/set\/preview$/.test(endpoint)) {
      state.previewRequests++;
      const mapId = Number(endpoint.split('/')[2]);
      const item = state.items.find(
        (item) => item.kind === 'stored' && item.stored.representative.id === mapId,
      );
      return item?.kind === 'stored'
        ? route.fulfill({
            json: { items: item.stored.preview, total: 1, stored_count: 1 },
          })
        : fail(route, 404, 'not_found');
    }
    if (endpoint === '/beatmapsets') {
      state.oldFeedQueries.push(new URLSearchParams(query));
      return route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 3 } });
    }
    if (endpoint === '/status')
      return route.fulfill({
        json: {
          players_online: 0,
          registered_players: 0,
          ranked_scores: 0,
          beatmap_count: 0,
          compatibility: {},
        },
      });
    if (['/announcements', '/leaderboard', '/scores'].includes(endpoint))
      return route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 5 } });
    return fail(route, 404, 'not_found');
  });
  return state;
}

test('server catalogue joins stored uploads and ranked metadata with an exact finite total', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/beatmaps?catalogue=server');
  await expect(page.locator('.discovery-set')).toHaveCount(24);
  await expect(page.locator('.discovery-result-count')).toContainText('26');
  await expect(page.locator('.discovery-result-count')).toContainText('1–24');
  expect(state.queries[0].get('page_size')).toBe('24');
  expect(state.officialQueries).toHaveLength(0);
  expect(state.oldFeedQueries).toHaveLength(0);
  const metadata = page.locator('[data-catalogue-kind="official-metadata"]');
  await expect(metadata).toHaveCount(1);
  await expect(metadata.locator('.status-pending')).toHaveText('Pending');
  await expect(metadata).toContainText('Mixed statuses');
  await expect(metadata).toContainText('Metadata only');
  await expect(metadata.locator('.discovery-set-main')).toHaveAttribute(
    'href',
    `/beatmaps/official/42?returnTo=${encodeURIComponent('/beatmaps?catalogue=server')}`,
  );
  await expect(
    metadata.locator('a[href*="/api/"], a[href$=".osu"], a[href*="/archive"]'),
  ).toHaveCount(0);
  expect(state.mutations).toHaveLength(0);
});

test('all difficulty statuses and stars are passive, complete and do not import content', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/beatmaps?catalogue=server&status=ranked&source=official');
  await expect(page.locator('.discovery-set')).toHaveCount(1);
  await expect(page.locator('.discovery-set .status-ranked')).toHaveText('Ranked');
  await page.locator('.discovery-difficulty-trigger').focus();
  await page.keyboard.press('Enter');
  const popup = page.locator('.discovery-difficulty-popover');
  await expect(popup.locator('.difficulty-preview-row')).toHaveCount(12);
  await expect(
    popup.locator('.difficulty-preview-row').first().locator('.status-ranked'),
  ).toHaveText('Ranked');
  await expect(popup.locator('.difficulty-preview-row').nth(1).locator('.status-wip')).toHaveText(
    'Work in progress',
  );
  await expect(popup.getByText('Difficulty 12', { exact: true })).toBeAttached();
  await expect(popup.locator('a')).toHaveCount(0);
  expect(state.previewRequests).toBe(0);
  expect(state.details).toHaveLength(0);
  expect(state.mutations).toHaveLength(0);
});

test('metadata route retains catalogue filters and cannot offer a fabricated server score link', async ({
  page,
}) => {
  const state = await fixture(page);
  const returnTo = '/beatmaps?catalogue=server&status=ranked&source=official&view=list';
  await page.goto(returnTo);
  await page.locator('.discovery-set-main').click();
  await expect(page).toHaveURL(/\/beatmaps\/official\/42\?returnTo=/);
  await expect(page.locator('.public-official-selected .status-ranked')).toHaveText('Ranked');
  await expect(page.locator('.public-official-selected a[href^="/beatmaps/"]')).toHaveCount(0);
  await expect(page.locator('.public-official-title a[href*="/archive"]')).toHaveCount(0);
  await expect(
    page.locator('.public-official-title').getByRole('button', { name: /Download/ }),
  ).toBeDisabled();
  await page.locator('.back-link').click();
  await expect(page).toHaveURL(new RegExp(`${returnTo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  expect(state.details.length).toBeGreaterThan(0);
  expect(state.details.every((id) => id === 42)).toBe(true);
  expect(state.mutations).toHaveLength(0);
});

test('partial imported sets retain the official route and exactly one catalogue entry', async ({
  page,
}) => {
  const state = await fixture(page);
  const item = state.items[0];
  if (item.kind !== 'official_metadata') throw new Error('Fixture branch missing');
  item.official.metadata_only = false;
  item.official.local.stored_count = 1;
  item.official.difficulties[1].local_id = 987654;
  await page.goto('/beatmaps?catalogue=server&source=official&status=ranked');
  await expect(page.locator('.discovery-set')).toHaveCount(1);
  await expect(page.locator('.discovery-set')).not.toContainText('Metadata only');
  await expect(page.locator('.discovery-set-main')).toHaveAttribute(
    'href',
    /\/beatmaps\/official\/42/,
  );
  expect(state.previewRequests).toBe(0);
});

test('legacy unranked decisions stay visible as supplied instead of becoming pending', async ({
  page,
}) => {
  const state = await fixture(page);
  const item = state.items[0];
  if (item.kind !== 'official_metadata') throw new Error('Fixture branch missing');
  item.official.status = 'unranked';
  item.official.difficulties.forEach((difficulty) => {
    difficulty.status = 'unranked';
  });
  await page.goto('/beatmaps?catalogue=server&source=official&status=unranked');
  await expect(page.locator('.discovery-set')).toHaveCount(1);
  await expect(page.locator('.discovery-set .status-unranked')).toHaveText('Unranked');
  await page.locator('.discovery-difficulty-trigger').click();
  await expect(page.locator('.difficulty-preview-row .status-unranked')).toHaveCount(12);
  await expect(page.locator('.difficulty-preview-row .status-pending')).toHaveCount(0);
  expect(state.queries.at(-1)?.get('status')).toBe('unranked');
});

test('filters combine mode and effective status on the server route and keep URL history', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/beatmaps?catalogue=server&context=profile&cursor=upstream-only#maps');
  await expect(page.locator('.discovery-set')).toHaveCount(24);
  expect(state.queries[0].has('cursor')).toBe(false);
  await selectField(page.locator('#discovery-source'), 'official');
  await selectField(page.locator('#discovery-status'), 'ranked');
  await selectField(page.locator('#discovery-mode'), '1');
  await expect(page.locator('.discovery-set')).toHaveCount(0);
  expect(state.queries.at(-1)?.get('status')).toBe('ranked');
  expect(state.queries.at(-1)?.get('mode')).toBe('1');
  expect(state.queries.at(-1)?.get('source')).toBe('official');
  await page.goBack();
  await expect(page.locator('.discovery-set')).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get('context')).toBe('profile');
  expect(new URL(page.url()).hash).toBe('#maps');
});

test('finite pagination counts metadata entries once and remains reversible in browser history', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/beatmaps?catalogue=server&view=list');
  await expect(page.locator('.discovery-set')).toHaveCount(24);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.discovery-set')).toHaveCount(2);
  await expect(page.locator('.discovery-result-count')).toContainText('25–26');
  expect(state.queries.at(-1)?.get('page')).toBe('2');
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await page.goBack();
  await expect(page.locator('.discovery-set')).toHaveCount(24);
  await expect(page.locator('.discovery-results')).toHaveClass(/view-list/);
  expect(state.queries.at(-1)?.get('page')).toBe('1');
});

test('late search responses cannot resurrect stale metadata after filters change', async ({
  page,
}) => {
  const state = await fixture(page);
  state.holdQuery = 'metadata';
  await page.goto('/beatmaps?catalogue=server&q=metadata');
  await expect.poll(() => state.releases.length).toBeGreaterThan(0);
  await page.locator('.discovery-search input').fill('Uploaded');
  await page
    .locator('.discovery-search')
    .getByRole('button', { name: 'Search', exact: true })
    .click();
  await expect(page.locator('.discovery-set')).toHaveCount(24);
  state.releases.forEach((release) => release());
  await expect.poll(() => state.settled.includes('metadata')).toBe(true);
  await expect(page.locator('[data-catalogue-kind="official-metadata"]')).toHaveCount(0);
  await expect(page.locator('.discovery-result-count')).toContainText('25');
});

test('server errors retry the same finite catalogue without replacing the source with official search', async ({
  page,
}) => {
  const state = await fixture(page);
  state.failures = Number.POSITIVE_INFINITY;
  await page.goto('/beatmaps?catalogue=server&status=ranked');
  await expect(page.locator('.discovery-feedback[role="alert"]')).toBeVisible();
  const failedRequests = state.queries.length;
  state.failures = 0;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('.discovery-set')).toHaveCount(1);
  expect(state.queries.length).toBeGreaterThan(failedRequests);
  expect(state.queries.every((query) => query.get('status') === 'ranked')).toBe(true);
  expect(state.officialQueries).toHaveLength(0);
});

test('uploaded-only and uploader scopes exclude metadata without changing the home feed', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/beatmaps?catalogue=server&source=local&uploaded_only=true&uploaded_by=990501');
  await expect(page.locator('.discovery-set')).toHaveCount(24);
  await expect(page.locator('[data-catalogue-kind="official-metadata"]')).toHaveCount(0);
  expect(state.queries[0].get('uploaded_only')).toBe('true');
  expect(state.queries[0].get('uploaded_by')).toBe('990501');
  const catalogueRequests = state.queries.length;
  await page.goto('/');
  await expect.poll(() => state.oldFeedQueries.length).toBeGreaterThan(0);
  expect(Object.fromEntries(state.oldFeedQueries[0])).toEqual({
    source: 'local',
    uploaded_only: 'true',
    sort: 'recent',
    page_size: '3',
  });
  expect(state.queries).toHaveLength(catalogueRequests);
});

test('default beatmap catalogue still uses the original official search', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/beatmaps');
  await expect.poll(() => state.officialQueries.length).toBeGreaterThan(0);
  expect(state.officialQueries.every((query) => query.get('status') === 'ranked')).toBe(true);
  expect(state.queries).toHaveLength(0);
  expect(state.oldFeedQueries).toHaveLength(0);
});

for (const scenario of [
  { width: 1440, locale: 'en', theme: 'dark' },
  { width: 390, locale: 'zh-TW', theme: 'dark' },
  { width: 320, locale: 'ja', theme: 'light' },
]) {
  test(`metadata and stored cards retain compact equal heights at ${scenario.width}px ${scenario.locale}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: scenario.width, height: 900 });
    const state = await fixture(page, scenario.locale, scenario.theme);
    state.items = state.items.slice(0, 2);
    for (const view of ['grid', 'list']) {
      await page.goto(`/beatmaps?catalogue=server&view=${view}`);
      await expect(page.locator('.discovery-set')).toHaveCount(2);
      await expect(page.locator('html')).toHaveClass(new RegExp(scenario.theme));
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.locator('.discovery-set').evaluateAll((cards) =>
        cards.map((card) => {
          const box = card.getBoundingClientRect();
          return { height: box.height, width: box.width, right: box.right };
        }),
      );
      expect(Math.abs(geometry[0].height - geometry[1].height)).toBeLessThanOrEqual(1);
      expect(geometry.every((card) => card.height <= (scenario.width <= 600 ? 112 : 124))).toBe(
        true,
      );
      expect(geometry.every((card) => card.right <= scenario.width)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const captureRoot = process.env.ILLYA_SERVER_CATALOGUE_CAPTURE_ROOT;
      if (captureRoot && view === 'grid') {
        await mkdir(captureRoot, { recursive: true });
        for (const stage of ['catalogue', 'preview']) {
          if (stage === 'preview') {
            await page.locator('.discovery-difficulty-trigger').first().click();
            await expect(page.locator('.difficulty-preview-row')).toHaveCount(12);
          }
          const name = `server-effective-${scenario.width}-${scenario.locale}-${scenario.theme}-${stage}`;
          const pixels = await page.screenshot({
            path: path.join(captureRoot, `${name}.png`),
            fullPage: true,
            animations: 'disabled',
          });
          await writeFile(
            path.join(captureRoot, `${name}.json`),
            JSON.stringify(
              {
                captured_at: new Date().toISOString(),
                synthetic: true,
                viewport: { width: scenario.width, height: 900 },
                route: new URL(page.url()).pathname + new URL(page.url()).search,
                locale: scenario.locale,
                theme: scenario.theme,
                actual_theme: await page.locator('html').getAttribute('class'),
                stage,
                screenshot_sha256: createHash('sha256').update(pixels).digest('hex'),
                cards: geometry,
              },
              null,
              2,
            ),
          );
        }
      }
    }
  });
}
