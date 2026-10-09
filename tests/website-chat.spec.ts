import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';

// All accounts, transcripts and socket events here are synthetic intercepted fixtures.
// This file never changes an existing community account or starts a native game.
type ChatMessage = {
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
const viewer = 98641;
const peer = 98642;
function message(
  id: number,
  channel = 101,
  content = `測試訊息 ${id}`,
  sender = peer,
): ChatMessage {
  return {
    id,
    channel_id: channel,
    user_id: sender,
    username: sender === viewer ? 'Website chat fixture' : 'Illya fixture',
    avatar_url: null,
    content,
    created_at: new Date(Date.UTC(2026, 9, 8, 1, 0, id)).toISOString(),
    is_action: false,
    client_uuid: null,
  };
}

async function fixture(page: Page, locale = 'zh-TW', mode = 'dark', guest = false) {
  const preferences = {
    locale,
    mode,
    accent_color: '#f28eb6',
    background_url: null,
    background_blur: 0,
    background_dim: 0.76,
    panel_blur: 8,
    panel_opacity: 0.55,
    border_radius: 14,
    pm_friends_only: false,
  };
  const user = {
    id: viewer,
    username: 'Website chat fixture',
    email: 'chat@example.test',
    country: 'TW',
    bio: '',
    avatar_url: null,
    banner_url: null,
    accent_color: '#f28eb6',
    banner_position_x: 50,
    banner_position_y: 50,
    roles: [],
    permissions: ['chat.send'],
    joined_at: '2026-10-07T00:00:00Z',
    pp: 0,
    play_count: 0,
  };
  const transcripts: Record<number, ChatMessage[]> = {
    1: [message(900, 1, 'Public channel fixture'), message(901, 1, 'Public follow-up fixture')],
    2: [message(902, 2, 'Second channel fixture')],
    101: Array.from({ length: 205 }, (_, i) => message(i + 1)),
    102: [message(600, 102, 'Second conversation fixture')],
  };
  const state = {
    user,
    sessionExpired: false,
    preferences,
    transcripts,
    sockets: [] as WebSocketRoute[],
    sends: [] as { channel: number; body: Record<string, unknown> }[],
    preferenceWrites: [] as Record<string, unknown>[],
    reads: [] as number[],
    readRequests: [] as { conversation: number; marker: number; viewer: number }[],
    readGates: {} as Partial<Record<number, Promise<void>>>,
    receipts: new Map<string, Set<number>>(),
    lastReads: new Map<string, number>(),
    creates: [] as string[],
    conversationOrder: [101, 102],
    metadataReads: [] as number[],
    metadataStatus: {} as Record<number, number>,
    metadataGates: {} as Partial<Record<number, Promise<void>>>,
    readStatus: {} as Record<number, number>,
    historyReads: [] as { channel: number; before: number | null }[],
    historyGates: {} as Partial<Record<string, Promise<void>>>,
    hidden: new Set<number>(),
    visibilityStatus: 200,
    denied: new Set<number>(),
    canSend: true,
    failCreate: false,
    failPreference: false,
    ambiguousOnce: false,
    gate: null as Promise<void> | null,
    nextId: 1000,
  };
  const conversation = (id: number) => ({
    id,
    peer: {
      id: id === 101 ? peer : peer + 1,
      username: id === 101 ? 'Illya fixture' : 'Miyu fixture',
      avatar_url: null,
    },
    last_message:
      state.transcripts[id]
        ?.filter((item) => !state.hidden.has(item.id))
        .toSorted((a, b) => a.id - b.id)
        .at(-1) ?? null,
    last_read_id: state.lastReads.get(`${state.user.id}:${id}`) ?? 0,
    unread_count: (state.transcripts[id] ?? []).filter(
      (item) =>
        item.user_id !== state.user.id &&
        !state.hidden.has(item.id) &&
        !state.receipts.get(`${state.user.id}:${id}`)?.has(item.id),
    ).length,
    can_send: state.canSend,
    send_restriction: state.canSend ? null : 'friend_only',
    silenced_until: null,
  });
  const collection = <T>(items: T[], total = items.length) => ({
    items,
    total,
    page: 1,
    page_size: 100,
  });
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
    const pathname = url.pathname.replace('/api/v1', '');
    const method = request.method();
    if (pathname === '/me')
      return guest || state.sessionExpired
        ? route.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } })
        : route.fulfill({ json: user });
    if (pathname === '/me/preferences') {
      if (method === 'PATCH') {
        const body = request.postDataJSON();
        state.preferenceWrites.push(body);
        if (state.failPreference)
          return route.fulfill({ status: 503, json: { error: { code: 'unavailable' } } });
        Object.assign(preferences, body);
      }
      return route.fulfill({ json: preferences });
    }
    if (pathname === '/chat/status')
      return guest || state.sessionExpired
        ? route.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } })
        : route.fulfill({
            json: {
              can_send: user.permissions.includes('chat.send'),
              send_restriction: user.permissions.includes('chat.send') ? null : 'no_permission',
              silenced_until: null,
              server_time: new Date().toISOString(),
            },
          });
    if (pathname === '/channels')
      return route.fulfill({
        json: collection([
          { id: 1, name: '#general', description: 'Public channel fixture' },
          { id: 2, name: '#help', description: 'Connection help fixture' },
        ]),
      });
    if (pathname === '/conversations' && method === 'GET') {
      const ids = state.conversationOrder.filter((id) => !state.denied.has(id));
      const pageSize = Number(url.searchParams.get('page_size') ?? 50);
      const currentPage = Number(url.searchParams.get('page') ?? 1);
      return route.fulfill({
        json: collection(
          ids.slice((currentPage - 1) * pageSize, currentPage * pageSize).map(conversation),
          ids.length,
        ),
      });
    }
    if (pathname === '/conversations' && method === 'POST') {
      state.creates.push(request.postDataJSON().target_username);
      if (state.failCreate)
        return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
      return route.fulfill({ json: conversation(101) });
    }
    if (pathname === '/chat/visibility') {
      const ids = request.postDataJSON().message_ids as number[];
      expect(ids.length).toBeLessThanOrEqual(256);
      if (state.visibilityStatus !== 200)
        return route.fulfill({
          status: state.visibilityStatus,
          json: { error: { code: 'fixture_visibility_unavailable' } },
        });
      return route.fulfill({ json: { message_ids: ids.filter((id) => !state.hidden.has(id)) } });
    }
    const metadata = /^\/conversations\/(\d+)$/.exec(pathname);
    if (metadata) {
      const id = Number(metadata[1]);
      state.metadataReads.push(id);
      const status = state.metadataStatus[id] ?? (state.denied.has(id) ? 404 : 200);
      const snapshot = conversation(id);
      if (state.metadataGates[id]) await state.metadataGates[id];
      return status === 200
        ? route.fulfill({ json: snapshot })
        : route.fulfill({ status, json: { error: { code: 'fixture_metadata_unavailable' } } });
    }
    const read = /^\/conversations\/(\d+)\/read$/.exec(pathname);
    if (read) {
      const id = Number(read[1]);
      const marker = request.postDataJSON().message_id as number;
      const reader = state.user.id;
      state.readRequests.push({ conversation: id, marker, viewer: reader });
      const status = state.readStatus[id] ?? 204;
      if (status !== 204)
        return route.fulfill({ status, json: { error: { code: 'fixture_read_denied' } } });
      // A receipt covers this request's committed, visible snapshot. A smaller
      // ID inserted while its response is delayed needs a second equal marker.
      const snapshot = (state.transcripts[id] ?? []).filter(
        (item) => item.id <= marker && item.user_id !== reader && !state.hidden.has(item.id),
      );
      if (state.readGates[id]) await state.readGates[id];
      const receiptKey = `${reader}:${id}`;
      const receipts = state.receipts.get(receiptKey) ?? new Set<number>();
      snapshot.forEach((item) => receipts.add(item.id));
      state.receipts.set(receiptKey, receipts);
      state.lastReads.set(receiptKey, Math.max(state.lastReads.get(receiptKey) ?? 0, marker));
      state.reads.push(marker);
      return route.fulfill({ status: 204 }).catch(() => undefined);
    }
    const history = /^\/(channels|conversations)\/(\d+)\/messages$/.exec(pathname);
    if (history) {
      const channel = Number(history[2]);
      if (state.denied.has(channel))
        return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
      if (method === 'POST') {
        const body = request.postDataJSON();
        state.sends.push({ channel, body });
        if (state.gate) await state.gate;
        let persisted = Object.values(transcripts)
          .flat()
          .find((item) => item.client_uuid === body.client_uuid);
        if (!persisted) {
          persisted = {
            ...message(state.nextId++, channel, body.content.trim(), viewer),
            client_uuid: body.client_uuid,
            is_action: body.is_action ?? false,
          };
          state.transcripts[channel].push(persisted);
        }
        if (state.ambiguousOnce) {
          state.ambiguousOnce = false;
          return route.fulfill({ status: 503, json: { error: { code: 'unavailable' } } });
        }
        return route.fulfill({ json: persisted });
      }
      const visible = (transcripts[channel] ?? [])
        .filter((item) => !state.hidden.has(item.id))
        .toSorted((a, b) => a.id - b.id);
      const before = Number(url.searchParams.get('before_id') ?? Infinity);
      const after = Number(url.searchParams.get('after_id') ?? 0);
      state.historyReads.push({ channel, before: Number.isFinite(before) ? before : null });
      const response = collection(
        visible.filter((item) => item.id < before && item.id > after).slice(-100),
        visible.length,
      );
      if (state.historyGates[`${channel}:${before}`])
        await state.historyGates[`${channel}:${before}`];
      return route.fulfill({
        json: response,
      });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'fixture_route_missing' } } });
  });
  return state;
}

async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  });
  await page.mouse.move(0, 0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  if (name.startsWith('mobile-')) {
    const action = await page.locator('.chat-compose, .chat-login').boundingBox();
    expect(action).not.toBeNull();
    expect(action!.y + action!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    const history = await page.locator('.messages').boundingBox();
    expect(history!.height).toBeGreaterThanOrEqual(80);
  }
  if (process.env.ILLYA_CAPTURE_WORKFLOW_REVIEW === '1')
    await page.screenshot({
      path: `../../.impeccable/review/website-chat-${name}.png`,
      fullPage: true,
      animations: 'disabled',
    });
}

async function selectPrivate(page: Page, id = 101) {
  await expandNavigation(page);
  await page.locator(`.conversation-list button[data-conversation-id="${id}"]`).click();
  await expect(page.locator('.messages')).toHaveAttribute('data-channel-id', String(id));
}

async function expandNavigation(page: Page) {
  await expect(page.locator('.chat-layout')).toBeVisible();
  const toggle = page.locator('.chat-sidebar-toggle button');
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false')
    await toggle.click();
}

async function settleReadEffects(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

// This controls browser focus eligibility without depending on a headless
// runner's operating-system window focus. The rendered UI and request flow run normally.
async function setReadFocus(page: Page, focused: boolean) {
  await page.evaluate((value) => {
    const fixtureWindow = window as unknown as { chatFixtureFocused: boolean };
    fixtureWindow.chatFixtureFocused = value;
    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value: () => fixtureWindow.chatFixtureFocused,
    });
    window.dispatchEvent(new Event(value ? 'focus' : 'blur'));
  }, focused);
}

test('a focused late lower ID receives one equal marker and duplicate or outgoing events stay quiet', async ({
  page,
}) => {
  const state = await fixture(page, 'en');
  state.transcripts[101] = [message(4000)];
  await page.goto('/chat');
  await setReadFocus(page, true);
  await selectPrivate(page);
  await expect.poll(() => state.reads).toEqual([4000]);
  const unread = page.locator('[data-conversation-id="101"] .conversation-unread');
  await expect(unread).toHaveCount(0);

  const late = message(3999, 101, 'Lower ID committed after the visible marker');
  state.transcripts[101].push(late);
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'messages', items: [late] }));
  await expect(page.locator('.messages')).toContainText(late.content);
  await expect.poll(() => state.reads).toEqual([4000, 4000]);
  expect(state.receipts.get(`${viewer}:101`)).toEqual(new Set([4000, 3999]));
  await expect(unread).toHaveCount(0);

  const outgoing = message(
    4001,
    101,
    'Already read incoming history with a new outgoing echo',
    viewer,
  );
  state.transcripts[101].push(outgoing);
  const refreshed = page.waitForResponse((response) =>
    response.url().includes('/conversations/101/messages?'),
  );
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'messages', items: [late, late, outgoing] }));
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'refresh' }));
  await refreshed;
  await expect(page.locator('.message[data-message-id="3999"]')).toHaveCount(1);
  await expect(page.locator('.messages')).toContainText(outgoing.content);
  await settleReadEffects(page);
  expect(state.readRequests.map((item) => item.marker)).toEqual([4000, 4000]);
});

test('an incoming lower ID discovered by REST refresh receives an equal marker', async ({
  page,
}) => {
  const state = await fixture(page, 'en');
  state.transcripts[101] = [message(4100)];
  await page.goto('/chat');
  await setReadFocus(page, true);
  await selectPrivate(page);
  await expect.poll(() => state.reads).toEqual([4100]);
  const late = message(4099, 101, 'Recovered lower ID without a live message frame');
  state.transcripts[101].push(late);
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'refresh' }));
  await expect(page.locator('.messages')).toContainText(late.content);
  await expect.poll(() => state.reads).toEqual([4100, 4100]);
});

test('a lower-ID arrival keeps a long visible history at bottom before acknowledging it', async ({
  page,
}) => {
  const state = await fixture(page, 'en');
  state.transcripts[101] = Array.from({ length: 100 }, (_, index) => message(4601 + index));
  await page.goto('/chat');
  await setReadFocus(page, true);
  await selectPrivate(page);
  await expect.poll(() => state.reads).toEqual([4700]);
  const late = message(4600, 101, 'Lower ID inserted above a long message history');
  state.transcripts[101].push(late);
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'messages', items: [late] }));
  await expect(page.locator('.message[data-message-id="4600"]')).toBeAttached();
  await expect.poll(() => state.reads).toEqual([4700, 4700]);
  const distance = await page
    .locator('.messages')
    .evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight);
  expect(distance).toBeLessThan(40);
});

test('failed visibility checks and recovery do not mint equal-marker retry loops', async ({
  page,
}) => {
  const state = await fixture(page, 'en');
  state.transcripts[101] = [message(4800)];
  await page.goto('/chat');
  await setReadFocus(page, true);
  await selectPrivate(page);
  await expect.poll(() => state.reads).toEqual([4800]);
  await expect(page.locator('[data-conversation-id="101"] .conversation-unread')).toHaveCount(0);
  state.visibilityStatus = 503;
  const late = message(
    4799,
    101,
    'Visible receipt arrival during failed authorization revalidation',
  );
  state.transcripts[101].push(late);
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'messages', items: [late] }));
  await expect.poll(() => state.reads).toEqual([4800, 4800]);
  await expect(page.locator('.messages')).toContainText(late.content);
  for (const status of [503, 503, 200]) {
    state.visibilityStatus = status;
    const refreshed = page.waitForResponse((response) =>
      response.url().includes('/conversations/101/messages?'),
    );
    state.sockets.at(-1)!.send(JSON.stringify({ type: 'refresh' }));
    await refreshed;
    await expect(page.locator('.messages')).toContainText(late.content);
    await settleReadEffects(page);
    expect(state.readRequests.map((item) => item.marker)).toEqual([4800, 4800]);
  }
});

test('restored authority queues a fresh generation behind an obsolete in-flight read', async ({
  page,
}) => {
  const state = await fixture(page, 'en');
  state.transcripts[101] = [message(4900)];
  let release!: () => void;
  state.readGates[101] = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.goto('/chat');
  await setReadFocus(page, true);
  await selectPrivate(page);
  await expect.poll(() => state.readRequests.length).toBe(1);
  state.conversationOrder = [102];
  state.metadataStatus[101] = 403;
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'refresh' }));
  await expect(page.locator('.conversation-list [data-conversation-id="101"]')).toHaveCount(0);
  await expect(page.locator('.messages')).not.toContainText('測試訊息 4900');
  const late = message(4899, 101, 'Lower ID observed after conversation authority was restored');
  state.transcripts[101].push(late);
  state.conversationOrder = [101, 102];
  state.metadataStatus[101] = 200;
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'refresh' }));
  await expect(page.locator('.messages')).toContainText(late.content);
  await settleReadEffects(page);
  expect(state.readRequests.length).toBe(1);
  delete state.readGates[101];
  release();
  await expect.poll(() => state.reads).toEqual([4900, 4900]);
  expect(state.receipts.get(`${viewer}:101`)).toEqual(new Set([4900, 4899]));
});

for (const eligibility of ['closed', 'unfocused'] as const) {
  test(`an equal-marker obligation waits while its thread is ${eligibility}, including an in-flight response`, async ({
    page,
  }) => {
    const state = await fixture(page, 'en');
    state.transcripts[101] = [message(4200)];
    let release!: () => void;
    state.readGates[101] = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.goto('/chat');
    await setReadFocus(page, true);
    await selectPrivate(page);
    await expect.poll(() => state.readRequests.length).toBe(1);
    const late = message(4199, 101, `Lower ID waiting in a ${eligibility} thread`);
    state.transcripts[101].push(late);
    state.sockets.at(-1)!.send(JSON.stringify({ type: 'messages', items: [late] }));
    await expect(page.locator('.messages')).toContainText(late.content);
    await settleReadEffects(page);
    if (eligibility === 'closed') await page.locator('[data-channel-id="1"]').first().click();
    else await setReadFocus(page, false);
    const ineligible = message(4198, 101, `Arrived while the thread was already ${eligibility}`);
    state.transcripts[101].push(ineligible);
    state.sockets.at(-1)!.send(JSON.stringify({ type: 'messages', items: [ineligible] }));
    delete state.readGates[101];
    release();
    await expect.poll(() => state.reads).toEqual([4200]);
    await expect(page.locator('[data-conversation-id="101"] .conversation-unread')).toHaveText('2');
    await settleReadEffects(page);
    expect(state.readRequests).toEqual([{ conversation: 101, marker: 4200, viewer }]);
    expect(state.receipts.get(`${viewer}:101`)?.has(4199)).toBe(false);
    expect(state.receipts.get(`${viewer}:101`)?.has(4198)).toBe(false);

    if (eligibility === 'closed') await selectPrivate(page);
    else await setReadFocus(page, true);
    await expect.poll(() => state.reads).toEqual([4200, 4200]);
    await expect(page.locator('[data-conversation-id="101"] .conversation-unread')).toHaveCount(0);
  });
}

test('a new lower ID during an in-flight marker requires a fresh receipt snapshot', async ({
  page,
}) => {
  const state = await fixture(page, 'en');
  state.transcripts[101] = [message(4300)];
  let release!: () => void;
  state.readGates[101] = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.goto('/chat');
  await setReadFocus(page, true);
  await selectPrivate(page);
  await expect.poll(() => state.readRequests.length).toBe(1);
  const late = message(4299, 101, 'Arrived after the first receipt snapshot');
  state.transcripts[101].push(late);
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'messages', items: [late, late] }));
  await expect(page.locator('.messages')).toContainText(late.content);
  await settleReadEffects(page);
  expect(state.readRequests.length).toBe(1);
  delete state.readGates[101];
  release();
  await expect.poll(() => state.reads).toEqual([4300, 4300]);
  expect(state.receipts.get(`${viewer}:101`)).toEqual(new Set([4300, 4299]));
  await expect(page.locator('[data-conversation-id="101"] .conversation-unread')).toHaveCount(0);
  await settleReadEffects(page);
  expect(state.readRequests.length).toBe(2);
});

test('an account switch discards a queued equal marker before the old response completes', async ({
  page,
}) => {
  const state = await fixture(page, 'en');
  state.transcripts[101] = [message(4400)];
  let release!: () => void;
  state.readGates[101] = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.goto('/chat');
  await setReadFocus(page, true);
  await selectPrivate(page);
  await expect.poll(() => state.readRequests.length).toBe(1);
  const late = message(4399, 101, 'Old account pending unread arrival');
  state.transcripts[101].push(late);
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'messages', items: [late] }));
  await expect(page.locator('.messages')).toContainText(late.content);
  await settleReadEffects(page);
  state.user.id = viewer + 50;
  state.user.username = 'Replacement account fixture';
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'refresh' }));
  await expect(page.locator('.messages')).toHaveAttribute('data-view-key', 'channel:1');
  await expect(page.locator('.messages')).not.toContainText(late.content);
  delete state.readGates[101];
  release();
  await expect.poll(() => state.reads).toEqual([4400]);
  await settleReadEffects(page);
  expect(state.readRequests).toEqual([{ conversation: 101, marker: 4400, viewer }]);
  expect(state.receipts.get(`${viewer + 50}:101`)).toBeUndefined();
});

test('an equal-marker failure waits for an explicit retry through duplicate refreshes', async ({
  page,
}) => {
  const state = await fixture(page, 'en');
  state.transcripts[101] = [message(4500)];
  await page.goto('/chat');
  await setReadFocus(page, true);
  await selectPrivate(page);
  await expect.poll(() => state.reads).toEqual([4500]);
  state.readStatus[101] = 503;
  const late = message(4499, 101, 'Retryable equal marker arrival');
  state.transcripts[101].push(late);
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'messages', items: [late] }));
  await expect(page.locator('.chat-read-error')).toBeVisible();
  const refreshed = page.waitForResponse((response) =>
    response.url().includes('/conversations/101/messages?'),
  );
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'messages', items: [late, late] }));
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'refresh' }));
  await refreshed;
  await settleReadEffects(page);
  expect(state.readRequests.map((item) => item.marker)).toEqual([4500, 4500]);
  state.readStatus[101] = 204;
  await page
    .locator('.chat-read-error')
    .getByRole('button', { name: 'Try again', exact: true })
    .click();
  await expect.poll(() => state.reads).toEqual([4500, 4500]);
  await expect(page.locator('.chat-read-error')).toHaveCount(0);
});

test('desktop private history, unread acknowledgement, older pages and live lower IDs', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await fixture(page);
  await page.goto('/chat');
  await selectPrivate(page);
  await expect(page.locator('.messages')).toContainText('測試訊息 205');
  await expect.poll(() => state.reads.includes(205)).toBe(true);
  await page
    .locator('.messages')
    .getByRole('button', { name: '載入較早的訊息', exact: true })
    .click();
  await expect(page.locator('.messages')).toContainText('測試訊息 6');
  await page
    .locator('.messages')
    .getByRole('button', { name: '載入較早的訊息', exact: true })
    .click();
  await expect(page.locator('.messages .message[data-message-id="1"]')).toBeAttached();
  const list = page.locator('.messages');
  await list.evaluate((element) => {
    element.scrollTop = 0;
  });
  const readsBeforeLate = state.readRequests.length;
  const late = message(206, 101, 'Late committed fixture');
  const later = message(207, 101, 'Earlier committed fixture');
  state.transcripts[101].push(late, later);
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'messages', items: [later] }));
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'messages', items: [late] }));
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'messages', items: [late] }));
  await expect(list.locator('.message').filter({ hasText: 'Late committed fixture' })).toHaveCount(
    1,
  );
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(0);
  await settleReadEffects(page);
  expect(state.readRequests.length).toBe(readsBeforeLate);
  const sameUuid = [
    { ...message(208, 101, 'Peer UUID fixture', peer), client_uuid: 'shared-fixture-uuid' },
    { ...message(209, 101, 'Viewer UUID fixture', viewer), client_uuid: 'shared-fixture-uuid' },
  ];
  state.transcripts[101].push(...sameUuid);
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'messages', items: sameUuid }));
  await expect(
    list.locator('.message p').filter({ hasText: /^(Peer|Viewer) UUID fixture$/ }),
  ).toHaveCount(2);
  await capture(page, 'desktop-dark-zhTW-history');
  await expect(page.locator('.global-scene')).toHaveCSS('background-image', 'none');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
});

test('ambiguous send retry reuses UUID and preserves a newer per-conversation draft', async ({
  page,
}) => {
  const state = await fixture(page, 'en');
  await page.goto('/chat');
  await selectPrivate(page);
  const compose = page.locator('.chat-compose');
  const input = compose.locator('textarea');
  await input.fill('Retry fixture');
  state.ambiguousOnce = true;
  await compose.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.chat-error')).toBeVisible();
  expect(state.sends).toHaveLength(1);
  const uuid = state.sends[0].body.client_uuid;
  expect(uuid).toEqual(expect.any(String));
  let release!: () => void;
  state.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await compose.getByRole('button', { name: 'Retry send', exact: true }).click();
  await expect.poll(() => state.sends.length).toBe(2);
  await expect(compose.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await input.fill('Newer draft fixture');
  release();
  await expect(input).toHaveValue('Newer draft fixture');
  expect(state.sends[1].body.client_uuid).toBe(uuid);
  expect(state.transcripts[101].filter((item) => item.client_uuid === uuid)).toHaveLength(1);
  await selectPrivate(page, 102);
  await expect(input).toHaveValue('');
  await input.fill('Second draft fixture');
  await selectPrivate(page);
  await expect(input).toHaveValue('Newer draft fixture');
});

test('mobile light new-conversation failure and retry retain recipient input', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page, 'en', 'light');
  await page.goto('/chat');
  await expandNavigation(page);
  const form = page.locator('.chat-new-conversation');
  await form.locator('input[name="target_username"]').fill('Illya fixture');
  state.failCreate = true;
  await form.locator('button[type="submit"]').click();
  await expect(form.getByRole('alert')).toBeVisible();
  await expect(form.locator('input')).toHaveValue('Illya fixture');
  await capture(page, 'mobile-light-en-create-error');
  state.failCreate = false;
  await form.locator('button[type="submit"]').click();
  await expect(page.locator('.messages')).toHaveAttribute('data-channel-id', '101');
  expect(state.creates).toEqual(['Illya fixture', 'Illya fixture']);
});

test('Japanese friend-only state and independent account preference failure/retry', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page, 'ja');
  state.canSend = false;
  await page.goto('/chat');
  await selectPrivate(page);
  await expect(page.locator('.messages')).toContainText('測試訊息 205');
  await expect(page.locator('.chat-compose button[type="submit"]')).toBeDisabled();
  await page.locator('.chat-compose textarea').fill('Friend-only draft fixture');
  await expect(page.locator('.chat-compose textarea')).toHaveValue('Friend-only draft fixture');
  expect(state.sends).toHaveLength(0);
  await capture(page, 'mobile-dark-ja-friend-only');
  await expandNavigation(page);
  state.failPreference = true;
  await page.locator('#pm_friends_only').check();
  await expect(page.locator('.chat-preferences').getByRole('alert')).toBeVisible();
  state.failPreference = false;
  await page.locator('.chat-preferences button').click();
  await expect.poll(() => state.preferences.pm_friends_only).toBe(true);
  for (const write of state.preferenceWrites)
    expect(Object.keys(write)).toEqual(['pm_friends_only']);
  expect(state.preferences.mode).toBe('dark');
  expect(state.preferences.locale).toBe('ja');
});

test('policy refresh purges cached older messages and inaccessible private conversations', async ({
  page,
}) => {
  const state = await fixture(page, 'en');
  await page.goto('/chat');
  await selectPrivate(page);
  await page
    .locator('.messages')
    .getByRole('button', { name: 'Load older messages', exact: true })
    .click();
  await expect(page.locator('.messages')).toContainText('測試訊息 6');
  state.hidden.add(6);
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'refresh' }));
  await expect(page.locator('.message p').filter({ hasText: /^測試訊息 6$/ })).toHaveCount(0);
  state.denied.add(101);
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'refresh' }));
  await expect(page.locator('.conversation-list button[data-conversation-id="101"]')).toHaveCount(
    0,
  );
  await expect(page.locator('.messages')).not.toContainText('測試訊息 205');
});

test('reconnect refetches history, keeps draft, and guest access exposes only public channels', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await fixture(page, 'en');
  await page.goto('/chat');
  await selectPrivate(page);
  await page.locator('.chat-compose textarea').fill('Reconnect draft fixture');
  await state.sockets.at(-1)!.close({ code: 1012, reason: 'Synthetic transport interruption' });
  await expect(page.locator('.chat-connection')).toContainText(/reconnect/i);
  await capture(page, 'desktop-dark-en-reconnect');
  state.transcripts[101].push(message(208, 101, 'Reconnect recovered fixture'));
  await expect.poll(() => state.sockets.length).toBeGreaterThan(1);
  await expect(page.locator('.messages')).toContainText('Reconnect recovered fixture');
  await expect(page.locator('.chat-compose textarea')).toHaveValue('Reconnect draft fixture');
  await page.unroute('**/api/v1/**');
  await fixture(page, 'en', 'dark', true);
  await page.reload();
  await expect(page.locator('.messages')).toContainText('Public channel fixture');
  await expect(page.locator('.conversation-list')).toHaveCount(0);
  await expect(page.locator('.chat-new-conversation')).toHaveCount(0);
  await expect(page.locator('.messages')).not.toContainText('Reconnect recovered fixture');
});

for (const kind of ['public', 'private'] as const) {
  test(`${kind} reconnect recovers more than one missed history page above cached older messages`, async ({
    page,
  }) => {
    const state = await fixture(page, 'en');
    const channel = kind === 'public' ? 1 : 101;
    const base = kind === 'public' ? 2000 : 0;
    state.transcripts[channel] = Array.from({ length: 100 }, (_, i) =>
      message(base + i + 1, channel),
    );
    await page.goto('/chat');
    if (kind === 'private') await selectPrivate(page);
    const list = page.locator('.messages');
    await expect(list.locator('.message')).toHaveCount(100);
    await page.locator('.chat-compose textarea').fill(`${kind} reconnect draft`);
    state.transcripts[channel].push(
      ...Array.from({ length: 150 }, (_, i) => message(base + i + 101, channel)),
    );
    await state.sockets.at(-1)!.close({ code: 1012, reason: 'Synthetic multi-page interruption' });
    await expect(list.locator('.message')).toHaveCount(250);
    expect(
      await list
        .locator('.message')
        .evaluateAll((items) =>
          items.map((item) => Number((item as HTMLElement).dataset.messageId)),
        ),
    ).toEqual(Array.from({ length: 250 }, (_, i) => base + i + 1));
    expect(state.historyReads).toContainEqual({ channel, before: base + 151 });
    await expect(page.locator('.chat-compose textarea')).toHaveValue(`${kind} reconnect draft`);
  });
}

test('a live head message does not hide the missed pages below it', async ({ page }) => {
  const state = await fixture(page, 'en');
  state.transcripts[101] = Array.from({ length: 100 }, (_, i) => message(i + 1));
  await page.goto('/chat');
  await selectPrivate(page);
  await expect(page.locator('.messages .message')).toHaveCount(100);
  state.transcripts[101].push(...Array.from({ length: 150 }, (_, i) => message(i + 101)));
  state.sockets
    .at(-1)!
    .send(JSON.stringify({ type: 'messages', items: [state.transcripts[101].at(-1)] }));
  await expect(page.locator('.messages .message')).toHaveCount(250);
  await expect(page.locator('.message[data-message-id="101"]')).toBeAttached();
});

test('bounded recovery replaces a disconnected window and cancels a stale older page', async ({
  page,
}) => {
  const state = await fixture(page, 'en');
  await page.goto('/chat');
  await selectPrivate(page);
  await expect(page.locator('.messages .message')).toHaveCount(100);
  let release!: () => void;
  state.historyGates['101:106'] = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page
    .locator('.messages')
    .getByRole('button', { name: 'Load older messages', exact: true })
    .click();
  await expect
    .poll(() => state.historyReads.some((read) => read.channel === 101 && read.before === 106))
    .toBe(true);
  state.transcripts[101].push(...Array.from({ length: 2200 }, (_, i) => message(i + 206)));
  const recoveryStart = state.historyReads.length;
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'refresh' }));
  await expect(page.locator('.messages .message')).toHaveCount(2000);
  const recoveryPages = state.historyReads
    .slice(recoveryStart)
    .filter((read) => read.channel === 101);
  expect(recoveryPages).toHaveLength(20);
  await expect(page.locator('.message[data-message-id="406"]')).toBeAttached();
  release();
  await expect(page.locator('.message[data-message-id="6"]')).toHaveCount(0);
  await page
    .locator('.messages')
    .getByRole('button', { name: 'Load older messages', exact: true })
    .click();
  await expect(page.locator('.messages .message')).toHaveCount(2100);
  await expect(page.locator('.message[data-message-id="306"]')).toBeAttached();
});

test('reordered conversation pages keep omitted selected and cached authorized threads', async ({
  page,
}) => {
  const state = await fixture(page, 'en');
  const remaining = Array.from({ length: 53 }, (_, i) => 103 + i);
  state.conversationOrder = [101, 102, ...remaining];
  await page.goto('/chat');
  await selectPrivate(page, 102);
  await expect(page.locator('.messages')).toContainText('Second conversation fixture');
  await selectPrivate(page);
  await expect(page.locator('.messages')).toContainText('測試訊息 205');
  await page.locator('.chat-compose textarea').fill('Omitted thread draft');
  state.conversationOrder = [...remaining, 101, 102];
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'refresh' }));
  await expect
    .poll(() => state.metadataReads.includes(101) && state.metadataReads.includes(102))
    .toBe(true);
  await expect(page.locator('.messages')).toContainText('測試訊息 205');
  await expect(page.locator('.chat-compose textarea')).toHaveValue('Omitted thread draft');
  await selectPrivate(page, 102);
  await expect(page.locator('.messages')).toContainText('Second conversation fixture');
  await selectPrivate(page);
  await expect(page.locator('.chat-compose textarea')).toHaveValue('Omitted thread draft');
});

test('a pending detail snapshot cannot restore a thread after a concurrent read denial', async ({
  page,
}) => {
  const state = await fixture(page, 'en');
  const remaining = Array.from({ length: 53 }, (_, i) => 103 + i);
  state.conversationOrder = [101, 102, ...remaining];
  await page.goto('/chat');
  await selectPrivate(page);
  await expect.poll(() => state.reads.includes(205)).toBe(true);
  let release!: () => void;
  state.metadataGates[101] = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.conversationOrder = [...remaining, 101, 102];
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'refresh' }));
  await expect.poll(() => state.metadataReads.includes(101)).toBe(true);
  state.readStatus[101] = 403;
  const latest = message(206);
  state.transcripts[101].push(latest);
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'messages', items: [latest] }));
  await expect(page.locator('.conversation-list button[data-conversation-id="101"]')).toHaveCount(
    0,
  );
  await page.evaluate(() => {
    const state = window as unknown as { deniedThreadRestored: boolean };
    state.deniedThreadRestored = false;
    new MutationObserver((records) => {
      for (const record of records)
        for (const added of record.addedNodes)
          if (
            added instanceof Element &&
            (added.matches('[data-conversation-id="101"]') ||
              added.querySelector('[data-conversation-id="101"]'))
          )
            state.deniedThreadRestored = true;
    }).observe(document.querySelector('.conversation-list')!, { childList: true, subtree: true });
  });
  state.metadataStatus[101] = 403;
  delete state.metadataGates[101];
  release();
  await expect.poll(() => state.metadataReads.filter((id) => id === 101).length).toBeGreaterThan(1);
  await expect(page.locator('.messages')).not.toContainText('測試訊息 205');
  expect(
    await page.evaluate(
      () => (window as unknown as { deniedThreadRestored: boolean }).deniedThreadRestored,
    ),
  ).toBe(false);
});

for (const status of [401, 403, 404]) {
  test(`omitted conversation detail ${status} removes cached private history`, async ({ page }) => {
    const state = await fixture(page, 'en');
    const remaining = Array.from({ length: 53 }, (_, i) => 103 + i);
    state.conversationOrder = [101, 102, ...remaining];
    await page.goto('/chat');
    await selectPrivate(page);
    await expect(page.locator('.messages')).toContainText('測試訊息 205');
    state.conversationOrder = [...remaining, 101, 102];
    state.metadataStatus[101] = status;
    state.sockets.at(-1)!.send(JSON.stringify({ type: 'refresh' }));
    await expect.poll(() => state.metadataReads.includes(101)).toBe(true);
    await expect(page.locator('.conversation-list button[data-conversation-id="101"]')).toHaveCount(
      0,
    );
    await expect(page.locator('.messages')).not.toContainText('測試訊息 205');
    await expect(page.locator('.chat-compose')).toHaveCount(0);
  });
}

test('profile recipient link fills the form without creating or sending until requested', async ({
  page,
}) => {
  const state = await fixture(page, 'en');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/chat?recipient=Illya%20fixture');
  await expect(page.locator('#chat-recipient')).toBeVisible();
  await expect(page.locator('#chat-recipient')).toHaveValue('Illya fixture');
  expect(state.creates).toEqual([]);
  expect(state.sends).toEqual([]);
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await expect.poll(() => state.creates).toEqual(['Illya fixture']);
  await expect(page.locator('.messages')).toHaveAttribute('data-channel-id', '101');
  expect(state.sends).toEqual([]);
});

test('live permission refresh updates public controls and revoked sessions clear private state', async ({
  page,
}) => {
  const state = await fixture(page, 'en');
  await page.goto('/chat');
  await expect(page.locator('.messages')).toHaveAttribute('data-channel-id', '1');
  await page.locator('.chat-compose textarea').fill('Permission draft fixture');
  state.user.permissions = [];
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'refresh' }));
  await expect(page.locator('.chat-compose button[type="submit"]')).toBeDisabled();
  await expect(page.locator('.chat-compose textarea')).toHaveValue('Permission draft fixture');
  await expect(page.locator('[data-chat-send-notice]')).toContainText('cannot send chat messages');
  await expect(page.locator('.messages')).toContainText('Public channel fixture');
  expect(state.sends).toHaveLength(0);
  state.user.permissions = ['chat.send'];
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'refresh' }));
  await expect(page.locator('.chat-compose textarea')).toHaveValue('Permission draft fixture');
  await selectPrivate(page);
  await expect(page.locator('.messages')).toContainText('測試訊息 205');
  state.sessionExpired = true;
  state.sockets.at(-1)!.send(JSON.stringify({ type: 'refresh' }));
  await expect(page.locator('.conversation-list')).toHaveCount(0);
  await expect(page.locator('.messages')).not.toContainText('測試訊息 205');
  await expect(page.locator('.messages')).toContainText('Public channel fixture');
});
