import { expect, test, type Page } from '@playwright/test';
import { selectField } from './helpers/field-select';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const stamp = '2026-10-09T04:00:00Z';
const actor = {
  id: 991101,
  username: 'Synthetic moderator',
  country: 'TW',
  bio: '',
  avatar_url: null,
  banner_url: null,
  accent_color: '#f28eb6',
  roles: [],
  joined_at: stamp,
  pp: 0,
  play_count: 0,
};
function score(id: number, verification: string, mode = 0, variant = 'vanilla') {
  return {
    id,
    user_id: 991102,
    username: 'Synthetic player',
    beatmap_id: 991201,
    title: `Synthetic score ${id}`,
    artist: 'Fixture artist',
    version: 'Fixture difficulty',
    mode,
    score_variant: variant,
    score: 1000000,
    accuracy: 98.6,
    max_combo: 311,
    mods: 0,
    pp: 44.4,
    passed: true,
    verification,
    moderation_revision: 2,
    created_at: stamp,
    has_replay: false,
    user: { ...actor, id: 991102, username: 'Synthetic player' },
    beatmap: { artist: 'Fixture artist' },
    hit_counts: { n300: 311, n100: 3 },
    client: 'stable',
    accuracy_source: 'judgements',
    replay_url: null,
  };
}
async function fixture(page: Page, permissions: string[], locale = 'en') {
  const state = {
    permissions,
    viewerId: actor.id,
    scores: [
      score(991301, 'pending'),
      score(991302, 'verified'),
      score(991303, 'rejected'),
      ...Array.from({ length: 25 }, (_, i) => score(991400 + i, 'pending', 1, 'relax')),
    ],
    players: [
      {
        id: 991102,
        username: 'Synthetic player',
        country: 'TW',
        avatar_url: null,
        chat_silenced_until: null as string | null,
        chat_silence_revision: 4,
        can_silence: true,
        is_protected: false,
      },
      {
        id: actor.id,
        username: actor.username,
        country: 'TW',
        avatar_url: null,
        chat_silenced_until: null,
        chat_silence_revision: 0,
        can_silence: false,
        is_protected: true,
      },
      {
        id: 991103,
        username: 'Synthetic protected staff',
        country: 'JP',
        avatar_url: null,
        chat_silenced_until: null,
        chat_silence_revision: 0,
        can_silence: false,
        is_protected: true,
      },
    ],
    queries: [] as string[],
    writes: [] as { path: string; method: string; body: Record<string, unknown> }[],
    conflictScore: false,
    conflictChat: false,
    failWrite: false,
    denyRead: false,
    failRefresh: false,
    serverOffset: 7 * 60000,
    holdDetail: false,
    holdDetailPath: '/scores/991302',
    releaseDetail: null as (() => void) | null,
    holdCollection: false,
    releaseCollection: null as (() => void) | null,
  };
  await page
    .context()
    .addCookies([
      { name: 'illya_locale', value: locale, url: test.info().project.use.baseURL as string },
    ]);
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    const fail = (status: number, code = 'fixture_failure') =>
      route.fulfill({
        status,
        json: { error: { code, message: 'Raw fixture message must not appear in new UI' } },
      });
    const allowed = (permission: string) =>
      state.permissions.includes(permission) || state.permissions.includes('*');
    const collection = <T>(items: T[]) => {
      const page = Number(url.searchParams.get('page') ?? 1),
        page_size = Number(url.searchParams.get('page_size') ?? 24);
      return {
        items: items.slice((page - 1) * page_size, page * page_size),
        total: items.length,
        page,
        page_size,
      };
    };
    if (path === '/me')
      return route.fulfill({
        json: { ...actor, id: state.viewerId, permissions: state.permissions },
      });
    if (path === '/me/preferences')
      return route.fulfill({
        json: {
          mode: 'dark',
          locale,
          accent_color: '#f28eb6',
          background_url: null,
          background_blur: 0,
          background_dim: 0.76,
          panel_blur: 8,
          panel_opacity: 0.55,
          border_radius: 14,
        },
      });
    if (/^\/scores\/\d+\/replay$/.test(path)) return fail(503);
    if (path === '/scores' || /^\/scores\/\d+$/.test(path)) {
      if (state.denyRead) return fail(403, 'forbidden');
      if (state.failRefresh) return fail(503);
      state.queries.push(`${path}${url.search}`);
      if (path === state.holdDetailPath && state.holdDetail) {
        state.holdDetail = false;
        await new Promise<void>((resolve) => {
          state.releaseDetail = resolve;
        });
      }
      if (path !== '/scores')
        return route.fulfill({
          json: state.scores.find((item) => item.id === Number(path.split('/').at(-1))),
        });
      const status = url.searchParams.get('verification');
      if (status && status !== 'verified' && !allowed('scores.moderate'))
        return fail(403, 'forbidden');
      const mode = url.searchParams.get('mode'),
        variant = url.searchParams.get('variant');
      if (state.holdCollection) {
        state.holdCollection = false;
        await new Promise<void>((resolve) => {
          state.releaseCollection = resolve;
        });
      }
      return route.fulfill({
        json: collection(
          state.scores.filter(
            (item) =>
              (!status || item.verification === status) &&
              (!mode || item.mode === Number(mode)) &&
              (!variant || item.score_variant === variant),
          ),
        ),
      });
    }
    if (/^\/admin\/scores\/\d+$/.test(path)) {
      const body = request.postDataJSON();
      state.writes.push({ path, method: request.method(), body });
      if (!allowed('scores.moderate')) return fail(403, 'forbidden');
      if (state.failWrite) return fail(503);
      const item = state.scores.find((item) => item.id === Number(path.split('/').at(-1)))!;
      if (state.conflictScore) {
        state.conflictScore = false;
        item.moderation_revision += 2;
        return fail(409, 'score_moderation_conflict');
      }
      if (body.expected_revision !== item.moderation_revision)
        return fail(409, 'score_moderation_conflict');
      item.verification = body.verification;
      item.moderation_revision++;
      return route.fulfill({
        json: {
          ok: true,
          id: item.id,
          verification: item.verification,
          moderation_revision: item.moderation_revision,
        },
      });
    }
    if (path === '/admin/chat-silences') {
      state.queries.push(`${path}${url.search}`);
      if (!allowed('chat.moderate') || state.denyRead) return fail(403, 'forbidden');
      if (state.failRefresh) return fail(503);
      const search = url.searchParams.get('search') ?? '';
      return route.fulfill({
        json: {
          ...collection(
            state.players.filter(
              (item) => !search || item.username.includes(search) || item.id.toString() === search,
            ),
          ),
          server_time: new Date(Date.now() + state.serverOffset).toISOString(),
        },
      });
    }
    if (/^\/admin\/users\/\d+\/chat-silence$/.test(path)) {
      const body = request.postDataJSON();
      state.writes.push({ path, method: request.method(), body });
      if (!allowed('chat.moderate')) return fail(403, 'forbidden');
      if (state.failWrite) return fail(503);
      const item = state.players.find((item) => item.id === Number(path.split('/')[3]))!;
      if (state.conflictChat) {
        state.conflictChat = false;
        item.chat_silence_revision += 2;
        return fail(409, 'chat_silence_conflict');
      }
      if (body.expected_revision !== item.chat_silence_revision)
        return fail(409, 'chat_silence_conflict');
      item.chat_silence_revision++;
      item.chat_silenced_until = request.method() === 'DELETE' ? null : body.expires_at;
      return route.fulfill({
        json: {
          ok: true,
          id: item.id,
          chat_silenced_until: item.chat_silenced_until,
          chat_silence_revision: item.chat_silence_revision,
          server_time: new Date(Date.now() + state.serverOffset).toISOString(),
        },
      });
    }
    if (path === '/admin/audit') {
      if (!allowed('audit.read') || state.denyRead) return fail(403, 'forbidden');
      return route.fulfill({
        json: collection([
          {
            id: 991501,
            actor_id: actor.id,
            actor_username: actor.username,
            action: 'users.chat_silence',
            target_type: 'user',
            target_id: '991102',
            created_at: stamp,
            details: {
              reason: '<script>synthetic private reason</script>',
              previous_revision: 4,
              revision: 5,
              changed: { until: '2026-10-09T05:00:00Z' },
            },
          },
        ]),
      });
    }
    return route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 24 } });
  });
  return state;
}

test('score-only staff review published and rejected scores, preserve partition and reset page', async ({
  page,
}) => {
  const state = await fixture(page, ['scores.moderate']);
  await page.goto('/admin?tab=scores&mode=1&variant=relax&page=2');
  await expect(page.locator('[data-score-id]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Chat moderation', exact: true })).toHaveCount(0);
  await selectField(page.getByRole('combobox', { name: 'Review status' }), 'verified');
  await expect(page).toHaveURL(/verification=verified/);
  expect(new URL(page.url()).searchParams.get('page')).toBeNull();
  expect(new URL(page.url()).searchParams.get('mode')).toBe('1');
  expect(new URL(page.url()).searchParams.get('variant')).toBe('relax');
  await selectField(page.getByRole('combobox', { name: 'Score category' }), 'all');
  await expect(page.locator('[data-score-id="991302"]')).toBeVisible();
  await selectField(page.getByRole('combobox', { name: 'Review status' }), 'rejected');
  await expect(page.locator('[data-score-id="991303"]')).toBeVisible();
  await expect(
    page.locator('[data-score-id="991303"] a').filter({ hasText: 'Synthetic score' }),
  ).toHaveAttribute('href', '/scores/991303');
  expect(state.queries.some((query) => query.includes('verification=verified'))).toBeTruthy();
});

test('score ABA conflict keeps selected decision, blocks writes, then explicitly reads new revision', async ({
  page,
}) => {
  const state = await fixture(page, ['scores.moderate']);
  state.conflictScore = true;
  await page.goto('/admin?tab=scores&verification=verified');
  const form = page.getByRole('form', { name: 'Decision for score #991302' });
  await selectField(form.getByRole('combobox', { name: 'Decision', exact: true }), 'rejected');
  await form.getByRole('button', { name: 'Apply decision' }).click();
  await expect(form.getByRole('alert')).toContainText('Your choices have been kept');
  await expect(form.getByRole('combobox')).toHaveAttribute('data-value', 'rejected');
  await expect(form.getByRole('button', { name: 'Apply decision' })).toBeDisabled();
  expect(state.writes[0].body).toEqual({ verification: 'rejected', expected_revision: 2 });
  await form.getByRole('button', { name: 'Refresh latest version' }).click();
  await expect(form.getByRole('status')).toContainText('Latest version loaded');
  await form.getByRole('button', { name: 'Apply decision' }).click();
  await expect(page.locator('[data-score-id="991302"]')).toHaveCount(0);
  expect(state.writes[1].body).toEqual({ verification: 'rejected', expected_revision: 4 });
});

test('score detail offers staff decisions, while the owner has no moderation controls', async ({
  page,
}) => {
  const state = await fixture(page, []);
  state.viewerId = 991102;
  await page.goto('/scores/991302');
  await expect(page.getByRole('heading', { name: 'Synthetic score 991302' })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Decision for score #991302' })).toHaveCount(0);
  state.permissions.push('scores.moderate');
  await page.reload();
  const form = page.getByRole('form', { name: 'Decision for score #991302' });
  await expect(form).toBeVisible();
  await selectField(form.getByRole('combobox'), 'pending');
  await form.getByRole('button', { name: 'Apply decision' }).click();
  await expect(form.getByRole('status')).toHaveText('Score decision saved.');
  expect(state.writes[0].body).toEqual({ verification: 'pending', expected_revision: 2 });
});

test('chat-only staff see search and target protection, with no account controls', async ({
  page,
}) => {
  const state = await fixture(page, ['chat.moderate']);
  await page.goto('/admin?tab=chat');
  await expect(page.getByText('You cannot silence your own account.')).toBeVisible();
  await expect(page.getByText('This staff account is protected from your access.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Players', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Scores', exact: true })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Find a player' }).fill('991102');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('[data-chat-user-id]')).toHaveCount(1);
  expect(state.queries.some((query) => query.includes('search=991102'))).toBeTruthy();
});

test('timed silence uses server clock and revision; lift is an explicit reasoned DELETE', async ({
  page,
}) => {
  const state = await fixture(page, ['chat.moderate']);
  await page.goto('/admin?tab=chat&search=991102');
  await page.getByRole('button', { name: 'Manage chat' }).click();
  const form = page.getByRole('form', { name: 'Chat silence for Synthetic player' });
  await selectField(form.getByRole('combobox', { name: 'Duration' }), '15');
  await form.getByRole('textbox', { name: 'Private staff reason' }).fill('Synthetic spam evidence');
  const before = Date.now();
  await form.getByRole('button', { name: 'Apply timed silence' }).click();
  await expect(form.getByRole('status')).toHaveText('Timed silence saved.');
  expect(state.writes[0].method).toBe('PUT');
  expect(state.writes[0].body.expected_revision).toBe(4);
  expect(new Date(state.writes[0].body.expires_at as string).getTime() - before).toBeGreaterThan(
    21 * 60000,
  );
  await form
    .getByRole('textbox', { name: 'Private staff reason' })
    .fill('Synthetic appeal accepted');
  await form.getByRole('button', { name: 'Lift silence', exact: true }).click();
  await expect(form.getByRole('status')).toHaveText('Chat silence lifted.');
  expect(state.writes[1]).toMatchObject({
    method: 'DELETE',
    body: { reason: 'Synthetic appeal accepted', expected_revision: 5 },
  });
  expect(state.writes[1].body).not.toHaveProperty('expires_at');
});

test('chat conflict preserves reason and custom duration until explicit refresh', async ({
  page,
}) => {
  const state = await fixture(page, ['chat.moderate']);
  state.conflictChat = true;
  await page.goto('/admin?tab=chat&search=991102');
  await page.getByRole('button', { name: 'Manage chat' }).click();
  const form = page.getByRole('form', { name: 'Chat silence for Synthetic player' });
  await selectField(form.getByRole('combobox'), 'custom');
  await form.getByRole('spinbutton').fill('20');
  await form.getByRole('textbox').fill('Synthetic preserved reason');
  await form.getByRole('button', { name: 'Apply timed silence' }).click();
  await expect(form.getByRole('alert')).toContainText('Another moderator changed');
  await expect(form.getByRole('textbox')).toHaveValue('Synthetic preserved reason');
  await expect(form.getByRole('spinbutton')).toHaveValue('20');
  await expect(form.getByRole('button', { name: 'Apply timed silence' })).toBeDisabled();
  await form.getByRole('button', { name: 'Refresh latest version' }).click();
  await expect(form.getByRole('status')).toContainText('Latest version loaded');
  await form.getByRole('button', { name: 'Apply timed silence' }).click();
  await expect(form.getByRole('status')).toHaveText('Timed silence saved.');
  expect(state.writes[1].body.expected_revision).toBe(6);
});

test('invalid reasons and out-of-range custom durations never submit', async ({ page }) => {
  const state = await fixture(page, ['chat.moderate']);
  await page.goto('/admin?tab=chat&search=991102');
  await page.getByRole('button', { name: 'Manage chat' }).click();
  const form = page.getByRole('form', { name: 'Chat silence for Synthetic player' });
  await form.getByRole('button', { name: 'Apply timed silence' }).click();
  await expect(form.getByRole('alert')).toContainText('Enter a reason');
  await form.getByRole('textbox').fill('x'.repeat(501));
  await form.getByRole('button', { name: 'Apply timed silence' }).click();
  await expect(form.getByRole('alert')).toContainText('Enter a reason');
  await form.getByRole('textbox').fill('Synthetic valid reason');
  await selectField(form.getByRole('combobox'), 'custom');
  await form.getByRole('spinbutton').fill('43201');
  // Native number validity also blocks the submit; invoke a valid lower bound afterward.
  await form.getByRole('button', { name: 'Apply timed silence' }).click();
  expect(state.writes).toHaveLength(0);
  await form.getByRole('spinbutton').fill('0');
  await form.getByRole('button', { name: 'Apply timed silence' }).click();
  expect(state.writes).toHaveLength(0);
});

test('read denial never exposes cached staff lists or controls', async ({ page }) => {
  const state = await fixture(page, ['chat.moderate']);
  state.denyRead = true;
  await page.goto('/admin?tab=chat');
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await expect(page.locator('[data-chat-user-id]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manage chat' })).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});

test('opening a silence editor later keeps the clock offset measured at response receipt', async ({
  page,
}) => {
  await page.clock.install({ time: new Date() });
  const state = await fixture(page, ['chat.moderate']);
  await page.goto('/admin?tab=chat&search=991102');
  await expect(page.getByRole('button', { name: 'Manage chat' })).toBeVisible();
  await page.clock.fastForward(20 * 60000);
  await page.getByRole('button', { name: 'Manage chat' }).click();
  const form = page.getByRole('form', { name: 'Chat silence for Synthetic player' });
  await selectField(form.getByRole('combobox'), '15');
  await form.getByRole('textbox').fill('Synthetic delayed-editor reason');
  await form.getByRole('button', { name: 'Apply timed silence' }).click();
  await expect(form.getByRole('status')).toHaveText('Timed silence saved.');
  expect(
    new Date(state.writes[0].body.expires_at as string).getTime() - Date.now(),
  ).toBeGreaterThan(40 * 60000);
});

for (const kind of ['scores', 'chat'] as const) {
  test(`manual denied refresh purges cached ${kind} staff records`, async ({ page }) => {
    const state = await fixture(page, [kind === 'scores' ? 'scores.moderate' : 'chat.moderate']);
    state.conflictScore = kind === 'scores';
    state.conflictChat = kind === 'chat';
    await page.goto(
      kind === 'scores'
        ? '/admin?tab=scores&verification=verified'
        : '/admin?tab=chat&search=991102',
    );
    if (kind === 'chat') await page.getByRole('button', { name: 'Manage chat' }).click();
    const form = page.getByRole('form', {
      name: kind === 'scores' ? 'Decision for score #991302' : 'Chat silence for Synthetic player',
    });
    if (kind === 'scores') await selectField(form.getByRole('combobox'), 'rejected');
    else await form.getByRole('textbox').fill('Synthetic denied-refresh reason');
    await form
      .getByRole('button', { name: kind === 'scores' ? 'Apply decision' : 'Apply timed silence' })
      .click();
    await expect(form.getByRole('alert')).toContainText('Another moderator changed');
    state.denyRead = true;
    await form.getByRole('button', { name: 'Refresh latest version' }).click();
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
    await expect(
      page.locator(kind === 'scores' ? '[data-score-id]' : '[data-chat-user-id]'),
    ).toHaveCount(0);
  });
}

test('late score refresh cannot replace another status filter', async ({ page }) => {
  const state = await fixture(page, ['scores.moderate']);
  state.conflictScore = true;
  await page.goto('/admin?tab=scores&verification=verified');
  const form = page.getByRole('form', { name: 'Decision for score #991302' });
  await selectField(form.getByRole('combobox'), 'rejected');
  await form.getByRole('button', { name: 'Apply decision' }).click();
  await expect(form.getByRole('alert')).toContainText('Another moderator changed');
  state.holdDetail = true;
  await form.getByRole('button', { name: 'Refresh latest version' }).click();
  await expect.poll(() => state.releaseDetail !== null).toBeTruthy();
  await selectField(page.getByRole('combobox', { name: 'Review status' }), 'rejected');
  await expect(page.locator('[data-score-id="991303"]')).toBeVisible();
  state.releaseDetail!();
  await expect
    .poll(
      () =>
        state.queries.filter(
          (query) => query.startsWith('/scores?') && query.includes('verification=verified'),
        ).length,
    )
    .toBeGreaterThan(1);
  await expect(page.locator('[data-score-id="991303"]')).toBeVisible();
  await expect(page.locator('[data-score-id="991302"]')).toHaveCount(0);
});

test('audit-only staff see actor identity and keyboard-expand safe structured details', async ({
  page,
}) => {
  await fixture(page, ['audit.read']);
  await page.goto('/admin?tab=audit');
  await expect(page.getByText(actor.username, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(`#${actor.id}`, { exact: true })).toBeVisible();
  const summary = page.locator('details summary').filter({ hasText: 'View details' });
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('details')).toHaveAttribute('open');
  await expect(
    page.getByText('<script>synthetic private reason</script>', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('details script')).toHaveCount(0);
  await expect(page.getByText('previous revision', { exact: true })).toBeVisible();
});

test('simultaneous row refresh cannot restore staff data after another row receives denial', async ({
  page,
}) => {
  const state = await fixture(page, ['scores.moderate']);
  state.scores.push(score(991304, 'verified'));
  await page.goto('/admin?tab=scores&verification=verified');
  for (const id of [991302, 991304]) {
    state.conflictScore = true;
    const form = page.getByRole('form', { name: `Decision for score #${id}` });
    await selectField(form.getByRole('combobox'), 'rejected');
    await form.getByRole('button', { name: 'Apply decision' }).click();
    await expect(form.getByRole('alert')).toContainText('Another moderator changed');
  }
  state.holdCollection = true;
  await page
    .getByRole('form', { name: 'Decision for score #991302' })
    .getByRole('button', { name: 'Refresh latest version' })
    .click();
  await expect.poll(() => state.releaseCollection !== null).toBeTruthy();
  state.denyRead = true;
  await page
    .getByRole('form', { name: 'Decision for score #991304' })
    .getByRole('button', { name: 'Refresh latest version' })
    .click();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  const response = page.waitForResponse(
    (value) => value.url().includes('/api/v1/scores?') && value.status() === 200,
  );
  state.releaseCollection!();
  await (await response).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.locator('[data-score-id]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
});

test('simultaneous detail refresh cannot restore a score after access denial', async ({ page }) => {
  const state = await fixture(page, ['scores.moderate']);
  state.viewerId = 991102;
  state.conflictScore = true;
  await page.goto('/scores/991301');
  const decision = page.getByRole('form', { name: 'Decision for score #991301' });
  await selectField(decision.getByRole('combobox'), 'verified');
  await decision.getByRole('button', { name: 'Apply decision' }).click();
  await expect(decision.getByRole('alert')).toContainText('Another moderator changed');
  await page.getByLabel('Replay file', { exact: true }).setInputFiles({
    name: 'synthetic.osr',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('synthetic routed upload'),
  });
  await page.getByRole('button', { name: 'Attach replay', exact: true }).click();
  await expect(page.locator('.score-replay-upload .form-error')).toBeVisible();
  state.holdDetailPath = '/scores/991301';
  state.holdDetail = true;
  await page.getByRole('button', { name: 'Refresh score', exact: true }).click();
  await expect.poll(() => state.releaseDetail !== null).toBeTruthy();
  state.denyRead = true;
  await decision.getByRole('button', { name: 'Refresh latest version' }).click();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  const response = page.waitForResponse(
    (value) => value.url().endsWith('/api/v1/scores/991301') && value.status() === 200,
  );
  state.releaseDetail!();
  await (await response).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByRole('heading', { name: 'Synthetic score 991301' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
});

test('custom staff grants expose the administration navigation link without admin.view', async ({
  page,
}) => {
  const state = await fixture(page, ['chat.moderate']);
  for (const permission of [
    'chat.moderate',
    'scores.moderate',
    'audit.read',
    'announcements.manage',
  ]) {
    state.permissions = [permission];
    await page.goto('/admin');
    await expect(
      page.locator('.desktop-nav').getByRole('link', { name: 'Administration', exact: true }),
    ).toBeVisible();
  }
  state.permissions = [];
  await page.goto('/admin');
  await expect(
    page.locator('.desktop-nav').getByRole('link', { name: 'Administration', exact: true }),
  ).toHaveCount(0);
});

test('announcement managers retain drafts across tab unmount without admin.view', async ({
  page,
}) => {
  await fixture(page, ['announcements.manage', 'scores.moderate']);
  await page.goto('/admin?tab=announcements');
  await page.getByRole('button', { name: 'New announcement', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Synthetic announcement-only draft');
  await page
    .getByLabel('Body', { exact: true })
    .fill('Synthetic private draft text preserved by its existing permission.');
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await page.evaluate(() => window.history.pushState(null, '', '/admin?tab=scores'));
  await expect(page.getByRole('combobox', { name: 'Review status' })).toBeVisible();
  await page.getByRole('button', { name: 'Announcements', exact: true }).click();
  await expect(page.locator('.announcement-recovered')).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
    'Synthetic announcement-only draft',
  );
  await expect(page.getByLabel('Body', { exact: true })).toHaveValue(
    'Synthetic private draft text preserved by its existing permission.',
  );
});

for (const locale of ['zh-TW', 'ja']) {
  test(`localized moderation controls render at phone width: ${locale}`, async ({ page }) => {
    await fixture(page, ['scores.moderate', 'chat.moderate'], locale);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin?tab=chat&search=991102');
    await expect(page.locator('[data-chat-user-id="991102"]')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('adminModeration.');
    const width = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(width.scroll).toBeLessThanOrEqual(width.viewport + 1);
  });
}

test('paired desktop and phone moderation layouts retain contained controls and table navigation', async ({
  page,
}) => {
  await fixture(page, ['scores.moderate', 'chat.moderate', 'audit.read']);
  const directory = process.env.ILLYA_ADMIN_MODERATION_CAPTURE_DIR;
  if (directory) mkdirSync(directory, { recursive: true });
  for (const [name, width, height] of [
    ['desktop', 1254, 850],
    ['phone', 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto('/admin?tab=chat&search=991102');
    await page.getByRole('button', { name: 'Manage chat' }).click();
    await page
      .getByRole('textbox', { name: 'Private staff reason' })
      .fill('Synthetic spam evidence retained for a staff decision.');
    if (directory)
      await page.screenshot({ path: path.join(directory, `chat-${name}.png`), fullPage: true });
    await page.goto('/admin?tab=scores&verification=verified');
    await expect(page.locator('[data-score-id="991302"]')).toBeVisible();
    if (directory)
      await page.screenshot({ path: path.join(directory, `scores-${name}.png`), fullPage: true });
    await page.goto('/admin?tab=audit');
    await page.locator('details summary').click();
    if (directory)
      await page.screenshot({ path: path.join(directory, `audit-${name}.png`), fullPage: true });
    const geometry = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
  }
});

test('staff can identify a replay resubmission and download its evidence', async ({ page }) => {
  const state = await fixture(page, ['scores.moderate']);
  Object.assign(state.scores[0], {
    submission_origin: 'replay',
    replay_played_at: '2026-10-12T00:00:00Z',
    has_replay: true,
  });
  await page.goto('/admin?tab=scores');
  const row = page.locator('[data-score-id="991301"]');
  await expect(row.getByText('Replay resubmission', { exact: true })).toBeVisible();
  await expect(row.getByText(/Replay play time:/)).toBeVisible();
  await expect(row.getByRole('link', { name: 'Download' })).toHaveAttribute(
    'href',
    '/api/v1/scores/991301/replay',
  );
  await expect(row.getByRole('button', { name: 'Apply decision', exact: true })).toBeVisible();
});
