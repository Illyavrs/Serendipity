import { expect, test, type Page } from '@playwright/test';

type BackgroundMode = 'default' | 'image' | 'color';
type AppearanceFixture = {
  mode: string;
  locale: string;
  accent_color: string;
  background_url: string | null;
  background_mode?: BackgroundMode;
  background_color?: string;
  background_blur: number;
  background_dim: number;
  panel_blur: number;
  panel_opacity: number;
  glass_level: number;
  border_radius: number;
};
const defaults: AppearanceFixture = {
  mode: 'dark',
  locale: 'en',
  accent_color: '#f28eb6',
  background_url: null,
  background_mode: 'default',
  background_color: '#000000',
  background_blur: 7,
  background_dim: 0.42,
  panel_blur: 17,
  panel_opacity: 0.38,
  glass_level: 50,
  border_radius: 11,
};

async function fixture(
  page: Page,
  {
    signedIn = false,
    preferences = defaults,
    cached,
  }: {
    signedIn?: boolean;
    preferences?: AppearanceFixture;
    cached?: Partial<AppearanceFixture>;
  } = {},
) {
  const state = {
    preferences: { ...preferences },
    writes: [] as Record<string, unknown>[],
    profiles: [] as Record<string, unknown>[],
    failSave: false,
  };
  await page
    .context()
    .addCookies([{ name: 'illya_locale', value: 'en', url: test.info().project.use.baseURL! }]);
  await page.addInitScript((cached) => {
    if (cached && !localStorage.getItem('illya_appearance'))
      localStorage.setItem('illya_appearance', JSON.stringify(cached));
  }, cached);
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/me')
      return signedIn
        ? route.fulfill({
            json: {
              id: 990011,
              username: 'Color control fixture',
              country: 'TW',
              bio: '',
              avatar_url: null,
              banner_url: null,
              banner_position_x: 50,
              banner_position_y: 50,
              accent_color: '#f28eb6',
              roles: [],
              permissions: [],
              joined_at: '2026-10-10T00:00:00Z',
              pp: 0,
              play_count: 0,
            },
          })
        : route.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } });
    if (path === '/api/v1/me/preferences' && request.method() === 'GET')
      return route.fulfill({ json: state.preferences });
    if (path === '/api/v1/me/preferences' && request.method() === 'PATCH') {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.writes.push(body);
      if (state.failSave)
        return route.fulfill({ status: 503, json: { error: { code: 'unavailable' } } });
      Object.assign(state.preferences, body);
      return route.fulfill({ json: state.preferences });
    }
    if (path === '/api/v1/me/profile' && request.method() === 'PATCH') {
      state.profiles.push(request.postDataJSON() as Record<string, unknown>);
      return route.fulfill({ json: { saved: true } });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'fixture_unused' } } });
  });
  await page.route('**/media/color-fixture.png', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  );
  return state;
}

const appearance = (page: Page) => page.locator('.appearance-controls:not(.compact)');
const backgroundMode = (page: Page, name: string) =>
  appearance(page).locator('.background-mode-control').getByRole('button', { name, exact: true });

async function cachedPreferences(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('illya_appearance')!));
}

test('React-colorful keyboard picker updates accent, rejects incomplete hex and returns focus', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/settings');
  const field = page.locator('#accent');
  await expect(field).toHaveValue('#f28eb6');
  await field.fill('#7dd8c5');
  await expect
    .poll(() =>
      page.locator('html').evaluate((html) => html.style.getPropertyValue('--user-accent')),
    )
    .toBe('#7dd8c5');
  await field.fill('#12zz');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  expect((await cachedPreferences(page)).accent_color).toBe('#7dd8c5');
  await field.press('Tab');
  await expect(field).toHaveValue('#7dd8c5');
  const trigger = appearance(page).locator('.color-picker-trigger').first();
  await trigger.focus();
  await trigger.press('Enter');
  const popup = page.locator('.color-picker-popup');
  await expect(popup.locator('.react-colorful')).toBeVisible();
  const hue = popup.locator('.react-colorful__hue [role="slider"]');
  await hue.focus();
  await hue.press('ArrowRight');
  await expect(field).not.toHaveValue('#7dd8c5');
  await hue.press('Escape');
  await expect(popup).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('solid guest background preserves the exact color across themes, image switching and reload', async ({
  page,
}) => {
  await fixture(page, {
    cached: { ...defaults, background_url: '/media/color-fixture.png', background_mode: 'image' },
  });
  await page.goto('/settings');
  await expect(page.locator('.global-scene')).toHaveCSS('background-image', /color-fixture\.png/);
  await backgroundMode(page, 'Solid color').click();
  await page.locator('#background-color').fill('#214b62');
  await expect(page.locator('.global-scene')).toHaveCSS('background-color', 'rgb(33, 75, 98)');
  await expect(page.locator('.global-scene')).toHaveCSS('background-image', 'none');
  await expect(page.locator('.global-scene')).toHaveCSS('filter', 'none');
  await expect(page.locator('.global-veil')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  for (const theme of ['Light', 'Dark']) {
    await appearance(page).getByRole('button', { name: theme, exact: true }).click();
    await expect(page.locator('.global-scene')).toHaveCSS('background-color', 'rgb(33, 75, 98)');
  }
  await expect(page.locator('#background_dim').getByRole('slider')).toBeDisabled();
  await expect(page.locator('#panel_blur').getByRole('slider')).toBeEnabled();
  await page.reload();
  await expect(page.locator('#background-color')).toHaveValue('#214b62');
  expect(await cachedPreferences(page)).toMatchObject({
    background_mode: 'color',
    background_color: '#214b62',
    background_url: '/media/color-fixture.png',
    panel_blur: 17,
    panel_opacity: 0.38,
    glass_level: 50,
  });
  await backgroundMode(page, 'Image').click();
  await expect(page.locator('.global-scene')).toHaveCSS('background-image', /color-fixture\.png/);
  await expect(page.locator('.global-scene')).toHaveCSS('filter', 'blur(7px)');
  await backgroundMode(page, 'Theme background').click();
  await expect(page.locator('.global-scene')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
});

test('legacy account image inference, retry draft and persisted solid color retain account authority', async ({
  page,
}) => {
  const legacy = { ...defaults, background_url: '/media/color-fixture.png' };
  delete legacy.background_mode;
  delete legacy.background_color;
  const state = await fixture(page, {
    signedIn: true,
    preferences: legacy,
    cached: { ...defaults, background_mode: 'color', background_color: '#abcdef' },
  });
  await page.goto('/settings');
  await expect(page.locator('.global-scene')).toHaveAttribute('data-background-mode', 'image');
  await backgroundMode(page, 'Solid color').click();
  await page.locator('#background-color').fill('#214b62');
  state.failSave = true;
  await appearance(page).getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(appearance(page).getByRole('alert')).toBeVisible();
  await expect(page.locator('#background-color')).toHaveValue('#214b62');
  expect(state.writes[0]).toMatchObject({
    background_mode: 'color',
    background_color: '#214b62',
    background_url: '/media/color-fixture.png',
    panel_blur: 17,
  });
  state.failSave = false;
  await appearance(page).getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(appearance(page).locator('.form-success')).toBeVisible();
  await page.reload();
  await expect(page.locator('.global-scene')).toHaveCSS('background-color', 'rgb(33, 75, 98)');
  expect(state.writes).toHaveLength(2);
});

test('malformed cached background options recover the black default without inheriting a remote image', async ({
  page,
}) => {
  await fixture(page, {
    cached: {
      ...defaults,
      background_mode: 'invalid' as BackgroundMode,
      background_color: 'red',
      background_url: 'https://example.invalid/image.png',
    },
  });
  await page.goto('/settings');
  await expect(page.locator('.global-scene')).toHaveAttribute('data-background-mode', 'default');
  await expect(page.locator('.global-scene')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect
    .poll(() => cachedPreferences(page))
    .toMatchObject({
      background_mode: 'default',
      background_color: '#000000',
      background_url: null,
    });
});

test('public profile accent uses the same picker and saves independently from private appearance', async ({
  page,
}) => {
  const state = await fixture(page, { signedIn: true });
  await page.goto('/settings?tab=profile');
  await expect(page.locator('#profile-accent')).toHaveValue('#f28eb6');
  await page.locator('#profile-accent').fill('#214b62');
  await expect(page.locator('.profile-accent-scope')).toHaveCSS('--profile-accent', '#214b62');
  await page
    .locator('.settings-form')
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  await expect.poll(() => state.profiles.length).toBe(1);
  expect(state.profiles[0]).toMatchObject({ country: 'TW', accent_color: '#214b62' });
  expect(state.writes).toHaveLength(0);
  expect((await cachedPreferences(page)).accent_color).toBe('#f28eb6');
});

test('picker stays bounded with stable scrollbar position on desktop and mobile in both themes', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/settings');
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['Dark', 'Light']) {
      await appearance(page).getByRole('button', { name: theme, exact: true }).click();
      const trigger = appearance(page).locator('.color-picker-trigger').first();
      await trigger.scrollIntoViewIfNeeded();
      const before = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        x: document.querySelector('.site-header')!.getBoundingClientRect().x,
      }));
      await trigger.click();
      const popup = page.locator('.color-picker-popup');
      await expect(popup).toBeVisible();
      await expect(popup).toHaveCSS('backdrop-filter', 'blur(8px)');
      const bounds = await popup.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(
        await page.evaluate(() => ({
          width: document.documentElement.clientWidth,
          x: document.querySelector('.site-header')!.getBoundingClientRect().x,
        })),
      ).toEqual(before);
      await page.screenshot({
        path: test.info().outputPath(`picker-${width}-${theme.toLowerCase()}.png`),
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await expect(popup).toHaveCount(0);
    }
  }
});
