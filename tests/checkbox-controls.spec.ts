import { expect, test, type Locator, type Page } from '@playwright/test';

// Synthetic HTTP and socket fixtures keep these checks separate from community data.
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture(page: Page, mode = 'dark') {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const unexpected: string[] = [];
  const errors: string[] = [];
  const state = {
    writes,
    preferenceLoad: null as ReturnType<typeof deferred> | null,
    writeGate: null as ReturnType<typeof deferred> | null,
  };
  const preferences = {
    mode,
    locale: 'en',
    accent_color: '#f28eb6',
    background_url: null,
    background_blur: 0,
    background_dim: 0.76,
    glass_level: 100,
    panel_blur: 8,
    panel_opacity: 0.55,
    border_radius: 14,
    pm_friends_only: false,
  };
  const user = {
    id: 98401,
    username: 'Checkbox operator',
    country: 'TW',
    bio: '',
    avatar_url: null,
    banner_url: null,
    accent_color: '#f28eb6',
    joined_at: '2026-10-10T00:00:00Z',
    permissions: ['admin.view', 'roles.manage', 'chat.send'],
    roles: ['checkbox_manager'],
    pp: 0,
    play_count: 0,
  };
  const roles = [
    { id: 1, name: 'player', permissions: ['chat.send'], is_builtin: true },
    { id: 2, name: 'administrator', permissions: ['*'], is_builtin: true },
    { id: 40, name: 'chat_helper', permissions: ['chat.send'], is_builtin: false },
  ].map((role) => ({ ...role, description: '', membership_count: 0 }));
  const player = {
    id: 98402,
    username: 'Checkbox target',
    country: 'TW',
    avatar_url: null,
    is_restricted: false,
    joined_at: user.joined_at,
    roles: [{ id: 900, name: 'archived_helper' }],
    can_manage_roles: true,
    can_moderate: false,
    can_revoke_sessions: false,
  };
  const collection = <T>(items: T[]) => ({ items, total: items.length, page: 1, page_size: 100 });
  page.on('pageerror', (error) => errors.push(error.message));
  await page
    .context()
    .addCookies([{ name: 'illya_locale', value: 'en', url: test.info().project.use.baseURL! }]);
  await page.routeWebSocket('**/api/v1/chat/stream', (socket) => {
    socket.send(JSON.stringify({ type: 'ready' }));
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const method = request.method();
    if (path === '/me') return route.fulfill({ json: user });
    if (path === '/me/preferences' && method === 'GET') {
      if (state.preferenceLoad) await state.preferenceLoad.promise;
      return route.fulfill({ json: preferences });
    }
    if (path === '/admin/users' && method === 'GET')
      return route.fulfill({ json: collection([player]) });
    if (path === '/admin/roles' && method === 'GET')
      return route.fulfill({ json: collection(roles) });
    if (path === '/channels' || path === '/conversations')
      return route.fulfill({ json: collection([]) });
    if (path === '/chat/status')
      return route.fulfill({
        json: { can_send: true, send_restriction: null, silenced_until: null },
      });
    if (
      (path === '/admin/users/98402' && method === 'PATCH') ||
      (path === '/admin/roles' && method === 'POST') ||
      (path === '/me/preferences' && method === 'PATCH')
    ) {
      const body = request.postDataJSON() as Record<string, unknown>;
      writes.push({ path, body });
      if (state.writeGate) await state.writeGate.promise;
      if (path === '/me/preferences') {
        Object.assign(preferences, body);
        return route.fulfill({ json: preferences });
      }
      if (path === '/admin/users/98402') {
        player.roles = (body.roles as number[]).map((id) => ({
          id,
          name: roles.find((role) => role.id === id)?.name ?? 'archived_helper',
        }));
      }
      return route.fulfill({ json: { ok: true } });
    }
    unexpected.push(`${method} ${path}`);
    return route.fulfill({ status: 501, json: { error: { code: 'unexpected_fixture_request' } } });
  });
  health.set(page, { unexpected, errors });
  return state;
}

const health = new WeakMap<Page, { unexpected: string[]; errors: string[] }>();
test.afterEach(async ({ page }) => {
  expect(health.get(page)?.unexpected).toEqual([]);
  expect(health.get(page)?.errors).toEqual([]);
});

async function compactControl(checkbox: Locator) {
  await expect(checkbox).toHaveAttribute('data-slot', 'checkbox');
  await expect(checkbox).toHaveCSS('width', '16px');
  await expect(checkbox).toHaveCSS('height', '16px');
  const before = await checkbox.boundingBox();
  await checkbox.hover();
  const after = await checkbox.boundingBox();
  expect(after?.width).toBe(before?.width);
  expect(after?.height).toBe(before?.height);
  await checkbox.focus();
  await checkbox.press('ArrowRight');
  await expect(checkbox).toHaveCSS('outline-width', '2px');
}

test('shared role checkboxes support keyboard and labels while preserving locked memberships', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/admin');
  const row = page.locator('.admin-user-row[data-user-id="98402"]');
  const helper = row.getByRole('checkbox', { name: 'chat_helper', exact: true });
  const archived = row.getByRole('checkbox', { name: 'archived_helper', exact: true });
  await expect(archived).toBeChecked();
  await expect(archived).toBeDisabled();
  await expect(row.getByRole('checkbox', { name: 'administrator', exact: true })).toBeDisabled();
  await compactControl(helper);
  await helper.press('Space');
  await expect(helper).toBeChecked();
  await row.locator(`label[for="${await helper.getAttribute('id')}"]`).click();
  await expect(helper).not.toBeChecked();
  await helper.press('Space');
  await expect(helper).toBeChecked();
  state.writeGate = deferred();
  try {
    await row.getByRole('button', { name: 'Save roles', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    await expect(helper).toBeDisabled();
    expect(state.writes[0]).toEqual({ path: '/admin/users/98402', body: { roles: [900, 40] } });
  } finally {
    state.writeGate.resolve();
  }
  await expect(helper).toBeEnabled();
  await expect(helper).toBeChecked();
});

test('shared permission checkboxes avoid accidental submit and disable during role creation', async ({
  page,
}) => {
  const state = await fixture(page, 'light');
  await page.goto('/admin');
  await page
    .locator('.admin-toolbar')
    .getByRole('button', { name: 'Roles & permissions', exact: true })
    .click();
  const form = page.locator('.admin-role-form');
  await form.getByLabel('Role name', { exact: true }).fill('checkbox_helper');
  await form.getByLabel('Description', { exact: true }).fill('Keyboard-selected permissions');
  const send = form.getByRole('checkbox', { name: 'chat.send', exact: true });
  await compactControl(send);
  await send.press('Enter');
  expect(state.writes).toEqual([]);
  await send.press('Space');
  await expect(send).toBeChecked();
  await expect(form.getByRole('checkbox', { name: 'users.moderate', exact: true })).toBeDisabled();
  state.writeGate = deferred();
  try {
    await form.getByRole('button', { name: 'Create role', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    await expect(send).toBeDisabled();
    expect(state.writes[0]).toEqual({
      path: '/admin/roles',
      body: {
        name: 'checkbox_helper',
        description: 'Keyboard-selected permissions',
        permissions: ['chat.send'],
      },
    });
  } finally {
    state.writeGate.resolve();
  }
  await expect(send).toBeEnabled();
  await expect(send).not.toBeChecked();
});

test('shared chat privacy checkbox retains load and save guards with a boolean-only update', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page);
  state.preferenceLoad = deferred();
  await page.goto('/chat');
  const navigation = page.locator('.chat-sidebar-toggle > button');
  await navigation.click();
  const checkbox = page.locator('#pm_friends_only');
  await expect(checkbox).toBeDisabled();
  state.preferenceLoad.resolve();
  await expect(checkbox).toBeEnabled();
  await compactControl(checkbox);
  await expect(checkbox).toHaveAccessibleDescription(/friends/i);
  state.writeGate = deferred();
  try {
    await checkbox.press('Space');
    await expect.poll(() => state.writes.length).toBe(1);
    await expect(checkbox).toBeChecked();
    await expect(checkbox).toBeDisabled();
    expect(state.writes[0]).toEqual({ path: '/me/preferences', body: { pm_friends_only: true } });
  } finally {
    state.writeGate.resolve();
  }
  await expect(checkbox).toBeEnabled();
  await expect(checkbox).toBeChecked();
});
