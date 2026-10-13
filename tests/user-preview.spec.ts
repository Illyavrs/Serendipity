import { expect as baseExpect, test, type Page, type Route } from '@playwright/test';
import type { CardUser } from '../src/components/user-card';
const expect = baseExpect.configure({ timeout: 15_000 });

// Intercepted synthetic players. This suite never alters a real player or relationship.
const cards: CardUser[] = Array.from({ length: 8 }, (_, index) => ({
  id: 995001 + index,
  username: `Preview player ${index + 1}`,
  avatar_url: null,
  country: 'TW',
  banner_url: null,
  accent_color: '#f28eb6',
  online: index % 2 === 0,
  groups: [],
  cosmetics: { title: null, avatar_frame: null },
}));
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

async function fixture(page: Page, count = 8, loggedIn = false) {
  const visible = cards.slice(0, count);
  const state = {
    individual: [] as number[],
    batches: [] as number[][],
    writes: [] as string[],
    unavailable: new Set<number>(),
    pending: new Map<number, Route>(),
    hold: new Set<number>(),
  };
  await page
    .context()
    .addCookies([
      { name: 'illya_locale', value: 'en', url: test.info().project.use.baseURL as string },
    ]);
  await page.addInitScript(
    (value) => localStorage.setItem('illya_appearance', JSON.stringify(value)),
    preferences,
  );
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    if (request.method() !== 'GET') state.writes.push(`${request.method()} ${path}`);
    if (path === '/me')
      return route.fulfill(
        loggedIn
          ? {
              json: {
                ...cards[0],
                id: 995099,
                username: 'Preview viewer',
                bio: '',
                roles: [],
                permissions: ['social.manage', 'chat.send'],
                pp: 0,
                play_count: 0,
                joined_at: '2026-10-12T00:00:00Z',
              },
            }
          : { status: 401, json: { error: { code: 'unauthorized' } } },
      );
    if (path === '/me/preferences') return route.fulfill({ json: preferences });
    if (path === '/me/relationships')
      return route.fulfill({ json: { friends: [], blocks: [], friended_by: [] } });
    if (path === '/groups')
      return route.fulfill({
        json: {
          items: [
            {
              id: 995200,
              name: 'Preview test members',
              short_name: 'TEST',
              colour: '#f28eb6',
              icon: null,
              description: '',
              description_i18n: {},
              rank: 1,
              members: visible,
            },
          ],
        },
      });
    if (path === '/leaderboard')
      return route.fulfill({
        json: {
          items: visible.map((card, index) => ({
            ...card,
            rank: index + 1,
            pp: 1000,
            accuracy: 99,
            play_count: 10,
          })),
          total: visible.length,
          page: 1,
          page_size: 24,
        },
      });
    if (path === '/announcements')
      return route.fulfill({
        json: {
          items: visible.map((card) => ({
            id: card.id,
            title: `Announcement ${card.id}`,
            body: 'Synthetic news item',
            body_format: 'markdown',
            status: 'published',
            revision: 1,
            created_at: '2026-10-12T00:00:00Z',
            updated_at: '2026-10-12T00:00:00Z',
            published_at: '2026-10-12T00:00:00Z',
            author: { id: card.id, username: card.username, avatar_url: card.avatar_url },
          })),
          total: visible.length,
          page: 1,
          page_size: 12,
        },
      });
    if (path === '/users/cards') {
      const ids = (url.searchParams.get('ids') ?? '').split(',').map(Number);
      state.batches.push(ids);
      return route.fulfill({
        json: {
          items: cards.filter((card) => ids.includes(card.id) && !state.unavailable.has(card.id)),
        },
      });
    }
    const single = /^\/users\/(\d+)\/card$/.exec(path);
    if (single) {
      const id = Number(single[1]);
      state.individual.push(id);
      if (state.hold.has(id)) {
        state.pending.set(id, route);
        return;
      }
      const card = cards.find((item) => item.id === id);
      return route.fulfill(
        card && !state.unavailable.has(id)
          ? { json: card }
          : { status: 404, json: { error: { code: 'not_found' } } },
      );
    }
    return route.fulfill({ status: 404, json: { error: { code: 'synthetic_unavailable' } } });
  });
  return state;
}

function popup(page: Page) {
  return page.locator('[data-user-preview-card][data-open="true"]');
}
function trigger(page: Page, index = 0) {
  return page.locator(`a[data-user-preview][href^="/users/${cards[index].id}"]`).first();
}

test('identity hover opens a faded card beside the pointer, lazily and without recursion', async ({
  page,
}) => {
  const state = await fixture(page, 2);
  await page.goto('/groups', { waitUntil: 'domcontentloaded' });
  await expect(trigger(page)).toBeVisible();
  expect(state.individual).toEqual([]);
  expect(state.batches).toEqual([]);
  await trigger(page).hover();
  await expect(popup(page)).toBeVisible();
  await expect(trigger(page)).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(
    popup(page).getByRole('link', { name: cards[0].username, exact: true }),
  ).toBeVisible();
  expect(state.individual).toEqual([cards[0].id]);
  const visual = await popup(page).evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      opacity: styles.opacity,
      transition: styles.transitionDuration,
      material: styles.backdropFilter,
    };
  });
  expect(visual.transition).toContain('0.15s');
  expect(visual.material).toContain('blur(8px)');
  const bounds = await trigger(page).boundingBox();
  const floating = await popup(page).boundingBox();
  expect(floating!.x).toBeCloseTo(bounds!.x + bounds!.width / 2 + 12, 0);
  await popup(page).getByRole('link', { name: cards[0].username, exact: true }).hover();
  await expect(popup(page)).toBeVisible();
  await expect.poll(() => state.individual.length).toBe(1);
  expect(state.batches).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(popup(page)).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

test('avatar and username identity links on rankings and news reuse one batched lookup', async ({
  page,
}) => {
  const state = await fixture(page, 3);
  await page.goto('/rankings', { waitUntil: 'domcontentloaded' });
  await expect(trigger(page)).toBeVisible();
  await expect.poll(() => state.batches.flat().length).toBe(3);
  expect(state.batches).toHaveLength(1);
  await trigger(page).locator('[data-user-avatar]').hover();
  await expect(popup(page)).toHaveAttribute('aria-label', cards[0].username);
  await page.keyboard.press('Escape');
  await trigger(page, 1).hover();
  await expect(popup(page)).toHaveAttribute('aria-label', cards[1].username);
  expect(state.individual).toEqual([]);
  await page.goto('/news', { waitUntil: 'domcontentloaded' });
  await expect(trigger(page)).toBeVisible();
  await trigger(page).locator('[data-user-avatar]').hover();
  await expect(popup(page)).toHaveAttribute('aria-label', cards[0].username);
  expect(state.individual).toEqual([]);
});

test('a late response from a previous hover cannot replace the current player', async ({
  page,
}) => {
  const state = await fixture(page, 2);
  state.hold.add(cards[0].id);
  await page.goto('/groups', { waitUntil: 'domcontentloaded' });
  await trigger(page).hover();
  await expect.poll(() => state.pending.has(cards[0].id)).toBe(true);
  await trigger(page, 1).hover();
  await expect(popup(page)).toHaveAttribute('aria-label', cards[1].username);
  await state.pending.get(cards[0].id)!.fulfill({ json: cards[0] });
  await expect(popup(page)).toHaveAttribute('aria-label', cards[1].username);
  await page.mouse.move(2, 2);
  await expect(popup(page)).toHaveCount(0);
});

test('unavailable users never render a stale card and are negatively cached', async ({ page }) => {
  const state = await fixture(page, 2);
  state.unavailable.add(cards[1].id);
  await page.goto('/groups', { waitUntil: 'domcontentloaded' });
  await trigger(page).hover();
  await expect(popup(page)).toBeVisible();
  await trigger(page, 1).hover();
  await expect.poll(() => state.individual.includes(cards[1].id)).toBe(true);
  await expect(popup(page)).toHaveCount(0);
  await page.mouse.move(2, 2);
  await trigger(page, 1).hover();
  await expect(popup(page)).toHaveCount(0);
  expect(state.individual.filter((id) => id === cards[1].id)).toHaveLength(1);
});

test('keyboard focus can enter the card and Escape restores the identity link', async ({
  page,
}) => {
  const state = await fixture(page, 1);
  await page.goto('/groups', { waitUntil: 'domcontentloaded' });
  await trigger(page).focus();
  await expect(popup(page)).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(
    popup(page).getByRole('link', { name: cards[0].username, exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(popup(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  expect(state.individual).toEqual([cards[0].id]);
});

test('the interactive card menu stays usable through its portal and opens the correct chat', async ({
  page,
}) => {
  const state = await fixture(page, 1, true);
  await page.goto('/groups', { waitUntil: 'domcontentloaded' });
  await trigger(page).hover();
  await expect(popup(page)).toBeVisible();
  await popup(page).getByRole('button', { name: 'More actions', exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(popup(page)).toBeVisible();
  await page.getByRole('menuitem', { name: 'Message', exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/chat\\?recipient=${encodeURIComponent(cards[0].username)}`),
  );
  await expect(popup(page)).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

test('scroll, trigger removal and navigation dismiss an open preview', async ({ page }) => {
  await fixture(page, 2);
  await page.goto('/groups', { waitUntil: 'domcontentloaded' });
  await trigger(page).hover();
  await expect(popup(page)).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event('scroll')));
  await expect(popup(page)).toHaveCount(0);
  await page.mouse.move(2, 2);
  await trigger(page).hover();
  await expect(popup(page)).toBeVisible();
  await trigger(page).evaluate((element) => element.remove());
  await expect(popup(page)).toHaveCount(0);
  await trigger(page, 1).hover();
  await expect(popup(page)).toBeVisible();
  await page.getByRole('link', { name: 'Announcements', exact: true }).first().click();
  await expect(page).toHaveURL(/\/news$/);
  await expect(popup(page)).toHaveCount(0);
});

test('block confirmation text stays fully inside the hover card and its action works', async ({
  page,
}) => {
  const state = await fixture(page, 1, true);
  let blocked = false;
  await page.route('**/api/v1/me/relationships', (route) =>
    route.fulfill({
      json: {
        friends: [],
        blocks: blocked
          ? [{ target_id: cards[0].id, relation_type: 'block', mutual: false, target: cards[0] }]
          : [],
        friended_by: [],
      },
    }),
  );
  await page.route(`**/api/v1/me/relationships/${cards[0].id}`, async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({ relation_type: 'block' });
    state.writes.push(`POST /me/relationships/${cards[0].id}`);
    blocked = true;
    await route.fulfill({ status: 204 });
  });
  await page.goto('/groups', { waitUntil: 'domcontentloaded' });
  await trigger(page).hover();
  await expect(popup(page)).toBeVisible();
  await popup(page).getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Block player', exact: true }).click();
  const confirmation = popup(page).getByRole('group', { name: 'Block player', exact: true });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.locator('p')).toHaveText(
    'Blocking removes friendship in both directions and prevents in-game direct messages. Unblocking does not restore friendship.',
  );
  await expect
    .poll(() =>
      popup(page).evaluate((element) => {
        const cardBounds = element.getBoundingClientRect();
        const textBounds = element.querySelector('.card-menu-confirm p')!.getBoundingClientRect();
        return (
          textBounds.top >= cardBounds.top &&
          textBounds.bottom <= cardBounds.bottom &&
          textBounds.left >= cardBounds.left &&
          textBounds.right <= cardBounds.right
        );
      }),
    )
    .toBe(true);
  await confirmation.getByRole('button', { name: 'Confirm block', exact: true }).click();
  await expect.poll(() => state.writes).toEqual([`POST /me/relationships/${cards[0].id}`]);
  await expect(confirmation).toHaveCount(0);
  await expect(page).toHaveURL(/\/groups$/);
});

test('a card in a short viewport scrolls internally without dismissing', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 160 });
  await fixture(page, 1);
  await page.route(`**/api/v1/users/${cards[0].id}/card`, (route) =>
    route.fulfill({
      json: {
        ...cards[0],
        groups: Array.from({ length: 18 }, (_, index) => ({
          id: 995300 + index,
          name: `Synthetic role ${index}`,
          short_name: 'MOD',
          colour: '#88aaff',
          icon: 'shield',
        })),
      },
    }),
  );
  await page.goto('/groups', { waitUntil: 'domcontentloaded' });
  await trigger(page).scrollIntoViewIfNeeded();
  // Let the real page scroll settle before opening the keyboard preview. Moving a fixed
  // descendant of a backdrop-filter panel does not place it relative to the viewport.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await expect(trigger(page)).toBeInViewport();
  await trigger(page).evaluate((element) =>
    (element as HTMLElement).focus({ preventScroll: true }),
  );
  await expect(popup(page)).toBeVisible();
  await popup(page).evaluate((element) => {
    element.scrollTop = 20;
  });
  await expect.poll(() => popup(page).evaluate((element) => element.scrollTop)).toBe(20);
  await expect(popup(page)).toBeVisible();
  await expect
    .poll(async () => {
      const bounds = await popup(page).boundingBox();
      return bounds!.y + bounds!.height;
    })
    .toBeLessThanOrEqual(148);
  await page.evaluate(() => document.dispatchEvent(new Event('scroll')));
  await expect(popup(page)).toHaveCount(0);
});

test('a card near the bottom right stays inside the viewport and honors reduced motion', async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 420 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture(page, 1);
  await page.goto('/groups', { waitUntil: 'domcontentloaded' });
  await trigger(page).evaluate((element) => {
    Object.assign((element as HTMLElement).style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '44',
      background: '#17151a',
    });
  });
  await trigger(page).hover();
  await expect(popup(page)).toBeVisible();
  const bounds = await popup(page).boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(12);
  expect(bounds!.y).toBeGreaterThanOrEqual(12);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(628);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(408);
  const transition = await popup(page).evaluate(
    (element) => getComputedStyle(element).transitionDuration,
  );
  expect(transition).toBe('0s');
});

test('touch tapping identity links navigates without hover cards', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL as string,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const state = await fixture(page, 1);
  await page.goto('/groups', { waitUntil: 'domcontentloaded' });
  await trigger(page).tap();
  await expect(page).toHaveURL(new RegExp(`/users/${cards[0].id}$`));
  await expect(popup(page)).toHaveCount(0);
  expect(state.individual).toEqual([]);
  await context.close();
});
