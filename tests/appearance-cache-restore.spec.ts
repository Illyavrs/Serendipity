import { expect, test, type Page } from '@playwright/test';

const cached = {
  mode: 'light',
  locale: 'ja',
  accent_color: '#82c5bb',
  background_url: '/media/appearance-cache-fixture.png',
  background_blur: 7,
  background_dim: 0.42,
  panel_blur: 23,
  panel_opacity: 0.38,
  glass_level: 50,
  border_radius: 11,
};

async function fixture(page: Page, raw: string | null, signedIn = false) {
  await page
    .context()
    .addCookies([
      { name: 'illya_locale', value: 'en', url: test.info().project.use.baseURL as string },
    ]);
  await page.addInitScript((raw) => {
    if (raw === null) localStorage.removeItem('illya_appearance');
    else localStorage.setItem('illya_appearance', raw);
    const writes: unknown[] = [];
    (window as unknown as { appearanceWrites: unknown[] }).appearanceWrites = writes;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'illya_appearance') writes.push(JSON.parse(value));
      return setItem.call(this, key, value);
    };
  }, raw);
  await page.route('**/media/appearance-cache-fixture.png', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAPklEQVR4nGM4s3MmVuQSXYgVkaqeYdSCUQuGgAXUMgiX+lELRi0YChbQPKONWjBqwRCwgOYZbdSCUQsGvwUAGpBcW8YKdfIAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  );
  const requests: string[] = [];
  await page.route('**/api/v1/**', (route) => {
    const endpoint = new URL(route.request().url()).pathname.slice('/api/v1'.length);
    requests.push(endpoint);
    if (route.request().method() !== 'GET') throw new Error('Cache fixture must remain read-only');
    if (endpoint === '/me')
      return signedIn
        ? route.fulfill({
            json: {
              id: 990001,
              username: 'Appearance cache fixture',
              country: 'TW',
              bio: '',
              avatar_url: null,
              banner_url: null,
              accent_color: '#f28eb6',
              roles: [],
              permissions: [],
              joined_at: '2026-10-09T00:00:00Z',
              pp: 0,
              play_count: 0,
            },
          })
        : route.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } });
    if (endpoint === '/me/preferences')
      return route.fulfill({
        json: {
          ...cached,
          locale: 'en',
          mode: 'dark',
          background_url: null,
          panel_blur: 31,
        },
      });
    if (endpoint === '/official/beatmapsets/search')
      return route.fulfill({ json: { items: [], total: 0, cursor_string: null } });
    if (endpoint === '/server/beatmapsets')
      return route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 24 } });
    return route.fulfill({ status: 404, json: { error: { code: 'fixture_unused' } } });
  });
  return requests;
}

test('cached light material restores without overwriting the cache with initial dark defaults', async ({
  page,
}) => {
  await fixture(page, JSON.stringify(cached));
  await page.goto('/beatmaps');
  await expect(page.locator('html')).toHaveClass(/light/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('data-glass-level', '50');
  await expect(page.locator('.global-scene')).toHaveCSS(
    'background-image',
    /appearance-cache-fixture\.png/,
  );
  expect(
    await page
      .locator('html')
      .evaluate((html) => getComputedStyle(html).getPropertyValue('--panel-blur').trim()),
  ).toBe('23px');
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('illya_appearance')!));
  expect(restored).toEqual({ ...cached, locale: 'en' });
  const writes = await page.evaluate(
    () => (window as unknown as { appearanceWrites: (typeof cached)[] }).appearanceWrites,
  );
  expect(writes.length).toBeGreaterThan(0);
  expect(
    writes.every(
      (write) => write.mode === 'light' && write.background_url === cached.background_url,
    ),
  ).toBe(true);
  await page.locator('.catalogue-source a').last().click();
  await expect(page.locator('html')).toHaveClass(/light/);
  await expect(page.locator('.global-scene')).toHaveCSS(
    'background-image',
    /appearance-cache-fixture\.png/,
  );
});

for (const raw of [null, '{invalid']) {
  test(`absent or malformed cache releases appearance controls with plain dark defaults (${raw ?? 'absent'})`, async ({
    page,
  }) => {
    await fixture(page, raw);
    await page.goto('/beatmaps');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('.global-scene')).toHaveCSS('background-image', 'none');
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await expect(page.locator('#quick-glass_level').getByRole('slider')).toBeEnabled();
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('illya_appearance')!).mode),
    ).toBe('dark');
  });
}

test('authenticated database preferences retain authority after cached appearance initialization', async ({
  page,
}) => {
  const requests = await fixture(page, JSON.stringify(cached), true);
  await page.goto('/beatmaps');
  await expect.poll(() => requests.includes('/me/preferences')).toBe(true);
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('.global-scene')).toHaveCSS('background-image', 'none');
  await expect
    .poll(() =>
      page
        .locator('html')
        .evaluate((html) => getComputedStyle(html).getPropertyValue('--panel-blur').trim()),
    )
    .toBe('31px');
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('illya_appearance')!));
  expect(restored.mode).toBe('dark');
  expect(restored.panel_blur).toBe(31);
});
