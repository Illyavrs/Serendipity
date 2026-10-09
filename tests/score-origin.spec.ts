import { expect, test, type Page } from '@playwright/test';

// Intercepted synthetic scores; these tests do not create community records.
const stamp = '2026-10-09T00:00:00Z';
const scoreId = 987861;
const mapId = 987862;
const userId = 987863;
const beatmap = {
  id: mapId,
  official_id: null,
  title: 'Score origin fixture',
  artist: 'Test artist',
  creator: 'Test mapper',
  version: 'Test difficulty',
  mode: 0,
  status: 'ranked',
  source: 'local',
  stars: 3.5,
  bpm: 180,
  length_seconds: 120,
  max_combo: 200,
  play_count: 1,
  md5: '0'.repeat(32),
  download_url: `/api/v1/beatmaps/${mapId}/download`,
  download_kind: 'osu',
  package: null,
};
function result(client?: string | null) {
  return {
    id: scoreId,
    user_id: userId,
    username: 'Source fixture player',
    beatmap_id: mapId,
    title: beatmap.title,
    version: beatmap.version,
    mode: 0,
    score_variant: 'vanilla',
    score: 1000000,
    standardised_score: 1000000,
    score_scale_status: 'native_reported',
    accuracy: 99,
    max_combo: 199,
    mods: 64,
    api_mods: [{ acronym: 'DT', settings: { speed_change: 1.2 } }],
    pp: 123.45,
    passed: true,
    verification: 'verified',
    moderation_revision: 0,
    created_at: stamp,
    has_replay: false,
    client,
    position: 1,
    hit_counts: { n300: 199, n100: 1 },
    accuracy_source: 'client_reported',
    replay_url: null,
    user: { id: userId, username: 'Source fixture player', country: 'TW', avatar_url: null },
    beatmap,
  };
}
async function fixture(page: Page, client?: string | null) {
  await page.context().addCookies([
    {
      name: 'illya_locale',
      value: 'en',
      url: process.env.ILLYA_WEB_URL ?? 'http://localhost:3000',
    },
  ]);
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/me')
      return route.fulfill({ status: 401, json: { error: { code: 'authentication_required' } } });
    if (path === `/api/v1/scores/${scoreId}`) return route.fulfill({ json: result(client) });
    if (path === `/api/v1/beatmaps/${mapId}`) return route.fulfill({ json: beatmap });
    if (path === `/api/v1/beatmaps/${mapId}/scores`)
      return route.fulfill({
        json: {
          items: [result('lazer'), { ...result('stable'), id: scoreId + 1, position: 2 }],
          total: 2,
          page: 1,
          page_size: 24,
          mode: 0,
          score_variant: 'vanilla',
          ordered_by: 'standardised_score',
        },
      });
    return route.fulfill({ status: 404, json: { error: { code: 'fixture_missing' } } });
  });
}

for (const [client, label] of [
  ['lazer', 'Played in osu!lazer'],
  ['stable', 'Played in osu!stable'],
  ['api', 'Submitted through API'],
]) {
  test(`score detail identifies ${client} beside mods without changing conversion data`, async ({
    page,
  }) => {
    await fixture(page, client);
    await page.goto(`/scores/${scoreId}`);
    const mods = page
      .locator('.score-detail-values')
      .locator('div')
      .filter({
        has: page.locator('dt').filter({ hasText: /^Mods$/ }),
      });
    await expect(mods).toContainText('DT');
    const origin = mods.getByRole('img', { name: label, exact: true });
    await expect(origin).toHaveAttribute('data-client', client);
    await expect(origin).toHaveAttribute('title', label);
    await expect(page.locator('.score-detail-player-line a')).toHaveAttribute(
      'href',
      `/users/${userId}?mode=0&variant=vanilla`,
    );
    await expect(page.locator('.back-link')).toHaveAttribute(
      'href',
      `/users/${userId}?mode=0&variant=vanilla`,
    );
    await expect(page.locator('.score-detail-values')).toContainText('1,000,000');
    await expect(page.getByRole('heading', { name: 'Mod settings', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 844 });
    await expect(origin).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

for (const client of [undefined, null, 'future-client', 'LAZER']) {
  test(`score detail does not guess source from structured mods for ${String(client)}`, async ({
    page,
  }) => {
    await fixture(page, client);
    await page.goto(`/scores/${scoreId}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(beatmap.title);
    await expect(page.locator('.score-detail-values .score-origin')).toHaveCount(0);
    await expect(page.locator('.score-detail-values .score-mod-summary')).toHaveText('DT');
  });
}

test('beatmap board shows both sources beside identical mods and emits canonical user links', async ({
  page,
}) => {
  await fixture(page);
  await page.goto(`/beatmaps/${mapId}`);
  const table = page.locator('.score-table');
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await expect(table.getByRole('img', { name: 'Played in osu!lazer', exact: true })).toBeVisible();
  await expect(table.getByRole('img', { name: 'Played in osu!stable', exact: true })).toBeVisible();
  await expect(table.locator('.score-mod-labels')).toHaveText(['DT', 'DT']);
  for (const link of await table.locator('.score-record-player').all())
    await expect(link).toHaveAttribute('href', `/users/${userId}?mode=0&variant=vanilla`);
});
