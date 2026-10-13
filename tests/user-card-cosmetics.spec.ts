import { expect, test, type Page } from '@playwright/test';
import type { CardUser } from '../src/components/user-card';
import type { Reward } from '../src/lib/rewards';

// Intercepted synthetic players only. No account, inventory or relationship is changed.
const titleName = '高性能'.repeat(10) + '！☆';
const title: Reward = {
  id: 993101,
  name: titleName,
  description: 'Synthetic equipped title',
  kind: 'title',
  price: 20,
  color: '#181818',
  style: null,
  active: true,
  revision: 1,
};
const frame: Reward = {
  ...title,
  id: 993102,
  name: 'Synthetic frame',
  kind: 'avatar_frame',
  color: '#b9d7ec',
  style: 'double',
};
const role = {
  id: 993201,
  name: 'moderator',
  short_name: 'MOD',
  colour: '#7dd8c5',
  icon: 'shield',
};
function players(): CardUser[] {
  const equipped: CardUser = {
    id: 993001,
    username: 'Synthetic equipped player',
    country: 'TW',
    avatar_url: null,
    banner_url: null,
    accent_color: '#f28eb6',
    online: true,
    groups: [role],
    cosmetics: { title, avatar_frame: frame },
  };
  return [
    equipped,
    {
      ...equipped,
      id: 993002,
      username: 'Synthetic retired title owner',
      cosmetics: {
        title: { ...title, name: 'Delisted but owned title', active: false },
        avatar_frame: null,
      },
    },
    {
      ...equipped,
      id: 993003,
      username: 'Synthetic no equipment',
      online: false,
      cosmetics: { title: null, avatar_frame: null },
    },
    {
      ...equipped,
      id: 993004,
      username: 'Synthetic legacy payload',
      cosmetics: undefined,
    },
  ];
}
async function fixture(page: Page, guest = false, mode: 'dark' | 'light' = 'dark') {
  const cards = players();
  const state = { profileReads: 0, privateRewardReads: 0, writes: [] as string[] };
  const preferences = {
    mode,
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
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (request.method() !== 'GET') state.writes.push(`${request.method()} ${path}`);
    if (path === '/me')
      return route.fulfill(
        guest
          ? { status: 401, json: { error: { code: 'unauthorized' } } }
          : {
              json: {
                ...cards[0],
                id: 993099,
                username: 'Synthetic viewer',
                bio: '',
                roles: [],
                permissions: ['social.manage', 'chat.send'],
                pp: 0,
                play_count: 0,
                joined_at: '2026-10-12T00:00:00Z',
              },
            },
      );
    if (path === '/me/preferences') return route.fulfill({ json: preferences });
    if (path === '/me/relationships')
      return route.fulfill({
        json: {
          friends: cards.map((target) => ({
            target_id: target.id,
            relation_type: 'friend',
            mutual: false,
            target,
          })),
          blocks: [],
          friended_by: [],
        },
      });
    if (path === '/users/online')
      return route.fulfill({ json: { items: cards, total: cards.length, page: 1, page_size: 24 } });
    if (path === '/groups')
      return route.fulfill({
        json: {
          items: [
            {
              ...role,
              name: 'synthetic_team',
              description: 'Synthetic public directory',
              description_i18n: {},
              rank: 1,
              members: cards,
            },
          ],
        },
      });
    if (/^\/users\/\d+$/.test(path)) state.profileReads++;
    if (path === '/me/rewards') state.privateRewardReads++;
    return route.fulfill({ status: 404, json: { error: { code: 'synthetic_unavailable' } } });
  });
  return state;
}

test('light theme preserves readable player names and status on dark cards', async ({ page }) => {
  const state = await fixture(page, false, 'light');
  await page.goto('/online');
  await expect(page.locator('html')).toHaveClass(/light/);
  await expectEquipment(page);
  const contrast = await card(page, 'Synthetic equipped player').evaluate((element) => {
    const drawing = document.createElement('canvas').getContext('2d')!;
    function rgb(value: string) {
      drawing.fillStyle = value;
      drawing.fillRect(0, 0, 1, 1);
      return Array.from(drawing.getImageData(0, 0, 1, 1).data).slice(0, 3);
    }
    function luminance(channels: number[]) {
      const linear = channels.map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    }
    function ratio(a: number[], b: number[]) {
      const first = luminance(a);
      const second = luminance(b);
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    }
    const material = getComputedStyle(element);
    const ground = rgb(material.backgroundColor);
    const accent = rgb(material.getPropertyValue('--card-accent'));
    // The fixture has no banner; check the darkest surface and its strongest accent tint.
    const tintedGround = ground.map((channel, index) => channel * 0.7 + accent[index] * 0.3);
    const username = rgb(getComputedStyle(element.querySelector('.user-card-name')!).color);
    const status = rgb(getComputedStyle(element.querySelector('.user-card-status')!).color);
    const title = getComputedStyle(element.querySelector('[data-reward-title]')!);
    return {
      username: Math.min(ratio(username, ground), ratio(username, tintedGround)),
      status: Math.min(ratio(status, ground), ratio(status, tintedGround)),
      title: ratio(rgb(title.color), rgb(title.backgroundColor)),
    };
  });
  expect(contrast.username).toBeGreaterThanOrEqual(4.5);
  expect(contrast.status).toBeGreaterThanOrEqual(4.5);
  expect(contrast.title).toBeGreaterThanOrEqual(4.5);
  expect(state.profileReads).toBe(0);
  expect(state.privateRewardReads).toBe(0);
  expect(state.writes).toEqual([]);
});
function card(page: Page, username: string) {
  return page
    .locator('.user-card')
    .filter({ has: page.getByRole('link', { name: username, exact: true }) });
}
async function expectEquipment(page: Page) {
  const equipped = card(page, 'Synthetic equipped player');
  await expect(equipped.locator('[data-reward-title]')).toHaveText(titleName);
  await expect(equipped.locator('[data-reward-frame]')).toHaveAttribute(
    'data-reward-frame',
    'double',
  );
  await expect(equipped.locator('.role-badge')).toHaveText('MOD');
  await expect(equipped.locator('.country-flag')).toBeVisible();
  await expect(
    card(page, 'Synthetic retired title owner').locator('[data-reward-title]'),
  ).toHaveText('Delisted but owned title');
  for (const username of ['Synthetic no equipment', 'Synthetic legacy payload']) {
    await expect(card(page, username).locator('[data-reward-title]')).toHaveCount(0);
    await expect(card(page, username).locator('[data-reward-frame]')).toHaveCount(0);
    await expect(card(page, username).locator('.role-badge')).toHaveText('MOD');
  }
}

for (const route of ['/groups', '/online', '/friends']) {
  test(`equipped cosmetics reach ${route} cards without per-player profile requests`, async ({
    page,
  }) => {
    const state = await fixture(page, route === '/groups');
    await page.goto(route);
    await expectEquipment(page);
    if (route !== '/groups') {
      const equipped = card(page, 'Synthetic equipped player');
      await expect(equipped.locator('.card-friend')).toBeVisible();
      await expect(equipped.locator('.user-card-status')).toContainText('Online');
      await expect(card(page, 'Synthetic no equipment').locator('.user-card-status')).toContainText(
        'Offline',
      );
      await equipped.hover();
      await equipped.getByRole('button', { name: 'More actions', exact: true }).click();
      await expect(page.getByRole('menuitem', { name: 'Message', exact: true })).toBeVisible();
      await expect(
        page.getByRole('menuitem', { name: 'Remove friend', exact: true }),
      ).toBeVisible();
    }
    expect(state.profileReads).toBe(0);
    expect(state.privateRewardReads).toBe(0);
    expect(state.writes).toEqual([]);
  });
}

for (const width of [320, 390, 1440]) {
  test(`32-character titles fit public directory and player cards at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await fixture(page);
    for (const route of ['/groups', '/online', '/friends']) {
      await page.goto(route);
      await expectEquipment(page);
      const fitted = await card(page, 'Synthetic equipped player').evaluate((element) => {
        const article = element.getBoundingClientRect();
        const title = element.querySelector('[data-reward-title]')!.getBoundingClientRect();
        const status = element.querySelector('.user-card-status')!.getBoundingClientRect();
        return {
          titleFits: title.left >= article.left && title.right <= article.right,
          titleAboveStatus: title.bottom <= status.top,
          cardFits: element.scrollWidth <= element.clientWidth,
          pageFits: document.documentElement.scrollWidth <= window.innerWidth,
        };
      });
      expect(fitted).toEqual({
        titleFits: true,
        titleAboveStatus: true,
        cardFits: true,
        pageFits: true,
      });
    }
    await page.screenshot({
      path: test.info().outputPath(`user-cards-${width}.png`),
      fullPage: true,
    });
    expect(state.profileReads).toBe(0);
    expect(state.privateRewardReads).toBe(0);
    expect(state.writes).toEqual([]);
  });
}
