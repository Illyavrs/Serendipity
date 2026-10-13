import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Reward } from '../src/lib/rewards';

// Synthetic intercepted public profile. No real account, media or equipment is changed.
const playerId = 993101;
const frame: Reward = {
  id: 993102,
  name: 'Synthetic profile frame',
  description: '',
  kind: 'avatar_frame',
  price: 20,
  color: '#88aaff',
  style: 'corners',
  active: false,
  revision: 1,
};

async function fixture(page: Page, banner: boolean) {
  const state = { frame: null as Reward | null, writes: [] as string[] };
  const preferences = {
    mode: 'dark',
    locale: 'en',
    accent_color: '#f28eb6',
    background_url: null,
    background_blur: 0,
    background_dim: 0.76,
    panel_blur: 8,
    panel_opacity: 0.55,
    glass_level: 100,
    border_radius: 14,
  };
  await page.context().addCookies([
    {
      name: 'illya_locale',
      value: 'en',
      url: test.info().project.use.baseURL as string,
    },
  ]);
  await page.addInitScript(
    (value) => localStorage.setItem('illya_appearance', JSON.stringify(value)),
    preferences,
  );
  await page.route('**/media/banners/profile-cosmetics.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="282" height="55"><rect width="282" height="55" fill="#42657d"/></svg>',
    }),
  );
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    if (request.method() !== 'GET') state.writes.push(path);
    if (path === '/me')
      return route.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } });
    if (path === `/users/${playerId}`)
      return route.fulfill({
        json: {
          id: playerId,
          username: 'Synthetic framed profile',
          country: 'TW',
          avatar_url: null,
          banner_url: banner ? '/media/banners/profile-cosmetics.svg' : null,
          accent_color: '#f28eb6',
          joined_at: '2026-10-12T00:00:00Z',
          bio: '',
          bio_format: 'markdown',
          pp: 0,
          play_count: 0,
          roles: [],
          groups: [],
          cosmetics: { title: null, avatar_frame: state.frame },
        },
      });
    if (path === `/users/${playerId}/rank-history`)
      return route.fulfill({
        json: {
          mode: 0,
          variant: 'vanilla',
          days: 90,
          start_date: '2026-07-15',
          end_date: '2026-10-12',
          time_zone: 'UTC',
          collection_interval_seconds: 1800,
          last_captured_at: null,
          points: [],
        },
      });
    if (path.startsWith(`/users/${playerId}/scores`))
      return route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 5 } });
    return route.fulfill({ status: 404, json: { error: { code: 'synthetic_unavailable' } } });
  });
  return state;
}

async function avatarGeometry(identity: Locator) {
  return identity.evaluate((element) => {
    const holder = element.querySelector<HTMLElement>(
      ':scope > .avatar, :scope > [data-reward-frame]',
    )!;
    const avatar = holder.matches('.avatar')
      ? holder
      : holder.querySelector<HTMLElement>('.avatar')!;
    const holderRect = holder.getBoundingClientRect();
    const avatarRect = avatar.getBoundingClientRect();
    const holderStyle = getComputedStyle(holder);
    const avatarStyle = getComputedStyle(avatar);
    return {
      left: holderRect.left,
      top: holderRect.top,
      width: holderRect.width,
      height: holderRect.height,
      avatarWidth: avatarRect.width,
      avatarHeight: avatarRect.height,
      avatarLeft: avatarRect.left,
      avatarTop: avatarRect.top,
      radius: parseFloat(holderStyle.borderTopLeftRadius),
      avatarRadius: parseFloat(avatarStyle.borderTopLeftRadius),
      fontSize: parseFloat(avatarStyle.fontSize),
      outlineWidth: parseFloat(holderStyle.outlineWidth),
      outlineStyle: holderStyle.outlineStyle,
      identityTop: element.getBoundingClientRect().top,
      pageFits: document.documentElement.scrollWidth <= innerWidth,
    };
  });
}

for (const width of [1440, 320, 390]) {
  for (const banner of [false, true]) {
    test(`profile frames preserve avatar size and position ${banner ? 'with' : 'without'} a banner at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const state = await fixture(page, banner);
      await page.goto(`/users/${playerId}`);
      const identity = page.locator('#profile-overview .profile-identity');
      await expect(
        identity.getByRole('heading', { name: 'Synthetic framed profile' }),
      ).toBeVisible();
      const baseline = await avatarGeometry(identity);
      const size = width > 600 ? 108 : 80;
      expect(baseline.width).toBe(size);
      expect(baseline.height).toBe(size);
      expect(baseline.radius).toBeCloseTo(11.2, 1);
      if (banner) expect(baseline.top + size / 2).toBeCloseTo(baseline.identityTop, 1);
      else expect(baseline.top).toBeGreaterThan(baseline.identityTop);

      for (const style of ['corners', 'double'] as const) {
        state.frame = { ...frame, style };
        await page.reload();
        const displayedFrame = identity.locator('[data-reward-frame]');
        await expect(displayedFrame).toHaveAttribute('data-reward-frame', style);
        await expect(displayedFrame.locator('.avatar')).toBeVisible();
        const geometry = await avatarGeometry(identity);
        expect(geometry).toEqual(baseline);
        expect(geometry.avatarWidth).toBe(size);
        expect(geometry.avatarHeight).toBe(size);
        expect(geometry.avatarLeft).toBe(geometry.left);
        expect(geometry.avatarTop).toBe(geometry.top);
        expect(geometry.avatarRadius).toBe(geometry.radius);
        expect(geometry.outlineStyle).toBe(banner ? 'solid' : 'none');
        if (banner) expect(geometry.outlineWidth).toBe(4);
        expect(geometry.pageFits).toBe(true);
      }
      expect(state.writes).toEqual([]);
    });
  }
}
