import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Notification } from '../src/lib/types';

const stamp = '2026-10-10T01:00:00Z';
const firstId = 990301;

async function capture(page: Page, name: string) {
  const folder = process.env.ILLYA_NOTIFICATION_CAPTURE_DIR;
  if (!folder) return;
  mkdirSync(folder, { recursive: true });
  await page.screenshot({ path: join(folder, `${name}.png`), fullPage: false });
}

async function observePollingClock(page: Page) {
  await page.clock.install();
  await page.addInitScript(() => {
    type ObservedTimer = {
      id: number;
      scheduled: number;
      fired: number | null;
      active: boolean;
      callback: string;
    };
    const observed = window as typeof window & { __notificationTimers: ObservedTimer[] };
    observed.__notificationTimers = [];
    const schedule = window.setTimeout.bind(window);
    const cancel = window.clearTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (timeout !== 30000 || typeof handler !== 'function')
        return schedule(handler, timeout, ...args);
      const timer: ObservedTimer = {
        id: 0,
        scheduled: Date.now(),
        fired: null,
        active: true,
        callback: handler.name,
      };
      timer.id = schedule(
        function (this: Window, ...values: unknown[]) {
          timer.fired = Date.now();
          timer.active = false;
          return handler.apply(this, values);
        },
        timeout,
        ...args,
      );
      observed.__notificationTimers.push(timer);
      return timer.id;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id?: number) => {
      const timer = observed.__notificationTimers.find((value) => value.id === id && value.active);
      if (timer) timer.active = false;
      cancel(id);
    }) as typeof window.clearTimeout;
  });
}

async function pollOnce(page: Page, label: string) {
  await page.bringToFront();
  const before = await page.evaluate(() => {
    const observed = window as typeof window & { __notificationTimers?: unknown[] };
    return {
      timers: observed.__notificationTimers,
      visible: document.visibilityState,
      online: navigator.onLine,
    };
  });
  await test.info().attach(`notification-poll-${label}-before`, {
    contentType: 'application/json',
    body: JSON.stringify(before),
  });
  await expect
    .poll(() =>
      page.evaluate(() => ({ visible: document.visibilityState, online: navigator.onLine })),
    )
    .toEqual({ visible: 'visible', online: true });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const observed = window as typeof window & { __notificationTimers?: { active: boolean }[] };
        return observed.__notificationTimers?.some((timer) => timer.active) ?? false;
      }),
    )
    .toBe(true);
  // Run the timer sequence and intervening microtasks in order. A jumped clock
  // alone does not establish whether polling ran or merely deduplicated a fetch.
  await page.clock.runFor(31000);
  const timers = await page.evaluate(() => {
    const observed = window as typeof window & { __notificationTimers?: unknown[] };
    return {
      timers: observed.__notificationTimers,
      visible: document.visibilityState,
      online: navigator.onLine,
    };
  });
  await test.info().attach(`notification-poll-${label}`, {
    contentType: 'application/json',
    body: JSON.stringify(timers),
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const observed = window as typeof window & {
          __notificationTimers?: { fired: number | null }[];
        };
        return observed.__notificationTimers?.some((timer) => timer.fired !== null) ?? false;
      }),
    )
    .toBe(true);
}

async function expectPageInset(page: Page) {
  const frame = await page.locator('.notification-page').boundingBox();
  const heading = await page.locator('.notification-page h1').boundingBox();
  const inbox = await page.locator('.notification-inbox').boundingBox();
  expect(frame).not.toBeNull();
  expect(heading).not.toBeNull();
  expect(inbox).not.toBeNull();
  expect(inbox!.x - frame!.x).toBeGreaterThanOrEqual(16);
  expect(heading!.x).toBeCloseTo(inbox!.x, 2);
  expect(inbox!.x + inbox!.width / 2).toBeCloseTo(frame!.x + frame!.width / 2, 1);
}

function notice(index: number): Notification {
  return {
    id: firstId + index,
    kind: index % 2 ? 'announcement_published' : 'rank_request_approved',
    title: `Synthetic notification ${index + 1}`,
    message: index % 2 ? 'Fixture server announcement.' : 'Fixture ranking decision.',
    href: index % 2 ? `/news/${990400 + index}` : `/beatmapsets/local-${2000000100 + index}`,
    created_at: stamp,
    read_at: null,
  };
}

// Every API request is intercepted. Tokens are opaque fixture memberships:
// these browser tests do not claim to validate server signatures or real events.
async function fixture(page: Page, count = 24) {
  const state = {
    signedIn: true,
    items: Array.from({ length: count }, (_, index) => notice(index)),
    listStatus: 0,
    reads: 0,
    lastSnapshot: '',
    snapshots: new Map<string, number[]>(),
    writes: [] as Record<string, unknown>[],
    arriveDuringRead: false,
    holdNextRead: false,
    releaseHeld: null as (() => void) | null,
  };
  await page
    .context()
    .addCookies([{ name: 'illya_locale', value: 'en', url: test.info().project.use.baseURL! }]);
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const fail = (status: number) =>
      route.fulfill({
        status,
        json: { error: { code: status === 401 ? 'unauthorized' : 'fixture_failure' } },
      });
    if (path === '/api/v1/me')
      return state.signedIn
        ? route.fulfill({
            json: {
              id: 990300,
              username: 'Synthetic notification viewer',
              country: 'TW',
              bio: '',
              avatar_url: null,
              banner_url: null,
              banner_position_x: 50,
              banner_position_y: 50,
              accent_color: '#f28eb6',
              roles: [],
              permissions: [],
              joined_at: stamp,
              pp: 0,
              play_count: 0,
            },
          })
        : fail(401);
    if (path === '/api/v1/me/preferences')
      return route.fulfill({
        json: {
          mode: 'dark',
          locale: 'en',
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
        },
      });
    if (path === '/api/v1/auth/logout') {
      expect(request.method()).toBe('POST');
      state.signedIn = false;
      return route.fulfill({ status: 204 });
    }
    if (path === '/api/v1/me/notifications' && request.method() === 'GET') {
      state.reads++;
      if (!state.signedIn) return fail(401);
      if (state.listStatus) return fail(state.listStatus);
      const currentPage = Number(url.searchParams.get('page') ?? 1);
      const pageSize = Number(url.searchParams.get('page_size') ?? 20);
      const unreadIds = state.items
        .filter((item) => !item.read_at)
        .map((item) => item.id)
        .slice(0, 1000);
      const token = `opaque.fixture.snapshot.${state.reads}.not-an-integer`;
      state.snapshots.set(token, unreadIds);
      state.lastSnapshot = token;
      const response = {
        items: structuredClone(
          state.items.slice((currentPage - 1) * pageSize, currentPage * pageSize),
        ),
        total: state.items.length,
        page: currentPage,
        page_size: pageSize,
        unread_count: state.items.filter((item) => !item.read_at).length,
        snapshot_id: token,
        snapshot_size: unreadIds.length,
      };
      if (state.holdNextRead) {
        state.holdNextRead = false;
        await new Promise<void>((resolve) => {
          state.releaseHeld = resolve;
        });
      }
      return route.fulfill({ json: response });
    }
    if (path === '/api/v1/me/notifications/read') {
      expect(request.method()).toBe('POST');
      if (!state.signedIn) return fail(401);
      const body = request.postDataJSON() as Record<string, unknown>;
      state.writes.push(body);
      const ids = Array.isArray(body.ids)
        ? (body.ids as number[])
        : (state.snapshots.get(String(body.through_id)) ?? []);
      if (state.arriveDuringRead) {
        state.arriveDuringRead = false;
        state.items.unshift(notice(count));
      }
      let updated = 0;
      for (const item of state.items) {
        if (ids.includes(item.id) && !item.read_at) {
          item.read_at = stamp;
          updated++;
        }
      }
      return route.fulfill({
        json: { updated, unread_count: state.items.filter((item) => !item.read_at).length },
      });
    }
    return fail(404);
  });
  return state;
}

test('signed-in bell and inbox propagate read responses across pagination', async ({ page }) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/notifications');
  const inbox = page.locator('.notification-inbox');
  await expect(inbox.locator('.notification-rows > li')).toHaveCount(20);
  await expect(
    page.getByRole('button', { name: 'Notifications, 24 unread', exact: true }),
  ).toBeVisible();
  await capture(page, 'notifications-desktop-inbox');
  await inbox
    .getByRole('button', { name: 'Mark “Synthetic notification 1” as read', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Notifications, 23 unread', exact: true }),
  ).toBeVisible();
  await expect(
    inbox.getByRole('button', { name: 'Mark “Synthetic notification 1” as read', exact: true }),
  ).toHaveCount(0);
  expect(state.writes).toEqual([{ ids: [firstId] }]);
  await inbox.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(inbox.locator('.notification-rows > li')).toHaveCount(4);
  await expect(
    inbox.getByRole('link', { name: 'Synthetic notification 21', exact: true }),
  ).toBeVisible();
  await inbox.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(inbox.locator('.notification-rows > li')).toHaveCount(20);
  await expect(
    inbox.getByRole('button', { name: 'Mark “Synthetic notification 1” as read', exact: true }),
  ).toHaveCount(0);
});

test('one bulk click consumes only its opaque snapshot and a new arrival requires another click', async ({
  page,
}) => {
  const state = await fixture(page, 1001);
  await page.goto('/notifications');
  const inbox = page.locator('.notification-inbox');
  await expect(
    page.getByRole('button', { name: 'Notifications, 1001 unread', exact: true }),
  ).toBeVisible();
  const originalSnapshot = state.lastSnapshot;
  state.arriveDuringRead = true;
  await inbox.getByRole('button', { name: 'Mark 1,000 as read', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Notifications, 2 unread', exact: true }),
  ).toBeVisible();
  await expect(
    inbox.getByRole('link', { name: 'Synthetic notification 1002', exact: true }),
  ).toBeVisible();
  await expect(inbox.getByRole('status')).toContainText('More unread notifications remain.');
  expect(state.writes).toEqual([{ through_id: originalSnapshot }]);
  const refreshedSnapshot = state.lastSnapshot;
  expect(refreshedSnapshot).not.toBe(originalSnapshot);
  await inbox.getByRole('button', { name: 'Mark all read', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Notifications, 0 unread', exact: true }),
  ).toBeVisible();
  expect(state.writes).toEqual([
    { through_id: originalSnapshot },
    { through_id: refreshedSnapshot },
  ]);
});

test('a late private response after logout never restores the feed or unread badge', async ({
  page,
}) => {
  await observePollingClock(page);
  const state = await fixture(page, 3);
  await page.goto('/notifications');
  await expect(
    page.getByRole('button', { name: 'Notifications, 3 unread', exact: true }),
  ).toBeVisible();
  state.holdNextRead = true;
  await pollOnce(page, 'held-before-logout');
  await expect.poll(() => state.releaseHeld !== null).toBe(true);
  try {
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
    await expect(page.locator('.notification-bell')).toHaveCount(0);
    state.releaseHeld?.();
    state.releaseHeld = null;
    await expect(page.locator('.notification-title')).toHaveCount(0);
    await page.goto('/notifications');
    await expect(
      page.getByRole('heading', { name: 'Sign in to continue', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.notification-title')).toHaveCount(0);
    await expect(page.locator('.notification-count')).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
  } finally {
    state.releaseHeld?.();
  }
});

test('500 and 401 revalidation failures hide previously loaded private notices', async ({
  page,
}) => {
  await observePollingClock(page);
  const state = await fixture(page, 3);
  for (const status of [500, 401]) {
    state.listStatus = 0;
    await page.goto('/notifications');
    const inbox = page.locator('.notification-inbox');
    await expect(inbox.locator('.notification-title')).toHaveCount(3);
    state.listStatus = status;
    await pollOnce(page, `status-${status}`);
    await expect(inbox.getByRole('alert')).toContainText(
      status === 401 ? 'Your session has expired.' : "The server couldn't complete your request.",
    );
    await expect(page.locator('.notification-title')).toHaveCount(0);
    await expect(page.locator('.notification-count')).toHaveCount(0);
    if (status === 500) {
      state.listStatus = 0;
      await inbox.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect(inbox.locator('.notification-title')).toHaveCount(3);
    } else
      await expect(
        inbox.getByRole('link', { name: 'Sign in to continue', exact: true }),
      ).toBeVisible();
  }
  expect(state.writes).toHaveLength(0);
});

test('mobile popover supports keyboard dismissal without scroll movement or hover fetching', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/notifications');
  const bell = page.getByRole('button', { name: 'Notifications, 24 unread', exact: true });
  await expect(bell).toBeVisible();
  await expect(page.locator('.notification-inbox .notification-rows > li')).toHaveCount(20);
  await expectPageInset(page);
  await capture(page, 'notifications-desktop-inset');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectPageInset(page);
  const before = await page.locator('.header-inner').boundingBox();
  const reads = state.reads;
  await bell.hover();
  await page.locator('h1').hover();
  await bell.hover();
  expect(state.reads).toBe(reads);
  await bell.focus();
  await page.keyboard.press('Enter');
  const popup = page.getByRole('dialog', { name: 'Notifications', exact: true });
  await expect(popup).toBeVisible();
  await expect(popup.locator('.notification-title')).toHaveCount(5);
  await expect(popup.getByRole('button', { name: 'Mark all read', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    popup.getByRole('link', { name: 'Synthetic notification 1', exact: true }),
  ).toBeFocused();
  const bounds = await popup.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  const after = await page.locator('.header-inner').boundingBox();
  expect(after!.x).toBeCloseTo(before!.x, 2);
  expect(after!.width).toBeCloseTo(before!.width, 2);
  await capture(page, 'notifications-mobile-popover');
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await expect(bell).toBeFocused();
  await capture(page, 'notifications-mobile-inbox');
  expect(state.reads).toBe(reads);
  expect(state.writes).toHaveLength(0);
});
