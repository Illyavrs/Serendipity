import { expect, test, type Page } from '@playwright/test';

// Browser APIs are intercepted with synthetic profiles. Redirect assertions exercise Next itself;
// no community account is changed and no database permission is inferred from these fixtures.
const userId = 995201;
const stamp = '2026-10-09T00:00:00Z';
const user = {
  id: userId,
  username: 'Canonical route fixture',
  country: 'TW',
  bio: 'Synthetic public profile.',
  avatar_url: null,
  banner_url: null,
  accent_color: '#f28eb6',
  roles: [],
  permissions: [],
  joined_at: stamp,
  pp: 200,
  play_count: 48,
  statistics: { rank: 1, country_rank: 1, accuracy: 98.5 },
};

async function fixture(page: Page, baseURL: string | undefined) {
  await page
    .context()
    .addCookies([{ name: 'illya_locale', value: 'en', url: baseURL ?? 'http://localhost:3000' }]);
  const state = {
    signedIn: false,
    profileStatus: 200,
    profileQueries: [] as URLSearchParams[],
    scoreQueries: [] as URLSearchParams[],
  };
  await page.routeWebSocket('**/api/v1/chat/stream', (socket) =>
    socket.send(JSON.stringify({ type: 'ready' })),
  );
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/auth/login') {
      expect(route.request().method()).toBe('POST');
      state.signedIn = true;
      return route.fulfill({ json: { user } });
    }
    if (url.pathname === '/api/v1/me')
      return route.fulfill(
        state.signedIn
          ? { json: user }
          : { status: 401, json: { error: { code: 'authentication_required' } } },
      );
    if (url.pathname === '/api/v1/me/preferences')
      return route.fulfill({ json: { mode: 'dark', locale: 'en' } });
    if (url.pathname === '/api/v1/me/relationships')
      return route.fulfill({ json: { friends: [], blocks: [] } });
    if (url.pathname === `/api/v1/users/${userId}`) {
      state.profileQueries.push(url.searchParams);
      return route.fulfill(
        state.profileStatus === 200
          ? { json: user }
          : { status: state.profileStatus, json: { error: { code: 'profile_access_denied' } } },
      );
    }
    if (
      url.pathname === `/api/v1/users/${userId}/scores/best` ||
      url.pathname === '/api/v1/scores'
    ) {
      state.scoreQueries.push(url.searchParams);
      return route.fulfill({
        json: {
          items: [],
          total: 48,
          page: Number(url.searchParams.get('page') ?? '1'),
          page_size: 24,
        },
      });
    }
    if (url.pathname === '/api/v1/leaderboard')
      return route.fulfill({
        json: {
          items: [{ ...user, rank: 1, accuracy: 98.5 }],
          total: 1,
          page: 1,
          page_size: 24,
        },
      });
    if (url.pathname === '/api/v1/beatmaps')
      return route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 5 } });
    return route.fulfill({ status: 404, json: { error: { code: 'synthetic_fixture_missing' } } });
  });
  return state;
}

for (const query of [
  '',
  '?mode=1&variant=relax&page=2&score_view=recent&rank_days=30&rank_metric=country',
  '?mode=0&variant=vanilla&campaign=first&campaign=second&label=%E6%98%9F%20%26%20%2B&empty=',
]) {
  test(`legacy profile responds with a permanent redirect and preserves ${query || 'no query'}`, async ({
    request,
    baseURL,
  }) => {
    const response = await request.get(`/players/${userId}${query}`, { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    const destination = new URL(response.headers().location, baseURL);
    expect(destination.pathname).toBe(`/users/${userId}`);
    expect([...destination.searchParams]).toEqual([...new URLSearchParams(query)]);
    expect(destination.origin).toBe(new URL(baseURL!).origin);
  });
}

test('legacy HEAD preserves the profile identity and query without serving profile HTML', async ({
  request,
  baseURL,
}) => {
  const response = await request.head(`/players/${userId}?mode=2&variant=relax`, {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(308);
  const destination = new URL(response.headers().location, baseURL);
  expect(destination.pathname).toBe(`/users/${userId}`);
  expect([...destination.searchParams]).toEqual([
    ['mode', '2'],
    ['variant', 'relax'],
  ]);
  expect(await response.body()).toHaveLength(0);
});

test('a bookmarked legacy profile retains its RX collection, repeated query and section hash', async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  const query =
    'mode=1&variant=relax&page=2&score_view=recent&rank_days=30&rank_metric=country&tag=one&tag=two';
  await page.goto(`/players/${userId}?${query}#profile-scores`);
  await expect(page.locator('.profile-identity h1')).toHaveText(user.username);
  await expect.poll(() => state.profileQueries.at(-1)?.get('mode')).toBe('1');
  await expect.poll(() => state.profileQueries.at(-1)?.get('variant')).toBe('relax');
  await expect.poll(() => state.scoreQueries.at(-1)?.get('page')).toBe('2');
  const location = new URL(page.url());
  expect(location.pathname).toBe(`/users/${userId}`);
  expect([...location.searchParams]).toEqual([...new URLSearchParams(query)]);
  expect(location.hash).toBe('#profile-scores');
  await expect(
    page.locator('.profile-mode-rail').getByRole('button', { name: 'taiko', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page
      .locator('.profile-score-collection')
      .getByRole('button', { name: 'Recent scores', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('canonical public profile renders directly and uses the existing users API', async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  const response = await page.goto(`/users/${userId}?mode=0&variant=vanilla`);
  expect(response?.status()).toBe(200);
  expect(response?.request().redirectedFrom()).toBe(null);
  await expect(page.locator('.profile-identity h1')).toHaveText(user.username);
  await expect.poll(() => state.profileQueries.length).toBeGreaterThan(0);
  expect(new URL(page.url()).pathname).toBe(`/users/${userId}`);
});

test('login navigates to users and desktop and mobile profile links use the canonical path', async ({
  page,
  baseURL,
}) => {
  await fixture(page, baseURL);
  await page.goto('/login');
  await page.getByLabel('Username or email', { exact: true }).fill(user.username);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic-route-fixture-only');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/users/${userId}$`));
  await expect(page.locator('.user-link')).toHaveAttribute('href', `/users/${userId}`);
  await expect(page.locator('.profile-identity h1')).toHaveText(user.username);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(
    page.locator('.mobile-nav').getByRole('link', { name: 'My profile', exact: true }),
  ).toHaveAttribute('href', `/users/${userId}`);
});

test('ranking profile links preserve selected mode and RX partition at the canonical URL', async ({
  page,
  baseURL,
}) => {
  await fixture(page, baseURL);
  await page.goto('/rankings?mode=1&variant=relax');
  const profile = page
    .locator('.rankings-table')
    .getByRole('link', { name: user.username });
  await expect(profile).toHaveAttribute('href', `/users/${userId}?mode=1&variant=relax`);
  await profile.click();
  await expect(page).toHaveURL(new RegExp(`/users/${userId}\\?mode=1&variant=relax$`));
  await expect(page.locator('.profile-identity h1')).toHaveText(user.username);
});

test('legacy bookmarks still show the profile access error instead of protected profile data', async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  state.profileStatus = 403;
  await page.goto(`/players/${userId}`);
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await expect(page.locator('.profile-identity')).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe(`/users/${userId}`);
  expect(state.scoreQueries).toHaveLength(0);
});
