import { expect, test } from '@playwright/test';

// Intercepted score data only; this test never submits or changes community records.
test('lazer source remains readable beside mods in dark, light and phone layouts', async ({ page }) => {
  const id = 988641;
  const beatmap = {
    id: 988642,
    official_id: null,
    title: 'Lazer badge fixture',
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
    download_url: '/api/v1/beatmaps/988642/download',
    download_kind: 'osu',
    package: null,
  };
  await page.context().addCookies([
    { name: 'illya_locale', value: 'en', url: process.env.ILLYA_WEB_URL ?? 'http://localhost:3000' },
  ]);
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/me')
      return route.fulfill({ status: 401, json: { error: { code: 'authentication_required' } } });
    if (path === `/api/v1/scores/${id}`)
      return route.fulfill({
        json: {
          id,
          user_id: 988643,
          username: 'Badge fixture player',
          beatmap_id: beatmap.id,
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
          created_at: '2026-10-09T00:00:00Z',
          has_replay: false,
          client: 'lazer',
          hit_counts: { n300: 199, n100: 1 },
          accuracy_source: 'client_reported',
          replay_url: null,
          user: { id: 988643, username: 'Badge fixture player', country: 'TW', avatar_url: null },
          beatmap,
        },
      });
    return route.fulfill({ status: 404, json: { error: { code: 'fixture_missing' } } });
  });
  await page.goto(`/scores/${id}`);
  const origin = page.getByRole('img', { name: 'Played in osu!lazer', exact: true });
  await expect(origin).toHaveAttribute('title', 'Played in osu!lazer');
  await expect(origin).toHaveText('lazer');
  await expect(origin.locator('.score-origin-lazer')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.score-detail-values .score-mod-summary')).toContainText('DT');

  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['dark', 'light']) {
      // Exercise the shipped theme tokens without persisting any user appearance setting.
      await page.evaluate((selectedTheme) => {
        document.documentElement.classList.remove('dark', 'light');
        document.documentElement.classList.add(selectedTheme);
      }, theme);
      await expect(origin).toBeVisible();
      const geometry = await origin.evaluate((element) => {
        const badge = element.querySelector('.score-origin-lazer')!;
        const rect = badge.getBoundingClientRect();
        const icon = badge.querySelector('svg')!.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          fontSize: getComputedStyle(badge).fontSize,
          iconWidth: icon.width,
          iconHeight: icon.height,
          fitsViewport: rect.left >= 0 && rect.right <= innerWidth,
          noPageOverflow: document.documentElement.scrollWidth <= innerWidth,
        };
      });
      expect(geometry.width).toBeGreaterThanOrEqual(39);
      expect(geometry.width).toBeLessThanOrEqual(60);
      expect(geometry.height).toBeLessThanOrEqual(20);
      expect(geometry.fontSize).toBe('10px');
      expect(geometry.iconWidth).toBe(12);
      expect(geometry.iconHeight).toBe(12);
      expect(geometry.fitsViewport).toBe(true);
      expect(geometry.noPageOverflow).toBe(true);
    }
  }
});
