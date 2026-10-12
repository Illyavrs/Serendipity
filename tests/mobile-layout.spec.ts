import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Preferences, Score, User } from '../src/lib/types';

// Synthetic browser-only activity; no production account or score data is changed.
const scores: Score[] = Array.from({ length: 10 }, (_, index) => ({
  id: 7700 + index,
  user_id: 7800 + index,
  username: `LayoutPlayer${index}`,
  beatmap_id: 7900 + index,
  beatmapset_id: 1234,
  title: 'The Glory Days (TV Size) · 手機排版測試的長圖譜名稱',
  artist: 'QA Artist',
  version: 'Another Difficulty With A Long Name',
  mode: index % 4,
  score_variant: index % 2 ? 'relax' : 'vanilla',
  score: 7654321,
  accuracy: 94.42,
  max_combo: 284,
  beatmap_max_combo: 1000,
  mods: 24,
  client: index % 2 ? 'stable' : 'lazer',
  pp: index ? 231.73 : 0,
  grade: index ? 'A' : 'F',
  stars: 6.01,
  passed: index !== 0,
  verification: 'verified',
  moderation_revision: 0,
  created_at: '2026-10-12T00:00:00Z',
  has_replay: true,
}));

async function fixture(page: Page, baseURL: string | undefined, theme: 'dark' | 'light') {
  const preferences: Preferences = {
    locale: 'zh-TW',
    mode: theme,
    accent_color: '#f28eb6',
    background_url: null,
    background_mode: 'default',
    background_color: '#000000',
    background_blur: 0,
    background_dim: 0.76,
    panel_blur: 8,
    panel_opacity: 0.55,
    glass_level: 100,
    border_radius: 14,
  };
  const user: User = {
    id: 7800,
    username: 'LayoutStaff',
    country: 'TW',
    bio: '',
    avatar_url: null,
    banner_url: null,
    banner_position_x: 50,
    banner_position_y: 50,
    accent_color: '#f28eb6',
    roles: ['QA Staff'],
    permissions: ['admin.view', 'roles.manage'],
    joined_at: '2026-10-01T00:00:00Z',
    pp: 0,
    play_count: 0,
  };
  await page.context().addCookies([{ name: 'illya_locale', value: 'zh-TW', url: baseURL! }]);
  await page.addInitScript((preferences) => {
    localStorage.setItem('theme', preferences.mode);
    localStorage.setItem('illya_appearance', JSON.stringify(preferences));
  }, preferences);
  await page.route('https://assets.ppy.sh/**', (route) =>
    route.fulfill({
      contentType: 'image/webp',
      body: readFileSync('public/images/home-character.webp'),
    }),
  );
  await page.route('**/api/v1/**', (route) => {
    const endpoint = new URL(route.request().url()).pathname.slice('/api/v1'.length);
    if (endpoint === '/me') return route.fulfill({ json: user });
    if (endpoint === '/me/preferences') return route.fulfill({ json: preferences });
    if (endpoint === '/status')
      return route.fulfill({
        json: {
          players_online: 0,
          registered_players: 95,
          ranked_scores: 591,
          beatmap_count: 952,
          compatibility: {},
        },
      });
    if (endpoint === '/scores')
      return route.fulfill({
        json: {
          items: [
            ...scores,
            { ...scores[0], id: 7799, title: 'Private fixture', verification: 'pending' },
          ],
          total: 10,
          page: 1,
          page_size: 10,
        },
      });
    if (['/beatmapsets', '/leaderboard', '/announcements', '/notifications'].includes(endpoint))
      return route.fulfill({
        json: { items: [], total: 0, page: 1, page_size: 3, unread_count: 0 },
      });
    return route.fulfill({ status: 404, json: { error: { code: 'unused_fixture' } } });
  });
}

for (const theme of ['dark', 'light'] as const) {
  for (const width of [320, 360, 390, 600, 768, 1024, 1440]) {
    test(`recent performances and portrait fit ${width}px ${theme}`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 740 });
      await fixture(page, baseURL, theme);
      await page.goto('/');
      const rows = page.locator('.home-profile-scores .profile-score-row');
      await expect(rows).toHaveCount(10);
      await expect(page.getByText('Private fixture')).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      const geometry = await rows.evaluateAll((rows) =>
        rows.map((row) => {
          const box = row.getBoundingClientRect();
          const cells = ['leading', 'main', 'mods', 'statistics', 'performance', 'replay'].map(
            (name) => row.querySelector(`.profile-score-${name}`)!.getBoundingClientRect(),
          );
          return {
            titleWidth: row.querySelector('.score-title')!.getBoundingClientRect().width,
            height: box.height,
            contained: cells.every((cell) => cell.left >= box.left && cell.right <= box.right + 1),
            overlapping: cells.some((a, i) =>
              cells
                .slice(i + 1)
                .some(
                  (b) =>
                    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
                    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1,
                ),
            ),
          };
        }),
      );
      for (const row of geometry) {
        expect(row.titleWidth).toBeGreaterThan(80);
        expect(row.height).toBeLessThan(160);
        expect(row.contained).toBe(true);
        expect(row.overlapping).toBe(false);
      }
      await expect(rows.first().locator('.profile-score-main')).toContainText(scores[0].title);
      await expect(rows.first().locator('.profile-score-player')).toContainText(scores[0].username);
      await expect(rows.first().locator('.pp-value')).toContainText('0.00');
      if (width <= 600) {
        const image = page.locator('.home-character-image');
        await expect
          .poll(() => image.evaluate((image) => (image as HTMLImageElement).complete))
          .toBe(true);
        expect(
          await image.evaluate((image) => {
            const box = image.getBoundingClientRect();
            const frame = image.parentElement!.getBoundingClientRect();
            return box.left >= frame.left - 1 && box.right <= frame.right + 1;
          }),
        ).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await rows.first().getByRole('button').click();
      await expect(page.getByRole('menu').locator('a[href="/scores/7700"]')).toBeVisible();
      await expect(
        page.getByRole('menu').locator('a[href="/api/v1/scores/7700/replay"]'),
      ).toBeVisible();
    });
  }
}

test.describe('touch navigation', () => {
  test.use({ isMobile: true, hasTouch: true });
  for (const viewport of [
    { width: 390, height: 650 },
    { width: 320, height: 480 },
    { width: 700, height: 390 },
  ]) {
    test(`mobile navigation scrolls to its last link at ${viewport.width}x${viewport.height}`, async ({
      page,
      baseURL,
    }) => {
      await page.setViewportSize(viewport);
      await fixture(page, baseURL, 'dark');
      await page.goto('/');
      await expect(page.locator('.home-introduction a[href="/users/7800"]')).toBeVisible();
      await page.getByRole('button', { name: '開啟導覽', exact: true }).click();
      const dialog = page.getByRole('dialog');
      const nav = dialog.locator('.mobile-nav');
      await expect(nav).toBeVisible();
      await expect(nav.locator('a[href="/admin"]')).toBeVisible();
      expect(await nav.evaluate((nav) => nav.scrollHeight > nav.clientHeight)).toBe(true);
      const box = (await nav.boundingBox())!;
      const session = await page.context().newCDPSession(page);
      for (let swipe = 0; swipe < 3; swipe++) {
        const x = box.x + box.width / 2;
        const start = box.y + box.height - 25;
        const end = box.y + 25;
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x, y: start }],
        });
        for (let step = 1; step <= 10; step++) {
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x, y: start + ((end - start) * step) / 10 }],
          });
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      await session.detach();
      await expect.poll(() => nav.evaluate((nav) => nav.scrollTop)).toBeGreaterThan(0);
      const last = nav.locator('a').last();
      await expect(last).toBeInViewport();
      await expect(dialog.locator('[data-slot="sheet-header"]')).toBeInViewport();
      await expect(dialog.locator('[data-slot="sheet-close"]')).toBeInViewport();
      await last.tap();
      await expect(page).toHaveURL(/\/online$/);
      await expect(dialog).not.toBeVisible();
    });
  }
});
