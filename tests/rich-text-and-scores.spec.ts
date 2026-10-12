import { test, expect, type Page } from '@playwright/test';
import { selectField } from './helpers/field-select';
// Intercepted synthetic records only; no community writes.
async function fixture(page: Page, baseURL: string) {
  const user = {
    id: 987321,
    username: 'Rich text fixture',
    email: 'fixture@example.test',
    country: 'TW',
    bio: '',
    bio_format: 'markdown',
    permissions: [],
    roles: [],
    avatar_url: null,
    banner_url: null,
    accent_color: '#f28eb6',
    joined_at: '2026-10-12T00:00:00Z',
    pp: 0,
    play_count: 0,
  };
  const writes: Record<string, unknown>[] = [];
  await page.context().addCookies([{ name: 'illya_locale', value: 'en', url: baseURL }]);
  await page.route('**/api/v1/me', (route) => route.fulfill({ json: user }));
  await page.route('**/api/v1/me/preferences', (route) =>
    route.fulfill({
      json: {
        locale: 'en',
        mode: 'dark',
        accent_color: '#f28eb6',
        background_url: null,
        background_blur: 0,
        background_dim: 0.75,
        panel_blur: 8,
        panel_opacity: 0.55,
        border_radius: 14,
      },
    }),
  );
  await page.route('**/api/v1/me/profile', (route) => {
    const body = route.request().postDataJSON();
    writes.push(body);
    Object.assign(user, body);
    return route.fulfill({ json: user });
  });
  await page.route('**/api/v1/notifications?*', (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 24, unread_count: 0 } }),
  );
  return { user, writes };
}

test('visual editing converts formats, saves BBCode and survives reload', async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL!);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/settings?tab=profile');
  const visual = page.getByRole('textbox', { name: 'About you', exact: true });
  await expect(visual).toHaveAttribute('contenteditable', 'true');
  await visual.fill('Hello rich text');
  await visual.press('ControlOrMeta+A');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(visual.locator('strong')).toHaveText('Hello rich text');
  await selectField(page.getByRole('combobox', { name: 'Text format' }), 'bbcode');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'About you', exact: true })).toHaveValue(
    '[b]Hello rich text[/b]',
  );
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('[data-editor-format] .user-markdown strong')).toHaveText(
    'Hello rich text',
  );
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0]).toMatchObject({ bio: '[b]Hello rich text[/b]', bio_format: 'bbcode' });
  await page.reload();
  await expect(
    page.getByRole('textbox', { name: 'About you', exact: true }).locator('strong'),
  ).toHaveText('Hello rich text');
  expect(errors).toEqual([]);
});

test('BBCode preview is inert, images are links and styles survive visual mode', async ({
  page,
  baseURL,
}) => {
  await fixture(page, baseURL!);
  let images = 0;
  await page.route('**/tracker.example.test/**', (route) => {
    images++;
    return route.abort();
  });
  await page.goto('/settings?tab=profile');
  await selectField(page.getByRole('combobox', { name: 'Text format' }), 'bbcode');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  const source =
    '[b]Safe bold[/b]\n[color=#ff0000]Red[/color]\n[spoiler]Hidden[/spoiler]\n[url=javascript:alert(1)]Bad link[/url]\n[img]https://tracker.example.test/image.png[/img]\n<img src=x onerror="window.richTextExecuted=true">';
  await page.getByRole('textbox', { name: 'About you', exact: true }).fill(source);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.locator('[data-editor-format] .user-markdown');
  await expect(preview.locator('strong')).toHaveText('Safe bold');
  await expect(preview.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(preview.locator('img')).toHaveCount(0);
  await expect(preview.locator('details')).toHaveCount(1);
  expect(await page.evaluate(() => 'richTextExecuted' in window)).toBe(false);
  expect(images).toBe(0);
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'About you', exact: true }).getByText('Red', { exact: true }),
  ).toHaveCSS('color', 'rgb(255, 0, 0)');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'About you', exact: true })).toHaveValue(source);
});

test('replay menu icon and card spacing work on desktop and mobile', async ({ page, baseURL }) => {
  await fixture(page, baseURL!);
  await page.goto('/scores/resubmit');
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Resubmit a score', exact: true }).locator('svg'),
  ).toHaveCount(1);
  await page.keyboard.press('Escape');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const header = await page.locator('.site-header').boundingBox();
    const card = await page.locator('main section').boundingBox();
    expect(card!.y - (header!.y + header!.height)).toBeGreaterThanOrEqual(20);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('Top Plays shows canonical Miss counts without overlapping large pp', async ({
  page,
  baseURL,
}) => {
  await fixture(page, baseURL!);
  const scores = [1070.99, 100000.99].map((pp, i) => ({
    id: 987400 + i,
    user_id: 987321,
    username: 'Fixture player',
    beatmap_id: 22,
    title: 'Top score fixture',
    version: 'Long difficulty',
    mode: 0,
    score_variant: 'relax',
    score: 1000000,
    accuracy: 96.56,
    max_combo: 524,
    beatmap_max_combo: 554,
    mods: 192,
    pp,
    passed: true,
    verification: 'verified',
    moderation_revision: 0,
    client: 'stable',
    created_at: '2026-10-12T00:00:00Z',
    hit_counts: { n300: 382, n100: 18, n50: 1, misses: i ? 0 : 3 },
    has_replay: false,
    position: i + 1,
  }));
  await page.route('**/api/v1/leaderboard/top-plays?*', (route) =>
    route.fulfill({ json: { items: scores, total: 2, page: 1, page_size: 24 } }),
  );
  await page.goto('/rankings/top-plays');
  for (const width of [1488, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const rows = page.locator('.profile-score-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('[data-judgement="nmiss"] dd')).toHaveText('3');
    await expect(rows.nth(1).locator('[data-judgement="nmiss"] dd')).toHaveText('0');
    await expect(rows.nth(1).locator('.pp-value')).toContainText('100,000.99');
    if (width > 800) {
      const hits = await rows.nth(1).locator('.profile-score-statistics').boundingBox();
      const pp = await rows.nth(1).locator('.profile-score-performance').boundingBox();
      expect(hits!.x + hits!.width).toBeLessThanOrEqual(pp!.x);
      expect(
        await rows
          .nth(1)
          .locator('.pp-value')
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('editing an existing Markdown image keeps its source without loading external images', async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL!);
  state.user.bio = 'Introduction\n\n![Private image](https://tracker.example.test/image.png)';
  let images = 0;
  await page.route('**/tracker.example.test/**', (route) => {
    images++;
    return route.abort();
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/settings?tab=profile');
  const visual = page.getByRole('textbox', { name: 'About you', exact: true });
  await expect(
    visual.getByText('Image: https://tracker.example.test/image.png', { exact: true }),
  ).toBeVisible();
  await visual.press('ControlOrMeta+End');
  await visual.press('Enter');
  await visual.pressSequentially('After image');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'About you', exact: true })).toHaveValue(
    /!\[Private image\]\(https:\/\/tracker\.example\.test\/image\.png\)/,
  );
  expect(images).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await page.screenshot({ path: '/workspace/.cloud-tools/rich-editor-390.png', fullPage: true });
});

test('BBCode styling survives visual edits and converts to readable Markdown', async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL!);
  state.user.bio_format = 'bbcode';
  state.user.bio =
    '[color=#ff0000]Red[/color]\n\n[spoiler=Details]Hidden text[/spoiler]\n\n[table][tr][th]Name[/th][th]Value[/th][/tr][tr][td]Fixture[/td][td]42[/td][/tr][/table]';
  await page.goto('/settings?tab=profile');
  const visual = page.getByRole('textbox', { name: 'About you', exact: true });
  await expect(visual.locator('table')).toContainText('Fixture');
  await visual.locator('p').first().click();
  await visual.press('End');
  await visual.pressSequentially(' edited');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  const source = page.getByRole('textbox', { name: 'About you', exact: true });
  await expect(source).toHaveValue(/\[color=#ff0000\]Red edited\[\/color\]/);
  await expect(source).toHaveValue(/\[spoiler=Details\]Hidden text\[\/spoiler\]/);
  await expect(source).toHaveValue(/\[td\]42\[\/td\]/);
  await selectField(page.getByRole('combobox', { name: 'Text format' }), 'markdown');
  await expect(source).toHaveValue(/Red edited/);
  await expect(source).toHaveValue(/Hidden text/);
  await expect(source).toHaveValue(/Fixture.*42/);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('[data-editor-format] .user-markdown table')).toContainText('42');
});
