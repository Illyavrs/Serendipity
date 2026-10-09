import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import path from 'node:path';

// Synthetic browser fixtures only: no community account, server state or native client is changed.
const serverEpoch = Date.UTC(2026, 9, 9, 15, 0);
const viewer = 98341;
const peer = 98342;
type FixtureMessage = {
  id: number;
  channel_id: number;
  user_id: number;
  username: string;
  avatar_url: null;
  content: string;
  created_at: string;
  is_action: boolean;
  client_uuid: string | null;
};
const message = (id: number, channel: number, content: string, userId = peer): FixtureMessage => ({
  id,
  channel_id: channel,
  user_id: userId,
  username: userId === peer ? 'Illya fixture' : 'Chat fixture',
  avatar_url: null,
  content,
  created_at: new Date(serverEpoch).toISOString(),
  is_action: false,
  client_uuid: null,
});

async function fixture(page: Page, locale = 'en', guest = false) {
  const state = {
    userId: guest ? null : (viewer as number | null),
    permissions: ['chat.send'],
    now: serverEpoch,
    until: null as number | null,
    statusFail: false,
    statusGate: null as Promise<void> | null,
    statusOverride: null as Record<string, unknown> | null,
    statusUsers: [] as (number | null)[],
    sockets: [] as WebSocketRoute[],
    sends: [] as { channel: number; content: string; client_uuid: string }[],
    reads: [] as number[],
    failSend: false,
    nextId: 100,
    transcripts: {
      1: [message(1, 1, 'Public history fixture')],
      2: [message(2, 2, 'Help history fixture')],
      101: [message(3, 101, 'Private history fixture')],
    } as Record<number, FixtureMessage[]>,
  };
  const status = () => {
    const silenced = state.until !== null && state.until > state.now;
    const restriction = !state.permissions.includes('chat.send')
      ? 'no_permission'
      : silenced
        ? 'silenced'
        : null;
    return {
      can_send: restriction === null,
      send_restriction: restriction,
      silenced_until: silenced ? new Date(state.until!).toISOString() : null,
      server_time: new Date(state.now).toISOString(),
    };
  };
  const conversation = () => ({
    id: 101,
    peer: { id: peer, username: 'Illya fixture', avatar_url: null },
    last_message: state.transcripts[101].at(-1),
    last_read_id: 0,
    unread_count: 1,
    ...status(),
  });
  const collection = <T>(items: T[]) => ({ items, total: items.length, page: 1, page_size: 100 });
  await page
    .context()
    .addCookies([{ name: 'illya_locale', value: locale, url: test.info().project.use.baseURL! }]);
  await page.routeWebSocket('**/api/v1/chat/stream', (socket) => {
    state.sockets.push(socket);
    socket.send(JSON.stringify({ type: 'ready' }));
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const endpoint = url.pathname.replace('/api/v1', '');
    if (endpoint === '/me')
      return state.userId === null
        ? route.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } })
        : route.fulfill({
            json: {
              id: state.userId,
              username: state.userId === viewer ? 'Chat fixture' : 'Second account fixture',
              email: 'chat@example.test',
              country: 'TW',
              bio: '',
              avatar_url: null,
              banner_url: null,
              accent_color: '#f28eb6',
              banner_position_x: 50,
              banner_position_y: 50,
              roles: [],
              permissions: state.permissions,
              joined_at: '2026-10-07T00:00:00Z',
              pp: 0,
              play_count: 0,
            },
          });
    if (endpoint === '/me/preferences')
      return route.fulfill({
        json: {
          locale,
          mode: 'dark',
          accent_color: '#f28eb6',
          background_url: null,
          background_blur: 0,
          background_dim: 0.76,
          panel_blur: 8,
          panel_opacity: 0.55,
          border_radius: 14,
          pm_friends_only: false,
        },
      });
    if (endpoint === '/chat/status') {
      state.statusUsers.push(state.userId);
      const result = state.statusOverride ?? status();
      const fail = state.statusFail;
      if (state.statusGate) await state.statusGate;
      return route
        .fulfill(
          fail ? { status: 503, json: { error: { code: 'unavailable' } } } : { json: result },
        )
        .catch(() => undefined);
    }
    if (endpoint === '/channels')
      return route.fulfill({
        json: collection([
          { id: 1, name: '#general', description: 'Public channel fixture' },
          { id: 2, name: '#help', description: 'Connection help fixture' },
        ]),
      });
    if (endpoint === '/conversations') return route.fulfill({ json: collection([conversation()]) });
    if (endpoint === '/conversations/101') return route.fulfill({ json: conversation() });
    if (endpoint === '/chat/visibility')
      return route.fulfill({ json: { message_ids: request.postDataJSON().message_ids } });
    if (endpoint === '/conversations/101/read') {
      state.reads.push(request.postDataJSON().message_id);
      return route.fulfill({ status: 204 });
    }
    const history = /^\/(channels|conversations)\/(\d+)\/messages$/.exec(endpoint);
    if (history) {
      const channel = Number(history[2]);
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        state.sends.push({ channel, ...body });
        if (state.failSend)
          return route.fulfill({ status: 503, json: { error: { code: 'unavailable' } } });
        if (!status().can_send)
          return route.fulfill({
            status: 403,
            json: {
              error: {
                code: status().send_restriction === 'silenced' ? 'chat_silenced' : 'no_permission',
              },
            },
          });
        const accepted = {
          ...message(state.nextId++, channel, body.content, state.userId!),
          client_uuid: body.client_uuid,
        };
        state.transcripts[channel].push(accepted);
        return route.fulfill({ json: accepted });
      }
      return route.fulfill({ json: collection(state.transcripts[channel] ?? []) });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'fixture_route_missing' } } });
  });
  const refresh = () => state.sockets.at(-1)?.send(JSON.stringify({ type: 'refresh' }));
  return { state, refresh };
}

const composer = (page: Page) => page.locator('.chat-compose textarea');
const send = (page: Page) => page.locator('.chat-compose button[type="submit"]');
const notice = (page: Page) => page.locator('[data-chat-send-notice]');
async function open(page: Page) {
  await page.goto('/chat');
  await expect(page.locator('.messages')).toContainText('Public history fixture');
  await expect(composer(page)).toBeVisible();
}

test('a live silence blocks public and private sends, keeps drafts and incoming/read navigation', async ({
  page,
}) => {
  const { state, refresh } = await fixture(page);
  await open(page);
  await composer(page).fill('Keep public draft');
  await expect(send(page)).toBeEnabled();
  state.until = state.now + 600000;
  refresh();
  await expect(notice(page)).toContainText('Sending messages is paused until');
  await expect(send(page)).toBeDisabled();
  await expect(composer(page)).toHaveValue('Keep public draft');
  await composer(page).press('Enter');
  expect(state.sends).toHaveLength(0);
  await page.locator('[data-conversation-id="101"]').click();
  await expect(page.locator('.messages')).toContainText('Private history fixture');
  await composer(page).fill('Keep private draft');
  await expect(send(page)).toBeDisabled();
  const incoming = message(4, 101, 'Incoming while silenced');
  state.transcripts[101].push(incoming);
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'messages', items: [incoming] }));
  await expect(page.locator('.messages')).toContainText('Incoming while silenced');
  await expect.poll(() => state.reads.includes(4)).toBe(true);
  await page.locator('[data-channel-id="2"]').first().click();
  await expect(page.locator('.messages')).toContainText('Help history fixture');
  await page.locator('[data-channel-id="1"]').first().click();
  await expect(composer(page)).toHaveValue('Keep public draft');
  state.until = null;
  refresh();
  await expect(send(page)).toBeEnabled();
  await send(page).click();
  await expect(composer(page)).toHaveValue('');
  expect(state.sends[0].content).toBe('Keep public draft');
});

test('expiry uses the server clock with a client clock years behind and requires a successful refresh', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2001-01-01T00:00:00Z') });
  const { state } = await fixture(page);
  state.until = state.now + 5000;
  await open(page);
  await composer(page).fill('Retained expiry draft');
  await expect(notice(page)).toContainText('00:00:05 remaining');
  state.statusFail = true;
  state.now += 5000;
  await page.clock.fastForward(6000);
  await expect(notice(page)).toContainText('Checking whether sending can resume');
  await expect(notice(page)).toContainText('Cannot confirm sending permission');
  await expect(send(page)).toBeDisabled();
  await expect(composer(page)).toHaveValue('Retained expiry draft');
  state.statusFail = false;
  await notice(page).getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(send(page)).toBeEnabled();
  await expect(notice(page)).toHaveCount(0);
});

test('natural expiry restores sending without an event when the server confirms it', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2050-01-01T00:00:00Z') });
  const { state } = await fixture(page);
  state.until = state.now + 3000;
  await open(page);
  await composer(page).fill('Natural expiry draft');
  await expect(send(page)).toBeDisabled();
  const before = state.statusUsers.length;
  state.now += 3000;
  await page.clock.fastForward(4000);
  await expect(send(page)).toBeEnabled();
  expect(state.statusUsers.length).toBeGreaterThan(before);
  await expect(composer(page)).toHaveValue('Natural expiry draft');
});

test('role denial takes precedence and lifting silence does not restore a revoked role', async ({
  page,
}) => {
  const { state, refresh } = await fixture(page);
  await open(page);
  await composer(page).fill('Permission draft');
  state.until = state.now + 600000;
  state.permissions = [];
  refresh();
  await expect(notice(page)).toContainText('Your account cannot send chat messages');
  await expect(notice(page)).not.toContainText('Sending messages is paused');
  await expect(send(page)).toBeDisabled();
  state.until = null;
  refresh();
  await expect(notice(page)).toContainText('Your account cannot send chat messages');
  await expect(composer(page)).toHaveValue('Permission draft');
  state.permissions = ['chat.send'];
  refresh();
  await expect(send(page)).toBeEnabled();
});

test('a failed status refresh blocks sending until retry and preserves the draft', async ({
  page,
}) => {
  const { state, refresh } = await fixture(page);
  await open(page);
  await composer(page).fill('Status error draft');
  await expect(send(page)).toBeEnabled();
  state.statusFail = true;
  refresh();
  await expect(notice(page)).toContainText('Cannot confirm sending permission');
  await expect(send(page)).toBeDisabled();
  await expect(composer(page)).toHaveValue('Status error draft');
  await expect(page.locator('.messages')).toContainText('Public history fixture');
  state.statusFail = false;
  await notice(page).getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(send(page)).toBeEnabled();
});

test('malformed allowed status cannot grant sending', async ({ page }) => {
  const { state } = await fixture(page);
  state.statusOverride = {
    can_send: true,
    send_restriction: null,
    silenced_until: null,
    server_time: 2026,
  };
  await open(page);
  await composer(page).fill('Malformed status draft');
  await expect(notice(page)).toContainText('Cannot confirm sending permission');
  await expect(send(page)).toBeDisabled();
  state.statusOverride = { ...state.statusOverride, server_time: '2026' };
  await notice(page).getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(notice(page)).toContainText('Cannot confirm sending permission');
  await expect(send(page)).toBeDisabled();
  state.statusOverride = null;
  await notice(page).getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(send(page)).toBeEnabled();
});

test('incoming message bursts do not abort or starve a pending status check', async ({ page }) => {
  const { state, refresh } = await fixture(page);
  await open(page);
  await composer(page).fill('Message burst draft');
  await expect(send(page)).toBeEnabled();
  let release!: () => void;
  state.statusGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const before = state.statusUsers.length;
  refresh();
  await expect.poll(() => state.statusUsers.length).toBeGreaterThan(before);
  const pending = state.statusUsers.length;
  for (let i = 0; i < 30; i++) {
    const incoming = message(200 + i, 1, `Burst incoming ${i}`);
    state.transcripts[1].push(incoming);
    state.sockets.at(-1)!.send(JSON.stringify({ type: 'messages', items: [incoming] }));
  }
  await expect(page.locator('.messages')).toContainText('Burst incoming 29');
  expect(state.statusUsers.length).toBe(pending);
  state.statusGate = null;
  release();
  await expect(send(page)).toBeEnabled();
  await expect(composer(page)).toHaveValue('Message burst draft');
});

test('server-side admission denial and network failure retain a message draft', async ({
  page,
}) => {
  const { state } = await fixture(page);
  await open(page);
  await composer(page).fill('Server rejected draft');
  await expect(send(page)).toBeEnabled();
  state.until = state.now + 600000;
  await send(page).click();
  await expect(page.locator('.chat-error[role="alert"]')).toContainText(
    'You are currently silenced',
  );
  await expect(notice(page)).toContainText('Sending messages is paused until');
  await expect(composer(page)).toHaveValue('Server rejected draft');
  state.until = null;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(send(page)).toBeEnabled();
  state.failSend = true;
  await send(page).click();
  await expect(page.locator('.chat-error[role="alert"]')).toBeVisible();
  await expect(composer(page)).toHaveValue('Server rejected draft');
});

test('account changes clear the old account status and drafts, including a delayed response', async ({
  page,
}) => {
  const { state, refresh } = await fixture(page);
  await open(page);
  await composer(page).fill('Private account draft');
  let release!: () => void;
  state.statusGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.until = state.now + 600000;
  const before = state.statusUsers.length;
  refresh();
  await expect.poll(() => state.statusUsers.length).toBeGreaterThan(before);
  state.userId = viewer + 10;
  state.until = null;
  state.statusGate = null;
  refresh();
  await expect(page.locator('.user-link')).toContainText('Second account fixture');
  release();
  await expect(composer(page)).toHaveValue('');
  await expect(notice(page)).toHaveCount(0);
  await composer(page).fill('Second account draft');
  await expect(send(page)).toBeEnabled();
  expect(state.statusUsers).toContain(viewer + 10);
});

test('guests never query authenticated status and keep public history available', async ({
  page,
}) => {
  const { state } = await fixture(page, 'en', true);
  await page.goto('/chat');
  await expect(page.locator('.messages')).toContainText('Public history fixture');
  await expect(composer(page)).toHaveCount(0);
  expect(state.statusUsers).toHaveLength(0);
});

test('periodic status refresh catches a policy change without a live event', async ({ page }) => {
  await page.clock.install();
  const { state } = await fixture(page);
  await open(page);
  await composer(page).fill('Periodic draft');
  await expect(send(page)).toBeEnabled();
  state.until = state.now + 600000;
  await page.clock.fastForward(31000);
  await expect(notice(page)).toContainText('Sending messages is paused until');
  await expect(send(page)).toBeDisabled();
});

for (const locale of ['zh-TW', 'ja'])
  test(`timed restriction remains localized and compact in ${locale}`, async ({ page }) => {
    const { state } = await fixture(page, locale);
    state.until = state.now + 600000;
    await open(page);
    await expect(notice(page)).toContainText(
      locale === 'zh-TW' ? '暫停傳送訊息至' : 'メッセージの送信が停止されています',
    );
    await composer(page).fill('保持中的草稿');
    await expect(send(page)).toBeDisabled();
    if (process.env.ILLYA_CHAT_SILENCE_CAPTURE && locale === 'zh-TW') {
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      });
      await page.screenshot({
        path: path.join(process.env.ILLYA_CHAT_SILENCE_CAPTURE, 'chat-silenced-desktop.png'),
        fullPage: true,
        animations: 'disabled',
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
      await expect(notice(page)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: path.join(process.env.ILLYA_CHAT_SILENCE_CAPTURE, 'chat-silenced-mobile.png'),
        fullPage: true,
        animations: 'disabled',
      });
    }
  });
