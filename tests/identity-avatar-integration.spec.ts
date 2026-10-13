import { expect, test, type Page } from '@playwright/test';

// Synthetic public presentation fixtures; no accounts, equipment or relationships are changed.
const firstId = 994801;
const mapId = 994901;
const stamp = '2026-10-13T00:00:00Z';
const frameUrl = '/media/reward-frames/8d2b18e6-92cd-4f5c-b6e8-c292bb52943e.png';
const frame = {
  id: 994951,
  name: 'Synthetic uploaded frame',
  description: '',
  kind: 'avatar_frame',
  price: 20,
  color: null,
  style: 'image',
  image_url: frameUrl,
  active: false,
  revision: 3,
};
function card(id: number) {
  return {
    id,
    username: `Identity fixture ${id}`,
    avatar_url: null,
    country: 'TW',
    banner_url: null,
    accent_color: '#f28eb6',
    groups: [],
    online: true,
    cosmetics: { title: null, avatar_frame: frame },
  };
}
const cards = Array.from({ length: 24 }, (_, index) => card(firstId + index));
const map = {
  id: mapId,
  native_set_id: mapId + 1,
  title: 'Synthetic identity map',
  artist: 'Fixture artist',
  creator: 'Fixture mapper',
  version: 'Normal',
  mode: 0,
  status: 'ranked',
  source: 'local',
  stars: 3,
  length_seconds: 90,
  bpm: 180,
  max_combo: 100,
  play_count: 2,
  md5: '0'.repeat(32),
  official_id: null,
  package: null,
};
function score(index: number) {
  return {
    id: 995001 + index,
    user_id: firstId + index,
    username: card(firstId + index).username,
    avatar_url: null,
    country: 'TW',
    beatmap_id: mapId,
    title: map.title,
    version: map.version,
    mode: 0,
    score_variant: 'vanilla',
    score: 990000 - index,
    standardised_score: 990000 - index,
    score_scale_status: 'native_reported',
    accuracy: 99,
    max_combo: 99,
    mods: 0,
    pp: 123.45 - index,
    passed: true,
    verification: 'verified',
    created_at: stamp,
    has_replay: false,
    position: index + 1,
  };
}
const collection = (items: unknown[], size = 24) => ({
  items,
  page: 1,
  page_size: size,
  total: items.length,
});
async function fixture(page: Page) {
  const state = { batches: [] as number[][], profileReads: [] as number[], writes: [] as string[] };
  await page
    .context()
    .addCookies([
      { name: 'illya_locale', value: 'en', url: test.info().project.use.baseURL as string },
    ]);
  await page.route(`**${frameUrl}`, (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  );
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    if (request.method() !== 'GET') state.writes.push(`${request.method()} ${path}`);
    if (path === '/me')
      return route.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } });
    if (path === '/users/cards') {
      const ids = (url.searchParams.get('ids') ?? '').split(',').map(Number);
      state.batches.push(ids);
      return route.fulfill({ json: { items: ids.filter((id) => id > 0).map(card) } });
    }
    if (path === '/leaderboard' || path === '/leaderboard/playtime')
      return route.fulfill({
        json: {
          ...collection(
            cards.map((item, index) => ({
              ...item,
              // Existing rankings omit cosmetics; the shared public lookup provides them.
              cosmetics: undefined,
              pp: 1000 - index,
              rank: index + 1,
              position: index + 1,
              play_count: 20,
              play_time: 300,
              accuracy: 99,
            })),
          ),
          mode: 0,
          score_variant: 'vanilla',
        },
      });
    if (path === `/beatmaps/${mapId}`) return route.fulfill({ json: map });
    if (path === `/beatmaps/${mapId}/set/difficulties`)
      return route.fulfill({ json: collection([map]) });
    if (path === `/beatmaps/${mapId}/scores`)
      return route.fulfill({
        json: { ...collection([score(0), score(1)]), ordered_by: 'standardised_score' },
      });
    const profile = /^\/users\/(\d+)$/.exec(path);
    if (profile) {
      const id = Number(profile[1]);
      state.profileReads.push(id);
      return route.fulfill({
        json: {
          ...card(id),
          bio: '',
          joined_at: stamp,
          roles: [],
          permissions: [],
          pp: 123,
          play_count: 20,
        },
      });
    }
    if (/^\/users\/\d+\/rank-history$/.test(path))
      return route.fulfill({
        json: {
          mode: 0,
          variant: 'vanilla',
          days: 90,
          start_date: '2026-07-16',
          end_date: '2026-10-13',
          time_zone: 'UTC',
          collection_interval_seconds: 1800,
          last_captured_at: null,
          points: [],
        },
      });
    if (path === '/announcements')
      return route.fulfill({
        json: collection([
          {
            id: 995201,
            title: 'Synthetic announcement',
            body: 'A public interface fixture.',
            body_format: 'markdown',
            status: 'published',
            revision: 1,
            created_at: stamp,
            updated_at: stamp,
            published_at: stamp,
            author: card(firstId),
          },
        ]),
      });
    if (path === '/beatmaps' || /^\/users\/\d+\/scores\/best$/.test(path))
      return route.fulfill({ json: collection([]) });
    return route.fulfill({ status: 404, json: { error: { code: 'fixture_missing' } } });
  });
  return state;
}

test('rankings show uploaded frames with one shared public card lookup for the whole list', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/rankings?mode=0&variant=vanilla');
  const links = page.locator('.rankings-table a.player-cell');
  await expect(links).toHaveCount(24);
  await expect(links.first()).toHaveAttribute('data-user-preview', 'true');
  await expect(links.first().locator('[data-reward-frame] img')).toHaveAttribute('src', frameUrl);
  await expect(page.locator('.rankings-table [data-reward-frame]')).toHaveCount(24);
  await expect
    .poll(() =>
      links.first().evaluate((link) => {
        const image = link.querySelector<HTMLImageElement>('[data-reward-frame] img');
        return Boolean(image?.complete && image.naturalWidth > 0);
      }),
    )
    .toBe(true);
  const geometry = await links.first().evaluate((link) => {
    const avatar = link.querySelector('[data-user-avatar]')!;
    const image = link.querySelector('[data-reward-frame] img')!;
    return {
      avatar: avatar.getBoundingClientRect().width,
      frame: image.getBoundingClientRect().width,
      pointerEvents: getComputedStyle(image).pointerEvents,
    };
  });
  expect(geometry.frame).toBeGreaterThan(geometry.avatar);
  expect(geometry.pointerEvents).toBe('none');
  expect(state.batches).toHaveLength(1);
  expect(state.batches[0].toSorted((a, b) => a - b)).toEqual(cards.map((item) => item.id));
  expect(state.profileReads).toEqual([]);
  expect(state.writes).toEqual([]);
});

test('beatmap top avatar opens the player profile while the feature card still opens the score', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`/beatmaps/${mapId}`);
  const avatar = page.locator('.lb-top-avatar');
  await expect(avatar).toHaveAttribute('href', `/users/${firstId}?mode=0&variant=vanilla`);
  await expect(avatar).toHaveAttribute('data-user-preview', 'true');
  await expect(avatar.locator('[data-reward-frame] img')).toHaveAttribute('src', frameUrl);
  await expect(page.locator('.lb-top-link')).toHaveAttribute('href', '/scores/995001');
  await expect(page.locator('.lb-player')).toHaveAttribute('data-user-preview', 'true');
  await avatar.click();
  await expect(page).toHaveURL(new RegExp(`/users/${firstId}\\?mode=0&variant=vanilla$`));
  await expect(page.locator('.profile-identity [data-reward-frame] img')).toHaveAttribute(
    'src',
    frameUrl,
  );
  expect(state.batches).toEqual([[firstId]]);
  expect(state.writes).toEqual([]);
});

test('playtime rankings keep profile links and display the same uploaded frames', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/rankings/playtime');
  const player = page.locator('.rankings-table a.player-cell').first();
  await expect(player).toHaveAttribute('href', `/users/${firstId}`);
  await expect(player).toHaveAttribute('data-user-preview', 'true');
  await expect(page.locator('.rankings-table [data-reward-frame] img')).toHaveCount(24);
  expect(state.batches).toEqual([cards.map((item) => item.id)]);
  expect(state.profileReads).toEqual([]);
  expect(state.writes).toEqual([]);
});

test('a profile uses its known equipped frame without fetching individual or batched cards', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/users/${firstId}`);
  await expect(page.locator('.profile-identity [data-reward-frame] img')).toHaveAttribute(
    'src',
    frameUrl,
  );
  await expect(page.locator('.profile-player-name h1')).toHaveText(card(firstId).username);
  expect(state.batches).toEqual([]);
  expect(state.profileReads).toEqual([firstId]);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  expect(state.writes).toEqual([]);
});

test('announcement author identity shows the same frame and accepts user preview hover', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/news');
  const author = page.locator('.announcement-author');
  await expect(author).toHaveAttribute('href', `/users/${firstId}`);
  await expect(author).toHaveAttribute('data-user-preview', 'true');
  await expect(author.locator('[data-reward-frame] img')).toHaveAttribute('src', frameUrl);
  await expect(page.locator('.announcement-rows h2 a')).not.toHaveAttribute('data-user-preview');
  expect(state.batches).toEqual([[firstId]]);
  expect(state.profileReads).toEqual([]);
  expect(state.writes).toEqual([]);
});
