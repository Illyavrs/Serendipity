import { expect, test, type Locator, type Page } from '@playwright/test';
import { selectField } from './helpers/field-select';
import type { AdminReward, RewardState } from '../src/lib/rewards';
import type { Preferences } from '../src/lib/types';

// Synthetic intercepted accounts and rewards; no real player or database is changed.
const stamp = '2026-10-12T00:00:00Z';
const title: AdminReward = {
  id: 992101,
  name: 'Synthetic title',
  description: 'A plain text fixture.',
  kind: 'title',
  price: 15,
  color: '#f28eb6',
  style: null,
  active: true,
  revision: 2,
  owned_count: 0,
  created_at: stamp,
  updated_at: stamp,
};
const frame: AdminReward = {
  ...title,
  id: 992102,
  name: 'Retired fixture frame',
  kind: 'avatar_frame',
  style: 'double',
  active: false,
  owned_count: 1,
};
function playerState(): RewardState {
  return {
    balance: 0,
    week_start: '2026-10-11T16:00:00Z',
    resets_at: '2026-10-18T16:00:00Z',
    missions: [
      { key: 'play_5', goal: 5, progress: 5, reward: 20, claimed: false },
      { key: 'maps_3', goal: 3, progress: 2, reward: 20, claimed: false },
      { key: 'variety_2', goal: 2, progress: 1, reward: 20, claimed: false },
    ],
    inventory: [{ ...frame, acquired_at: stamp, paid: 15 }],
    equipment: { title: null, avatar_frame: null },
  };
}
async function fixture(
  page: Page,
  locale = 'en',
  permissions: string[] = [],
  appearance: Partial<Preferences> = {},
) {
  const preferences = {
    mode: 'dark',
    locale,
    accent_color: '#f28eb6',
    background_url: null,
    background_blur: 0,
    background_dim: 0.76,
    panel_blur: 8,
    panel_opacity: 0.55,
    glass_level: 100,
    border_radius: 14,
    ...appearance,
  };
  const store = {
    signedIn: true,
    viewerId: 992001,
    permissions,
    state: playerState(),
    publicCosmetics: { title: null, avatar_frame: null } as RewardState['equipment'],
    catalog: [structuredClone(title), structuredClone(frame)],
    writes: [] as { path: string; method: string; body: Record<string, unknown> }[],
    privateReads: 0,
    uncertainPurchase: false,
    adminReads: 0,
    stateFailure: 0,
    adminReadFailure: 0,
    adminWriteFailure: 0,
    changedWeek: false,
    holdState: false,
    releaseState: null as (() => void) | null,
  };
  await page
    .context()
    .addCookies([
      { name: 'illya_locale', value: locale, url: test.info().project.use.baseURL as string },
    ]);
  await page.addInitScript(
    (value) => localStorage.setItem('illya_appearance', JSON.stringify(value)),
    preferences,
  );
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    const failure = (status: number, code: string) =>
      route.fulfill({
        status,
        json: { error: { code, message: 'Untranslated server message must stay private' } },
      });
    const collection = (items: AdminReward[]) => {
      const page = Number(url.searchParams.get('page') ?? 1);
      const page_size = Number(url.searchParams.get('page_size') ?? 12);
      return {
        items: items.slice((page - 1) * page_size, page * page_size),
        page,
        page_size,
        total: items.length,
      };
    };
    if (path === '/me')
      return store.signedIn
        ? route.fulfill({
            json: {
              id: store.viewerId,
              username: `Synthetic player ${store.viewerId}`,
              country: 'TW',
              avatar_url: null,
              banner_url: null,
              accent_color: '#f28eb6',
              permissions: store.permissions,
              roles: [],
              pp: 0,
              play_count: 0,
              joined_at: stamp,
              bio: '',
            },
          })
        : failure(401, 'unauthorized');
    if (path === '/me/preferences') return route.fulfill({ json: preferences });
    if (path === '/me/relationships') return route.fulfill({ json: { friends: [], blocks: [] } });
    if (/^\/users\/\d+$/.test(path))
      return route.fulfill({
        json: {
          id: Number(path.split('/').at(-1)),
          username: 'Synthetic public reward player',
          country: 'TW',
          bio: '',
          avatar_url: null,
          banner_url: null,
          accent_color: '#f28eb6',
          joined_at: stamp,
          pp: 0,
          play_count: 0,
          roles: [],
          cosmetics: store.publicCosmetics,
        },
      });
    if (/^\/users\/\d+\/rank-history$/.test(path)) {
      const days = Number(url.searchParams.get('days') ?? 90);
      const start = new Date(stamp);
      start.setUTCDate(start.getUTCDate() - days + 1);
      return route.fulfill({
        json: {
          mode: Number(url.searchParams.get('mode') ?? 0),
          variant: url.searchParams.get('variant') ?? 'vanilla',
          days,
          start_date: start.toISOString().slice(0, 10),
          end_date: stamp.slice(0, 10),
          time_zone: 'UTC',
          collection_interval_seconds: 1800,
          last_captured_at: null,
          points: [],
        },
      });
    }
    if (path === '/me/rewards' && request.method() === 'GET') {
      store.privateReads++;
      if (store.stateFailure)
        return failure(
          store.stateFailure,
          store.stateFailure === 401 ? 'unauthorized' : 'forbidden',
        );
      const snapshot = structuredClone(store.state);
      if (store.holdState) {
        store.holdState = false;
        await new Promise<void>((resolve) => {
          store.releaseState = resolve;
        });
        return route.fulfill({ json: snapshot }).catch(() => {});
      }
      return route.fulfill({ json: snapshot });
    }
    if (path === '/rewards')
      return route.fulfill({ json: collection(store.catalog.filter((item) => item.active)) });
    if (path.startsWith('/me/rewards/') && request.method() !== 'GET') {
      const body = request.postDataJSON();
      store.writes.push({ path, method: request.method(), body });
      if (path.includes('/missions/')) {
        if (store.changedWeek) {
          store.changedWeek = false;
          store.state.week_start = '2026-10-18T16:00:00Z';
          return failure(409, 'mission_week_changed');
        }
        if (body.week_start !== store.state.week_start) return failure(409, 'mission_week_changed');
        const mission = store.state.missions.find((item) => path.includes(item.key))!;
        if (mission.progress < mission.goal) return failure(409, 'mission_incomplete');
        if (mission.claimed)
          return route.fulfill({ json: { state: store.state, idempotent: true } });
        mission.claimed = true;
        store.state.balance += mission.reward;
      } else if (path.endsWith('/purchases')) {
        const reward = store.catalog.find((item) => item.id === body.reward_id)!;
        if (body.revision !== reward.revision) return failure(409, 'reward_conflict');
        if (store.state.inventory.some((item) => item.id === reward.id))
          return route.fulfill({ json: { state: store.state, idempotent: true } });
        if (store.state.balance < reward.price) return failure(409, 'insufficient_stardust');
        store.state.balance -= reward.price;
        store.state.inventory.push({ ...reward, acquired_at: stamp, paid: reward.price });
        if (store.uncertainPurchase) {
          store.uncertainPurchase = false;
          return failure(503, 'service_unavailable');
        }
      } else if (path.endsWith('/equipment')) {
        expect(Object.keys(body).sort()).toEqual(['avatar_frame_id', 'title_id']);
        store.state.equipment = {
          title: store.state.inventory.find((item) => item.id === body.title_id) ?? null,
          avatar_frame:
            store.state.inventory.find((item) => item.id === body.avatar_frame_id) ?? null,
        };
      }
      return route.fulfill({ json: { state: store.state, idempotent: false } });
    }
    if (path === '/admin/rewards' && request.method() === 'GET') {
      store.adminReads++;
      if (store.adminReadFailure) return failure(store.adminReadFailure, 'forbidden');
      return route.fulfill({ json: collection(store.catalog) });
    }
    if (path.startsWith('/admin/rewards') && request.method() !== 'GET') {
      const body = request.postDataJSON();
      store.writes.push({ path, method: request.method(), body });
      const item = store.catalog.find((reward) => reward.id === Number(path.split('/').at(-1)));
      if (store.adminWriteFailure) {
        const status = store.adminWriteFailure;
        store.adminWriteFailure = 0;
        if (status === 409 && item) {
          item.name = 'Current catalog title';
          item.revision++;
        }
        return failure(status, status === 409 ? 'reward_conflict' : 'service_unavailable');
      }
      if (item && body.revision !== item.revision) return failure(409, 'reward_conflict');
      if (request.method() === 'DELETE') {
        if (item?.owned_count) return failure(409, 'reward_in_use');
        store.catalog = store.catalog.filter((reward) => reward.id !== item?.id);
        return route.fulfill({ json: { ok: true } });
      }
      if (item) {
        Object.assign(item, body, { revision: item.revision + 1 });
        return route.fulfill({ json: item });
      }
      const created = { ...title, ...body, id: 992103, revision: 0, owned_count: 0 } as AdminReward;
      store.catalog.push(created);
      return route.fulfill({ status: 201, json: created });
    }
    return route.fulfill({
      json: { items: [], total: 0, page: 1, page_size: 24, unread_count: 0 },
    });
  });
  return store;
}

test('claim, exchange and equip preserve the server balance and both equipment slots', async ({
  page,
}) => {
  const store = await fixture(page);
  await page.goto('/rewards');
  const mission = page.locator('[data-mission-key="play_5"]');
  await expect(mission).toBeVisible();
  await expect(
    page.locator('[data-mission-key="maps_3"]').getByRole('button', { name: 'Claim', exact: true }),
  ).toBeDisabled();
  await mission.getByRole('button', { name: 'Claim', exact: true }).click();
  await expect(mission.getByRole('button', { name: 'Claimed', exact: true })).toBeDisabled();
  expect(store.writes[0].body).toEqual({ week_start: '2026-10-11T16:00:00Z' });
  await page.getByRole('tab', { name: 'Shop', exact: true }).click();
  const reward = page.locator(`[data-reward-id="${title.id}"]`);
  await expect(reward.getByText('15 Stardust', { exact: true })).toBeVisible();
  await reward.getByRole('button', { name: 'Exchange', exact: true }).click();
  await expect(reward.getByRole('button', { name: 'Owned', exact: true })).toBeDisabled();
  expect(store.writes[1].body).toEqual({ reward_id: title.id, revision: 2 });
  expect(store.state.balance).toBe(5);
  await page.getByRole('tab', { name: 'Collection', exact: true }).click();
  await page
    .locator(`[data-reward-id="${title.id}"]`)
    .getByRole('button', { name: 'Equip', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Equipped rewards updated.');
  expect(store.writes.at(-1)?.body).toEqual({ title_id: title.id, avatar_frame_id: null });
  const retired = page.locator(`[data-reward-id="${frame.id}"]`);
  await expect(retired.getByText('This reward is delisted.', { exact: false })).toBeVisible();
  await retired.getByRole('button', { name: 'Equip', exact: true }).click();
  await expect(retired.getByRole('button', { name: 'Equipped', exact: true })).toBeDisabled();
  expect(store.writes.at(-1)?.body).toEqual({ title_id: title.id, avatar_frame_id: frame.id });
  await page.getByRole('button', { name: 'Unequip', exact: true }).first().click();
  await expect(page.getByText('No title equipped', { exact: true })).toBeVisible();
  expect(store.writes.at(-1)?.body).toEqual({ title_id: null, avatar_frame_id: frame.id });
});

test('a weekly reset conflict blocks stale claims until an explicit refresh', async ({ page }) => {
  const store = await fixture(page);
  store.changedWeek = true;
  await page.goto('/rewards');
  const claim = page
    .locator('[data-mission-key="play_5"]')
    .getByRole('button', { name: 'Claim', exact: true });
  await claim.click();
  await expect(page.locator('main').getByRole('alert')).toContainText('week');
  await expect(claim).toBeDisabled();
  await page.locator('main').getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(claim).toBeEnabled();
  await claim.click();
  await expect(page.getByRole('button', { name: 'Claimed', exact: true })).toBeVisible();
  expect(store.writes.at(-1)?.body.week_start).toBe('2026-10-18T16:00:00Z');
});

test('an exchange observes the displayed revision and refreshes a changed price before retrying', async ({
  page,
}) => {
  const store = await fixture(page);
  store.state.balance = 50;
  await page.goto('/rewards');
  await page.getByRole('tab', { name: 'Shop', exact: true }).click();
  const row = page.locator(`[data-reward-id="${title.id}"]`);
  await expect(row.getByText('15 Stardust', { exact: true })).toBeVisible();
  store.catalog[0].price = 25;
  store.catalog[0].revision = 3;
  await row.getByRole('button', { name: 'Exchange', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('Refresh the shop');
  await expect(row.getByRole('button', { name: 'Exchange', exact: true })).toBeDisabled();
  expect(store.state.balance).toBe(50);
  await page.locator('main').getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(row.getByText('25 Stardust', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Exchange', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Owned', exact: true })).toBeVisible();
  expect(store.writes.at(-1)?.body).toEqual({ reward_id: title.id, revision: 3 });
  expect(store.state.balance).toBe(25);
});

test('retrying an uncertain exchange displays the owned result without a second debit', async ({
  page,
}) => {
  const store = await fixture(page);
  store.state.balance = 50;
  store.uncertainPurchase = true;
  await page.goto('/rewards');
  await page.getByRole('tab', { name: 'Shop', exact: true }).click();
  const row = page.locator(`[data-reward-id="${title.id}"]`);
  await row.getByRole('button', { name: 'Exchange', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Exchange', exact: true })).toBeEnabled();
  await row.getByRole('button', { name: 'Exchange', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('You already own this reward.');
  await expect(row.getByRole('button', { name: 'Owned', exact: true })).toBeDisabled();
  expect(store.state.balance).toBe(35);
  expect(store.state.inventory.filter((reward) => reward.id === title.id)).toHaveLength(1);
  expect(store.writes).toHaveLength(2);
});

for (const status of [401, 403]) {
  test(`a ${status} refresh removes private rewards and never shows raw server errors`, async ({
    page,
  }) => {
    const store = await fixture(page);
    store.state.balance = 73;
    await page.goto('/rewards');
    await page.getByRole('tab', { name: 'Collection', exact: true }).click();
    await expect(page.locator(`[data-reward-id="${frame.id}"]`)).toBeVisible();
    store.stateFailure = status;
    if (status === 401) store.signedIn = false;
    await page.locator('main').getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.locator('[data-reward-id]')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Collection', exact: true })).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('73 Stardust');
    await expect(page.locator('body')).not.toContainText('Untranslated server message');
    if (status === 401)
      await expect(
        page.locator('main').getByRole('link', { name: 'Sign in to continue' }),
      ).toBeVisible();
    else {
      store.stateFailure = 0;
      await page.locator('main').getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect(page.getByRole('tab', { name: 'Collection', exact: true })).toBeVisible();
    }
  });
}

test('a late private response cannot restore the previous account wallet or collection', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (cause) => pageErrors.push(cause.message));
  await page.addInitScript(() => {
    const review = window as Window & { rewardUnhandled?: string[] };
    review.rewardUnhandled = [];
    window.addEventListener('unhandledrejection', (event) =>
      review.rewardUnhandled?.push(String(event.reason)),
    );
  });
  const store = await fixture(page);
  store.state.balance = 73;
  await page.goto('/rewards');
  await page.getByRole('tab', { name: 'Collection', exact: true }).click();
  await expect(page.locator(`[data-reward-id="${frame.id}"]`)).toBeVisible();
  store.holdState = true;
  await page.locator('main').getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => !!store.releaseState).toBeTruthy();
  store.viewerId = 992002;
  store.state = { ...playerState(), balance: 2, inventory: [] };
  // The existing session provider throttles focus revalidation for five seconds.
  await page.waitForTimeout(5100);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('main').getByText('2 Stardust', { exact: true })).toBeVisible();
  store.releaseState!();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.locator('main')).not.toContainText('73 Stardust');
  await page.getByRole('tab', { name: 'Collection', exact: true }).click();
  await expect(page.locator(`[data-reward-id="${frame.id}"]`)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your collection is empty' })).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(
    await page.evaluate(() => (window as Window & { rewardUnhandled?: string[] }).rewardUnhandled),
  ).toEqual([]);
});

test('a public profile displays equipped cosmetics safely and removes them when unequipped', async ({
  page,
}) => {
  const store = await fixture(page);
  store.signedIn = false;
  store.publicCosmetics = {
    title: { ...title, name: '<b>Fixture title</b>', color: '#456789', active: false },
    avatar_frame: { ...frame, color: '#123456', style: 'corners' },
  };
  await page.goto('/players/992003');
  const overview = page.locator('#profile-overview');
  const displayedTitle = overview.locator('[data-reward-title]');
  await expect(displayedTitle).toHaveText('<b>Fixture title</b>');
  await expect(displayedTitle.locator('b')).toHaveCount(0);
  await expect(displayedTitle).toHaveCSS('--reward-color', '#456789');
  const displayedFrame = overview.locator('[data-reward-frame]');
  await expect(displayedFrame).toHaveAttribute('data-reward-frame', 'corners');
  await expect(displayedFrame).toHaveCSS('--reward-color', '#123456');
  await expect(displayedFrame.locator('.avatar-large')).toBeVisible();
  expect(store.privateReads).toBe(0);
  store.publicCosmetics = { title: null, avatar_frame: null };
  await page.reload();
  await expect(
    overview.getByRole('heading', { name: 'Synthetic public reward player' }),
  ).toBeVisible();
  await expect(overview.locator('[data-reward-title]')).toHaveCount(0);
  await expect(overview.locator('[data-reward-frame]')).toHaveCount(0);
});

test('admin retains failed drafts, observes conflicts and explicitly reloads the latest revision', async ({
  page,
}) => {
  const store = await fixture(page, 'en', ['rewards.manage']);
  await page.goto('/admin?tab=rewards');
  await page
    .locator(`[data-reward-id="${title.id}"]`)
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  const form = page.getByRole('form', { name: 'Manage rewards' });
  await form.getByLabel('Name (1–32 characters)').fill('My retained draft');
  store.adminWriteFailure = 503;
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toBeVisible();
  await expect(form.getByLabel('Name (1–32 characters)')).toHaveValue('My retained draft');
  await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  store.adminWriteFailure = 409;
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(form.getByLabel('Name (1–32 characters)')).toHaveValue('My retained draft');
  await page.locator('main').getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(form.getByLabel('Name (1–32 characters)')).toHaveValue('My retained draft');
  await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await form.getByRole('button', { name: 'Load latest version', exact: true }).click();
  await expect(form.getByLabel('Name (1–32 characters)')).toHaveValue('Current catalog title');
  await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await form.getByLabel('Name (1–32 characters)').fill('Reviewed current draft');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Reward updated.');
  expect(store.writes.at(-1)?.body.revision).toBe(3);
  expect(store.writes.at(-1)?.body.name).toBe('Reviewed current draft');
  expect(store.writes.at(-1)?.body.style).toBeNull();
});

test('owned rewards cannot be deleted or change kind and can be delisted', async ({ page }) => {
  const store = await fixture(page, 'en', ['rewards.manage']);
  store.catalog[0].owned_count = 1;
  await page.goto('/admin?tab=rewards');
  const row = page.locator(`[data-reward-id="${title.id}"]`);
  await expect(row.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  const form = page.getByRole('form', { name: 'Manage rewards' });
  await expect(form.getByRole('combobox', { name: 'Reward type' })).toBeDisabled();
  await form.getByLabel('Published in the shop').uncheck();
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(row.getByText('Delisted', { exact: true })).toBeVisible();
  expect(store.writes.at(-1)?.body.active).toBe(false);
  expect(store.writes.at(-1)?.body.kind).toBe('title');
});

test('admin creates a frame with explicit optional fields and deletes using its observed revision', async ({
  page,
}) => {
  const store = await fixture(page, 'en', ['rewards.manage']);
  await page.goto('/admin?tab=rewards');
  const form = page.getByRole('form', { name: 'Manage rewards' });
  await form.getByLabel('Name (1–32 characters)').fill('Synthetic new frame');
  await form
    .getByLabel('Description (plain text, up to 300 characters)')
    .fill('New fixture description');
  await form.getByLabel('Price in Stardust (1–100,000)').fill('25');
  await selectField(form.getByRole('combobox', { name: 'Reward type' }), 'avatar_frame');
  await selectField(form.getByRole('combobox', { name: 'Frame style' }), 'corners');
  await form.getByLabel('Published in the shop').check();
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  const row = page.locator('[data-reward-id="992103"]');
  await expect(row).toBeVisible();
  expect(store.writes[0].body).toEqual({
    name: 'Synthetic new frame',
    description: 'New fixture description',
    kind: 'avatar_frame',
    price: 25,
    color: null,
    style: 'corners',
    active: true,
  });
  page.once('dialog', (dialog) => dialog.accept());
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(row).toHaveCount(0);
  expect(store.writes.at(-1)).toEqual({
    path: '/admin/rewards/992103',
    method: 'DELETE',
    body: { revision: 0 },
  });
  await expect(form.getByLabel('Name (1–32 characters)')).toHaveValue('');
});

test('an admin access denial clears both the catalog and the private editing draft', async ({
  page,
}) => {
  const store = await fixture(page, 'en', ['rewards.manage']);
  await page.goto('/admin?tab=rewards');
  await page
    .locator(`[data-reward-id="${title.id}"]`)
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await page.getByLabel('Name (1–32 characters)').fill('Private admin draft');
  store.adminReadFailure = 403;
  await page.locator('main').getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Manage rewards' })).toHaveCount(0);
  await expect(page.locator('[data-reward-id]')).toHaveCount(0);
  store.adminReadFailure = 0;
  await page.locator('main').getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByLabel('Name (1–32 characters)')).toHaveValue('');
});

test('deleting the final reward on a later page returns to the remaining catalog', async ({
  page,
}) => {
  const store = await fixture(page, 'en', ['rewards.manage']);
  store.catalog = Array.from({ length: 13 }, (_, index) => ({
    ...title,
    id: 992200 + index,
    name: `Page fixture ${index}`,
    owned_count: 0,
  }));
  await page.goto('/admin?tab=rewards');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const last = page.locator('[data-reward-id="992212"]');
  await expect(last).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await last.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('[data-reward-id="992200"]')).toBeVisible();
  await expect(page.locator('[data-reward-id]')).toHaveCount(12);
  await expect(page.getByRole('heading', { name: 'No rewards created yet.' })).toHaveCount(0);
});

test('guest and ordinary player views never fetch the rewards administration catalog', async ({
  page,
}) => {
  const store = await fixture(page);
  store.signedIn = false;
  await page.goto('/rewards');
  await expect(
    page.locator('main').getByRole('link', { name: 'Sign in to continue' }),
  ).toBeVisible();
  expect(store.privateReads).toBe(0);
  store.signedIn = true;
  await page.goto('/admin?tab=rewards');
  await expect(page.getByRole('form', { name: 'Manage rewards' })).toHaveCount(0);
  expect(store.adminReads).toBe(0);
});

for (const locale of ['en', 'zh-TW', 'ja']) {
  test(`rewards controls fit a phone in ${locale}`, async ({ page }) => {
    const store = await fixture(page, locale, ['rewards.manage']);
    store.catalog[0].description = 'https://example.test/'.repeat(12);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/rewards');
    await expect(page.locator('[data-mission-key]')).toHaveCount(3);
    await page.getByRole('tab').nth(1).click();
    await expect(page.locator(`[data-reward-id="${title.id}"]`)).toBeVisible();
    await expect(page.locator('body')).not.toContainText('rewards.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  });
  test(`reward administration controls fit a phone in ${locale}`, async ({ page }) => {
    const store = await fixture(page, locale, ['rewards.manage']);
    store.catalog[0].description = 'https://example.test/'.repeat(12);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/admin?tab=rewards');
    await expect(page.locator('#reward-name')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('rewards.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  });
}

test('collection type filters distinguish no matches from an empty collection', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/rewards');
  await page.getByRole('tab', { name: 'Collection', exact: true }).click();
  await selectField(page.getByRole('combobox', { name: 'Reward type' }), 'title');
  await expect(page.getByRole('heading', { name: 'No rewards of this type' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your collection is empty' })).toHaveCount(0);
});

test('a maximum-length title and frame fit desktop and small phone profiles', async ({ page }) => {
  const store = await fixture(page);
  store.signedIn = false;
  store.publicCosmetics = {
    title: { ...title, name: '稱'.repeat(32) },
    avatar_frame: { ...frame, style: 'corners' },
  };
  await page.goto('/users/992003');
  await expect(page.locator('#profile-overview [data-reward-title]')).toHaveText('稱'.repeat(32));
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  }
  await page.screenshot({
    path: '/workspace/.cloud-tools/rewards-review-profile-mobile.png',
    fullPage: true,
  });
});

async function expectTitleReadable(title: Locator) {
  await expect(title).toBeVisible();
  const presentation = await title.evaluate((node) => {
    const style = getComputedStyle(node);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    function luminance(color: string) {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
      const channels = [red, green, blue].map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return { value: channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722, alpha };
    }
    const foreground = luminance(style.color);
    const background = luminance(style.backgroundColor);
    return {
      contrast:
        (Math.max(foreground.value, background.value) + 0.05) /
        (Math.min(foreground.value, background.value) + 0.05),
      backgroundAlpha: background.alpha,
      fontSize: parseFloat(style.fontSize),
      borderColor: style.borderColor,
    };
  });
  // Readable even over a bright uploaded background or when an admin chooses black/white.
  expect(presentation.backgroundAlpha).toBe(255);
  expect(presentation.contrast).toBeGreaterThanOrEqual(4.5);
  expect(presentation.fontSize).toBeGreaterThanOrEqual(14);
  return presentation;
}

for (const mode of ['dark', 'light'] as const) {
  test(`title previews stay readable with default, black and white decoration colors in ${mode}`, async ({
    page,
  }) => {
    const store = await fixture(page, 'en', ['rewards.manage'], { mode });
    store.catalog = [null, '#000000', '#ffffff'].map((color, index) => ({
      ...title,
      id: title.id + index,
      color,
    }));
    await page.goto('/rewards');
    await page.getByRole('tab', { name: 'Shop', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(new RegExp(mode));
    for (const reward of store.catalog)
      await expectTitleReadable(
        page.locator(`[data-reward-id="${reward.id}"] [data-reward-title]`),
      );
    const defaultPreview = await expectTitleReadable(
      page.locator(`[data-reward-id="${title.id}"] [data-reward-title]`),
    );
    expect(defaultPreview.borderColor).toBe('rgb(242, 142, 182)');

    await page.goto('/admin?tab=rewards');
    const form = page.getByRole('form', { name: 'Manage rewards' });
    await form.getByLabel('Name (1–32 characters)').fill('Readable live preview');
    for (const color of ['', '#000000', '#ffffff']) {
      await form.getByLabel('Color', { exact: true }).fill(color);
      await expectTitleReadable(form.locator('[data-reward-title]'));
    }
  });
}

for (const glassLevel of [100, 0]) {
  test(`reward and admin panels follow appearance glass coverage ${glassLevel}`, async ({
    page,
  }) => {
    const store = await fixture(page, 'zh-TW', ['rewards.manage'], {
      glass_level: glassLevel,
      panel_blur: 14,
      panel_opacity: 0.55,
      background_url: '/media/backgrounds/glass-fixture.png',
      background_mode: 'image',
      background_dim: 0.3,
    });
    store.catalog[0].color = null;
    // An original geometric fixture makes the blur visible; it is never server/player data.
    await page.route('**/media/backgrounds/glass-fixture.png', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#655368"/><path d="M0 0H60V60H0ZM60 60H120V120H60Z" fill="#b397a3"/></svg>',
      }),
    );
    async function panelsFollowAppearance() {
      const panels = page.locator('main [data-material="content"]');
      await expect(panels.first()).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute(
        'data-glass-tier',
        glassLevel ? 'content' : 'navigation',
      );
      const surfaces = await panels.evaluateAll((nodes) =>
        nodes.map((node) => {
          const style = getComputedStyle(node);
          return { blur: style.backdropFilter, background: style.backgroundColor };
        }),
      );
      for (const surface of surfaces) {
        expect(surface.blur).toBe(`blur(${glassLevel ? 14 : 0}px)`);
        expect(surface.background).toBe(glassLevel ? 'rgba(24, 24, 27, 0.55)' : 'rgb(24, 24, 27)');
      }
    }
    await page.goto('/rewards');
    await expect(page.locator('[data-mission-key]')).toHaveCount(3);
    await panelsFollowAppearance();
    for (const tab of [1, 2]) {
      await page.getByRole('tab').nth(tab).click();
      await panelsFollowAppearance();
      if (glassLevel && tab === 1)
        await page.screenshot({
          path: '/workspace/.cloud-tools/rewards-glass-shop.png',
          fullPage: true,
        });
    }
    await page.goto('/admin?tab=rewards');
    await expect(page.locator('#reward-name')).toBeVisible();
    await panelsFollowAppearance();
    if (glassLevel) {
      await page.locator('#reward-name').fill('清楚的稱號預覽');
      await page.screenshot({
        path: '/workspace/.cloud-tools/rewards-glass-admin.png',
        fullPage: true,
      });
    }
  });
}
