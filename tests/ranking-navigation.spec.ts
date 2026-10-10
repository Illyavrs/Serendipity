import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

// All requests below are intercepted synthetic data. These tests prove browser navigation,
// not public rankings, database policy, score acceptance, or native game connectivity.
const mapId = 998801;
const stamp = '2026-10-09T00:00:00Z';
type Partition = { mode: string; variant: string; country: string; page: number };
type Observed = Partition & { board: boolean };
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function map(mode: number) {
  return {
    id: mapId,
    native_set_id: 998802,
    title: 'Synthetic navigation map',
    artist: 'Fixture artist',
    creator: 'Fixture mapper',
    version: 'Fixture difficulty',
    mode,
    status: 'ranked',
    source: 'local',
    stars: 4.25,
    length_seconds: 90,
    bpm: 180,
    max_combo: 200,
    play_count: 74,
    md5: '0'.repeat(32),
    official_id: null,
    download_url: `/api/v1/beatmaps/${mapId}/download`,
    download_kind: 'osu',
    package: null,
  };
}
function leader(index: number, selection: Partition) {
  return {
    id: 998900 + index,
    username: `Rank fixture ${selection.country || 'global'} ${selection.mode} ${selection.variant} ${index}`,
    country: selection.country || 'TW',
    avatar_url: null,
    pp: 1000 - index,
    rank: index,
    play_count: 42,
    accuracy: 98.5,
  };
}
function score(index: number, selection: Partition) {
  return {
    id: 999100 + index,
    user_id: 998900 + index,
    username: `Board fixture ${selection.mode} ${selection.variant} ${index}`,
    beatmap_id: mapId,
    title: 'Synthetic navigation map',
    version: 'Fixture difficulty',
    mode: Number(selection.mode),
    score_variant: selection.variant,
    score: 900000,
    standardised_score: selection.variant === 'relax' ? null : 900000,
    score_scale_status: selection.variant === 'relax' ? 'unavailable' : 'native_reported',
    accuracy: 98.5,
    max_combo: 190,
    mods: selection.variant === 'relax' ? 128 : 0,
    pp: 1000 - index,
    passed: true,
    verification: 'verified',
    created_at: stamp,
    has_replay: false,
    position: index,
  };
}
async function fixture(page: Page, mapMode = 0) {
  await page
    .context()
    .addCookies([
      { name: 'illya_locale', value: 'en', url: test.info().project.use.baseURL as string },
    ]);
  const state = {
    total: 74,
    fail: false,
    failFromPage: 0,
    queries: [] as Observed[],
    delay: null as
      null | (ReturnType<typeof deferred> & { board: boolean; variant: string; page: number }),
  };
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.replace('/api/v1', '');
    if (endpoint === '/me')
      return route.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } });
    if (endpoint === `/beatmaps/${mapId}`) return route.fulfill({ json: map(mapMode) });
    if (endpoint === `/beatmaps/${mapId}/set/difficulties`)
      return route.fulfill({ json: { items: [map(mapMode)], total: 1, page: 1, page_size: 24 } });
    const board = endpoint === `/beatmaps/${mapId}/scores`;
    if (endpoint === '/leaderboard' || board) {
      const selection = {
        mode: url.searchParams.get('mode') ?? '0',
        variant: url.searchParams.get('variant') ?? 'vanilla',
        country: url.searchParams.get('country') ?? '',
        page: Number(url.searchParams.get('page') ?? '1'),
      };
      const total = state.total;
      const fail = state.fail || (state.failFromPage > 0 && selection.page >= state.failFromPage);
      state.queries.push({ ...selection, board });
      if (
        state.delay &&
        state.delay.board === board &&
        state.delay.variant === selection.variant &&
        state.delay.page === selection.page
      )
        await state.delay.promise;
      if (fail)
        return route.fulfill({ status: 503, json: { error: { code: 'fixture_unavailable' } } });
      const start = (selection.page - 1) * 24;
      const count = Math.max(0, Math.min(24, total - start));
      return route.fulfill({
        json: {
          items: Array.from({ length: count }, (_, offset) =>
            board ? score(start + offset + 1, selection) : leader(start + offset + 1, selection),
          ),
          total,
          page: selection.page,
          page_size: 24,
          mode: Number(selection.mode),
          score_variant: selection.variant,
          ...(board
            ? { ordered_by: selection.variant === 'relax' ? 'pp' : 'standardised_score' }
            : {}),
        },
      });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'synthetic_fixture_missing' } } });
  });
  return state;
}
function record(name: string) {
  return new RegExp(`${name}$`);
}
async function query(page: Page, expected: Record<string, string | null>, hash?: string) {
  await expect
    .poll(() => {
      const url = new URL(page.url());
      return Object.fromEntries(
        Object.keys(expected).map((key) => [key, url.searchParams.get(key)]),
      );
    })
    .toEqual(expected);
  if (hash !== undefined) expect(new URL(page.url()).hash).toBe(hash);
}
function rows(page: Page, board: boolean) {
  return page.locator(board ? '.beatmap-leaderboard' : '.rankings-page');
}
async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((board) => {
    document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
    const target = board ? document.querySelector('.beatmap-leaderboard') : null;
    const top = target ? target.getBoundingClientRect().top + scrollY - 80 : 0;
    window.scrollTo({ top, behavior: 'instant' });
  }, name.startsWith('map-'));
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  if (process.env.ILLYA_RANKING_CAPTURE_DIR)
    await page.screenshot({
      path: path.join(process.env.ILLYA_RANKING_CAPTURE_DIR, `${name}.png`),
      fullPage: false,
      animations: 'disabled',
    });
}

test('player deep links apply country, page and RX partition while preserving other query and hash', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(
    '/rankings?country=tw&page=2&mode=1&variant=relax&campaign=fixture%20note#rankings',
  );
  const panel = rows(page, false);
  await expect(panel.getByText(record('Rank fixture TW 1 relax 25'))).toBeVisible();
  await expect(panel.getByRole('combobox', { name: 'Country', exact: true })).toHaveAttribute(
    'data-value',
    'TW',
  );
  await expect(panel.getByRole('button', { name: 'taiko', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(panel.getByRole('button', { name: 'Relax (RX)', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await query(
    page,
    { country: 'TW', page: '2', mode: '1', variant: 'relax', campaign: 'fixture note' },
    '#rankings',
  );
  expect(state.queries.every((request) => request.country === 'TW' && request.page === 2)).toBe(
    true,
  );
  await capture(page, 'player-desktop-deeplink');
});

test('player pagination and country selection restore with Back and Forward', async ({ page }) => {
  await fixture(page);
  await page.goto('/rankings?country=TW&page=2&mode=0&variant=vanilla&campaign=history#rankings');
  const panel = rows(page, false);
  await expect(panel.getByText(record('Rank fixture TW 0 vanilla 25'))).toBeVisible();
  await panel.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(panel.getByText(record('Rank fixture TW 0 vanilla 49'))).toBeVisible();
  await panel.getByRole('combobox', { name: 'Country', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search countries', exact: true }).fill('Japan');
  await page.getByRole('option', { name: 'Japan', exact: true }).click();
  await expect(panel.getByText(record('Rank fixture JP 0 vanilla 1'))).toBeVisible();
  await query(page, { country: 'JP', page: null, campaign: 'history' }, '#rankings');
  await page.goBack();
  await expect(panel.getByText(record('Rank fixture TW 0 vanilla 49'))).toBeVisible();
  await expect(panel.getByRole('combobox', { name: 'Country', exact: true })).toHaveAttribute(
    'data-value',
    'TW',
  );
  await page.goBack();
  await expect(panel.getByText(record('Rank fixture TW 0 vanilla 25'))).toBeVisible();
  await page.goForward();
  await expect(panel.getByText(record('Rank fixture TW 0 vanilla 49'))).toBeVisible();
  await page.goForward();
  await expect(panel.getByText(record('Rank fixture JP 0 vanilla 1'))).toBeVisible();
});

test('player partition filters reset page, preserve country, and disable mania RX', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/rankings?country=TW&page=3&mode=0&variant=vanilla&campaign=filters#rankings');
  const panel = rows(page, false);
  await expect(panel.getByText(record('Rank fixture TW 0 vanilla 49'))).toBeVisible();
  await panel.getByRole('button', { name: 'Relax (RX)', exact: true }).click();
  await expect(panel.getByText(record('Rank fixture TW 0 relax 1'))).toBeVisible();
  await panel.getByRole('button', { name: 'Next', exact: true }).click();
  await panel.getByRole('button', { name: 'mania', exact: true }).click();
  await expect(panel.getByText(record('Rank fixture TW 3 vanilla 1'))).toBeVisible();
  await query(
    page,
    { country: 'TW', page: null, mode: '3', variant: 'vanilla', campaign: 'filters' },
    '#rankings',
  );
  await expect(panel.getByRole('button', { name: 'Relax (RX)', exact: true })).toBeDisabled();
});

test('invalid player URL fields normalize to safe defaults without dropping encoded unrelated values', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(
    '/rankings?country=%3Cscript%3E&page=9007199254740993&mode=99&variant=unknown&note=fixture%20%7enote#kept',
  );
  await expect(
    rows(page, false).getByText(record('Rank fixture global 0 vanilla 1')),
  ).toBeVisible();
  await query(
    page,
    { country: null, page: null, mode: '0', variant: 'vanilla', note: 'fixture ~note' },
    '#kept',
  );
  expect(
    state.queries.every(
      (request) =>
        request.country === '' &&
        request.page === 1 &&
        request.mode === '0' &&
        request.variant === 'vanilla',
    ),
  ).toBe(true);
});

test('country search keeps the current filter until selecting a country and All resets page', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/rankings?country=TW&page=2&mode=0&variant=vanilla#rankings');
  const panel = rows(page, false);
  const trigger = panel.getByRole('combobox', { name: 'Country', exact: true });
  await expect(panel.getByText(record('Rank fixture TW 0 vanilla 25'))).toBeVisible();
  await trigger.click();
  const input = page.getByRole('combobox', { name: 'Search countries', exact: true });
  await input.fill('j');
  await expect(input).toHaveValue('j');
  await query(page, { country: 'TW', page: '2' });
  await input.pressSequentially('p');
  await input.press('Enter');
  await expect(trigger).toHaveAttribute('data-value', 'JP');
  await expect(panel.getByText(record('Rank fixture JP 0 vanilla 1'))).toBeVisible();
  await trigger.click();
  await page.getByRole('option', { name: 'All countries', exact: true }).click();
  await expect(panel.getByText(record('Rank fixture global 0 vanilla 1'))).toBeVisible();
  await query(page, { country: null, page: null }, '#rankings');
  expect(
    state.queries.every((request) => !request.country || /^[A-Z]{2}$/.test(request.country)),
  ).toBe(true);
});

test('invalid map-board URL fields are safe while unrelated country and encoded return target survive', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(
    `/beatmaps/${mapId}?page=-2&mode=broken&variant=unknown&country=tw&returnTo=%2Fbeatmaps%3Fq%3Dfixture%20note#board`,
  );
  await expect(rows(page, true).getByText(record('Board fixture 0 vanilla 1'))).toBeVisible();
  await query(
    page,
    {
      page: null,
      mode: '0',
      variant: 'vanilla',
      country: 'tw',
      returnTo: '/beatmaps?q=fixture note',
    },
    '#board',
  );
  expect(
    state.queries
      .filter((request) => request.board)
      .every(
        (request) => request.page === 1 && request.mode === '0' && request.variant === 'vanilla',
      ),
  ).toBe(true);
});

for (const board of [false, true]) {
  const subject = board ? 'map board' : 'player rankings';
  const route = board ? `/beatmaps/${mapId}` : '/rankings';
  test(`${subject} clamp a successfully shrinking total and replace the existing history entry`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await page.goto(`${route}?page=3&mode=0&variant=vanilla&campaign=shrink#kept`);
    const panel = rows(page, board);
    await expect(
      panel.getByText(
        record(board ? 'Board fixture 0 vanilla 49' : 'Rank fixture global 0 vanilla 49'),
      ),
    ).toBeVisible();
    const historyLength = await page.evaluate(() => history.length);
    state.total = 25;
    await page.reload();
    await expect(
      panel.getByText(
        record(board ? 'Board fixture 0 vanilla 25' : 'Rank fixture global 0 vanilla 25'),
      ),
    ).toBeVisible();
    await query(page, { page: '2', campaign: 'shrink' }, '#kept');
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    state.total = 0;
    await page.reload();
    await query(page, { page: null, campaign: 'shrink' }, '#kept');
    await expect(panel.locator('tbody tr')).toHaveCount(0);
  });

  test(`${subject} retain first and previous page recovery when high-page requests fail`, async ({
    page,
  }) => {
    const state = await fixture(page);
    state.failFromPage = 5;
    await page.goto(`${route}?page=9&mode=0&variant=vanilla&campaign=retry#kept`);
    const panel = rows(page, board);
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'First page', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Previous', exact: true })).toBeEnabled();
    await query(page, { page: '9' }, '#kept');
    await panel.getByRole('button', { name: 'Previous', exact: true }).click();
    await query(page, { page: '8' }, '#kept');
    await panel.getByRole('button', { name: 'First page', exact: true }).click();
    await expect(
      panel.getByText(
        record(board ? 'Board fixture 0 vanilla 1' : 'Rank fixture global 0 vanilla 1'),
      ),
    ).toBeVisible();
    await query(page, { page: null, campaign: 'retry' }, '#kept');
  });

  test(`${subject} ignore a delayed earlier partition after a newer partition reaches page two`, async ({
    page,
  }) => {
    const state = await fixture(page);
    const gate = deferred();
    state.total = 1;
    state.delay = { ...gate, board, variant: 'vanilla', page: 3 };
    try {
      await page.goto(`${route}?page=3&mode=0&variant=vanilla&campaign=late#kept`);
      await expect
        .poll(() => state.queries.some((request) => request.board === board && request.page === 3))
        .toBe(true);
      state.total = 74;
      const panel = rows(page, board);
      await panel.getByRole('button', { name: 'Relax (RX)', exact: true }).click();
      await expect(
        panel.getByText(
          record(board ? 'Board fixture 0 relax 1' : 'Rank fixture global 0 relax 1'),
        ),
      ).toBeVisible();
      await panel.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(
        panel.getByText(
          record(board ? 'Board fixture 0 relax 25' : 'Rank fixture global 0 relax 25'),
        ),
      ).toBeVisible();
      const earlierResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.searchParams.get('page') === '3' &&
          url.searchParams.get('variant') === 'vanilla' &&
          url.pathname.includes(board ? `/beatmaps/${mapId}/scores` : '/leaderboard')
        );
      });
      gate.release();
      await earlierResponse;
      await query(page, { page: '2', variant: 'relax', campaign: 'late' }, '#kept');
      await expect(
        panel.getByText(
          record(board ? 'Board fixture 0 relax 25' : 'Rank fixture global 0 relax 25'),
        ),
      ).toBeVisible();
      await expect(
        panel.getByText(
          record(board ? 'Board fixture 0 vanilla 1' : 'Rank fixture global 0 vanilla 1'),
        ),
      ).toHaveCount(0);
    } finally {
      gate.release();
    }
  });
}

test('map-board deep link, mode filters and pagination restore with browser history', async ({
  page,
}) => {
  await fixture(page);
  await page.goto(
    `/beatmaps/${mapId}?page=2&mode=1&variant=relax&country=JP&returnTo=%2Fbeatmaps%3Fq%3Dfixture#board`,
  );
  const panel = rows(page, true);
  await expect(panel.getByText(record('Board fixture 1 relax 25'))).toBeVisible();
  await panel.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(panel.getByText(record('Board fixture 1 relax 49'))).toBeVisible();
  await panel.getByRole('button', { name: 'catch', exact: true }).click();
  await expect(panel.getByText(record('Board fixture 2 relax 1'))).toBeVisible();
  await query(
    page,
    { page: null, mode: '2', variant: 'relax', country: 'JP', returnTo: '/beatmaps?q=fixture' },
    '#board',
  );
  await page.goBack();
  await expect(panel.getByText(record('Board fixture 1 relax 49'))).toBeVisible();
  await page.goBack();
  await expect(panel.getByText(record('Board fixture 1 relax 25'))).toBeVisible();
  await page.goForward();
  await expect(panel.getByText(record('Board fixture 1 relax 49'))).toBeVisible();
  await page.goForward();
  await expect(panel.getByText(record('Board fixture 2 relax 1'))).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, 'map-mobile-history');
});

test('native mania map normalizes incompatible mode and RX while retaining return link and hash', async ({
  page,
}) => {
  const state = await fixture(page, 3);
  await page.goto(
    `/beatmaps/${mapId}?mode=1&variant=relax&page=3&returnTo=%2Fbeatmaps%3Fq%3Dfixture%20note#board`,
  );
  const panel = rows(page, true);
  await expect(panel.getByText(record('Board fixture 3 vanilla 1'))).toBeVisible();
  await query(
    page,
    { mode: '3', variant: 'vanilla', page: null, returnTo: '/beatmaps?q=fixture note' },
    '#board',
  );
  await expect(panel.getByRole('button', { name: 'Relax (RX)', exact: true })).toBeDisabled();
  expect(
    state.queries
      .filter((request) => request.board)
      .every((request) => request.mode === '3' && request.variant === 'vanilla'),
  ).toBe(true);
});
