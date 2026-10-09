import { expect, test, type Page } from '@playwright/test';
import { selectField } from './helpers/field-select';

// Synthetic browser fixtures only. The real mutation/retention policy is covered
// by separate owned backend integration tests, not by these intercepted writes.
const stamp = '2026-10-10T05:00:00Z';
const setId = 2_000_000_201;
const officialId = 991211;
const mapId = 991201;
const statusValues = ['pending', 'wip', 'graveyard', 'ranked', 'loved', 'unranked'];
const uploader = {
  id: 992101,
  username: 'Synthetic local uploader',
  country: 'TW',
  avatar_url: null,
};
type Difficulty = {
  native_id: number;
  version: string;
  mode: number;
  stars: number;
  status: string;
  revision: number;
  status_revision: number | null;
};
type StaffSet = {
  native_set_id: number;
  source: 'local' | 'official';
  title: string;
  artist: string;
  creator: string;
  difficulties: Difficulty[];
  representative_id: number | null;
  availability: {
    withdrawn: boolean;
    revision: number;
    reason: string | null;
    changed_at: string | null;
  };
};
const copy = {
  adminView: 'Administrator view',
  localTitle: 'Local beatmapsets',
  editStatus: 'Edit status',
  newStatus: 'New status',
  reason: 'Change reason',
  saveStatus: 'Save status',
  saved: 'Difficulty status saved.',
  refresh: 'Refresh beatmapsets',
  refreshDifficulty: 'Refresh this difficulty',
  conflict:
    'A difficulty has changed. Your draft and selection have been kept. Refresh before continuing.',
};

function staffSet(id = setId, source: 'local' | 'official' = 'local'): StaffSet {
  return {
    native_set_id: id,
    source,
    title: source === 'local' ? 'Synthetic staff local set' : 'Synthetic staff official set',
    artist: 'Synthetic artist',
    creator: 'Synthetic mapper',
    difficulties: [
      {
        native_id: mapId,
        version: 'Synthetic Normal',
        mode: 0,
        stars: 2.4,
        status: 'pending',
        revision: 2,
        status_revision: source === 'official' ? null : 3,
      },
      {
        native_id: mapId + 1,
        version: 'Synthetic Hard',
        mode: 0,
        stars: 4.2,
        status: 'ranked',
        revision: 0,
        status_revision: source === 'official' ? null : 5,
      },
    ],
    representative_id: source === 'local' ? mapId : null,
    availability: { withdrawn: false, revision: 4, reason: null, changed_at: null },
  };
}
function localRecord(index: number) {
  return {
    native_set_id: setId + index,
    title: `Synthetic uploaded set ${index + 1}`,
    artist: 'Synthetic artist',
    creator: 'Synthetic mapper',
    difficulty_count: 2,
    statuses: index % 2 ? ['pending', 'graveyard'] : ['wip', 'unranked'],
    uploaded_by:
      index % 2
        ? { ...uploader, id: 992102, username: 'Synthetic other uploader' }
        : { ...uploader },
    withdrawn: index === 26,
    added_at: stamp,
    representative_id: mapId + index * 2,
  };
}
function publicMap() {
  return {
    id: mapId,
    native_set_id: setId,
    uploaded_by: uploader.id,
    title: 'Synthetic public local set',
    artist: 'Synthetic artist',
    creator: 'Synthetic mapper',
    version: 'Synthetic Normal',
    source: 'local',
    mode: 0,
    status: 'pending',
    stars: 2.4,
    length_seconds: 90,
    bpm: 180,
    max_combo: 250,
    play_count: 0,
    official_id: null,
    official_set_id: null,
    md5: 'b'.repeat(32),
    download_url: `/api/v1/beatmaps/${mapId}/archive`,
    download_kind: 'osz',
    package: {
      id: '3e8b2bfe-21ef-4c3a-ad01-37ce0a2fcb9c',
      native_set_id: setId,
      kind: 'osz',
      source: 'local',
      legacy: false,
      difficulty_count: 2,
      beatmap_ids: [mapId, mapId + 1],
      download_url: `/api/v1/beatmaps/${mapId}/archive`,
    },
    availability: { withdrawn: false, revision: 0, reason: null, changed_at: null },
  };
}
async function fixture(page: Page, permissions = ['beatmaps.moderate'], locale = 'en') {
  const state = {
    permissions,
    local: Array.from({ length: 27 }, (_, index) => localRecord(index)),
    sets: [staffSet(), staffSet(officialId, 'official')],
    calls: [] as string[],
    privateReads: [] as string[],
    writes: [] as { path: string; body: Record<string, unknown> }[],
    conflict: null as 'override' | 'stored' | null,
    denyRead: false,
    withdrawn: false,
    unexpectedMutations: [] as string[],
  };
  await page
    .context()
    .addCookies([
      { name: 'illya_locale', value: locale, url: test.info().project.use.baseURL as string },
    ]);
  await page.route('https://assets.ppy.sh/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="160"><rect width="600" height="160" fill="#28252d"/></svg>',
    }),
  );
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const routePath = url.pathname.replace('/api/v1', '');
    const method = request.method();
    state.calls.push(`${method} ${routePath}${url.search}`);
    const allowed =
      state.permissions.includes('beatmaps.moderate') || state.permissions.includes('*');
    const fail = (status: number, code: string) =>
      route.fulfill({
        status,
        json: { error: { code, message: 'Raw synthetic error must not be shown' } },
      });
    if (routePath === '/me')
      return route.fulfill({
        json: {
          ...uploader,
          username: 'Synthetic map moderator',
          bio: '',
          banner_url: null,
          accent_color: '#f28eb6',
          roles: [],
          permissions: state.permissions,
          joined_at: stamp,
          pp: 0,
          play_count: 0,
        },
      });
    if (routePath === '/me/preferences')
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
          glass_level: 100,
        },
      });
    if (routePath === `/beatmaps/${mapId}`) return route.fulfill({ json: publicMap() });
    if (routePath === `/beatmaps/${mapId}/set/difficulties`)
      return route.fulfill({ json: { items: [publicMap()], total: 1, page: 1, page_size: 24 } });
    if (routePath === `/beatmaps/${mapId}/scores`)
      return route.fulfill({
        json: { items: [], total: 0, page: 1, page_size: 24, ordered_by: 'standardised_score' },
      });
    if (routePath === `/official/beatmapsets/${officialId}`)
      return route.fulfill({
        json: {
          official_set_id: officialId,
          title: 'Synthetic public official set',
          artist: 'Synthetic artist',
          creator: 'Synthetic mapper',
          status: 'pending',
          cover_url: `https://assets.ppy.sh/beatmaps/${officialId}/covers/card.jpg`,
          official_url: `https://osu.ppy.sh/beatmapsets/${officialId}`,
          download_disabled: false,
          difficulties: [
            {
              official_id: 991212,
              version: 'Synthetic official Normal',
              mode: 0,
              stars: 2.4,
              length_seconds: 90,
              bpm: 180,
              ar: 7,
              cs: 4,
              od: 6,
              hp: 5,
              max_combo: 250,
            },
          ],
          local: { stored_count: 0, archive_available: false, withdrawn: false },
        },
      });
    if (routePath === '/admin/beatmapsets' && method === 'GET') {
      state.privateReads.push(`${routePath}${url.search}`);
      if (!allowed || state.denyRead) return fail(403, 'forbidden');
      const q = url.searchParams.get('q') ?? '';
      const availability = url.searchParams.get('availability') ?? 'all';
      const items = state.local.filter(
        (item) =>
          (!q || item.title.includes(q)) &&
          (availability === 'all' || item.withdrawn === (availability === 'withdrawn')),
      );
      const pageNumber = Number(url.searchParams.get('page') ?? 1);
      const pageSize = Number(url.searchParams.get('page_size') ?? 24);
      return route.fulfill({
        json: {
          items: items.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
          page: pageNumber,
          page_size: pageSize,
          total: items.length,
        },
      });
    }
    const detail = /^\/admin\/beatmapsets\/(\d+)$/.exec(routePath);
    if (detail && method === 'GET') {
      state.privateReads.push(routePath);
      if (!allowed || state.denyRead) return fail(403, 'forbidden');
      const set = state.sets.find((item) => item.native_set_id === Number(detail[1]));
      return set ? route.fulfill({ json: set }) : fail(404, 'not_found');
    }
    const change = /^\/admin\/beatmapsets\/(\d+)\/difficulties\/(\d+)$/.exec(routePath);
    const availability = /^\/admin\/beatmapsets\/(\d+)\/availability$/.exec(routePath);
    if (availability && method === 'PATCH') {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.writes.push({ path: routePath, body });
      if (!allowed) return fail(403, 'forbidden');
      const set = state.sets.find((item) => item.native_set_id === Number(availability[1]));
      if (!set) return fail(404, 'not_found');
      if (body.expected_revision !== set.availability.revision)
        return fail(409, 'availability_conflict');
      set.availability = {
        withdrawn: Boolean(body.withdrawn),
        revision: set.availability.revision + 1,
        reason: String(body.reason),
        changed_at: stamp,
      };
      state.withdrawn = set.availability.withdrawn;
      return route.fulfill({
        json: { native_set_id: set.native_set_id, availability: set.availability },
      });
    }
    if (change && method === 'PATCH') {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.writes.push({ path: routePath, body });
      if (!allowed) return fail(403, 'forbidden');
      if (state.withdrawn) return fail(410, 'beatmapset_withdrawn');
      const set = state.sets.find((item) => item.native_set_id === Number(change[1]));
      const difficulty = set?.difficulties.find((item) => item.native_id === Number(change[2]));
      if (!difficulty) return fail(404, 'not_found');
      if (state.conflict) {
        if (state.conflict === 'override') difficulty.revision++;
        else difficulty.status_revision = (difficulty.status_revision ?? 0) + 1;
        state.conflict = null;
        return fail(409, 'beatmap_status_conflict');
      }
      if (
        body.expected_revision !== difficulty.revision ||
        body.expected_status_revision !== difficulty.status_revision
      )
        return fail(409, 'beatmap_status_conflict');
      if (!statusValues.includes(String(body.status))) return fail(400, 'invalid_status');
      difficulty.status = String(body.status);
      difficulty.revision++;
      if (difficulty.status_revision !== null) difficulty.status_revision++;
      return route.fulfill({ json: { ...difficulty } });
    }
    if (method !== 'GET') state.unexpectedMutations.push(`${method} ${routePath}`);
    return fail(404, 'not_found');
  });
  return state;
}

function row(page: Page, id = mapId) {
  return page.locator(`[data-staff-difficulty-id="${id}"]`);
}
async function editor(page: Page, id = mapId) {
  await row(page, id).getByRole('button', { name: copy.editStatus, exact: true }).click();
  return row(page, id).locator(`form[data-difficulty-status-editor="${id}"]`);
}
function localArticles(page: Page) {
  return page.getByRole('region', { name: copy.localTitle, exact: true }).locator('article');
}

test('moderation-only staff see all grouped local uploads with paging, search and browser history', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`/beatmaps/${mapId}`);
  await page
    .locator('.desktop-nav')
    .getByRole('link', { name: 'Administration', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: copy.localTitle, exact: true })).toBeVisible();
  await expect(localArticles(page)).toHaveCount(24);
  await expect(
    page.getByText('Uploader · Synthetic other uploader', { exact: true }).first(),
  ).toBeVisible();
  const initial = new URL(`http://fixture.invalid${state.privateReads.at(-1)}`);
  expect(initial.searchParams.get('availability')).toBe('all');
  expect(initial.searchParams.get('page_size')).toBe('24');
  expect(initial.searchParams.has('uploaded_by')).toBe(false);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(localArticles(page)).toHaveCount(3);
  expect(new URL(page.url()).searchParams.get('local_page')).toBe('2');
  const search = page.getByRole('searchbox', { name: 'Search', exact: true });
  await search.fill('Synthetic uploaded set 27');
  await search.press('Enter');
  await expect(localArticles(page)).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get('local_page')).toBe('1');
  expect(new URL(page.url()).searchParams.get('local_q')).toBe('Synthetic uploaded set 27');
  await page.goBack();
  await expect(localArticles(page)).toHaveCount(3);
  await expect(search).toHaveValue('');
  expect(new URL(page.url()).searchParams.get('local_page')).toBe('2');
  expect(
    state.calls.some((call) => /(?:\/official\/beatmapsets|\/admin\/beatmaps\?)/.test(call)),
  ).toBe(false);
  expect(state.writes).toHaveLength(0);
});

test('local and upstream-only official details link to the explicit administrator set view', async ({
  page,
}) => {
  const state = await fixture(page);
  for (const [path, id] of [
    [`/beatmaps/${mapId}`, setId],
    [`/beatmaps/official/${officialId}`, officialId],
  ] as const) {
    await page.goto(path);
    const link = page.getByRole('link', { name: copy.adminView, exact: true });
    await expect(link).toHaveAttribute('href', `/admin/beatmapsets/${id}`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/admin/beatmapsets/${id}$`));
    await expect(page.locator('[data-staff-difficulty-id]')).toHaveCount(2);
    expect(state.privateReads).toContain(`/admin/beatmapsets/${id}`);
  }
  expect(state.writes).toHaveLength(0);
  expect(state.unexpectedMutations).toHaveLength(0);
});

test('six difficulty status options submit one exact dual-revision patch while its sibling is unchanged', async ({
  page,
}) => {
  const state = await fixture(page);
  const sibling = { ...state.sets[0].difficulties[1] };
  await page.goto(`/admin/beatmapsets/${setId}`);
  const form = await editor(page);
  const status = form.getByRole('combobox', { name: copy.newStatus });
  await status.click();
  await expect(page.getByRole('option')).toHaveCount(6);
  for (const value of statusValues)
    await expect(
      page.getByRole('option').and(page.locator(`[data-option-value="${value}"]`)),
    ).toBeVisible();
  await status.press('Escape');
  await selectField(status, 'graveyard');
  await form.getByRole('textbox', { name: copy.reason }).fill('  Synthetic difficulty change  ');
  await form.getByRole('button', { name: copy.saveStatus, exact: true }).click();
  await expect(form.getByText(copy.saved, { exact: true })).toBeVisible();
  expect(state.writes).toEqual([
    {
      path: `/admin/beatmapsets/${setId}/difficulties/${mapId}`,
      body: {
        status: 'graveyard',
        reason: 'Synthetic difficulty change',
        expected_revision: 2,
        expected_status_revision: 3,
      },
    },
  ]);
  expect(state.sets[0].difficulties[1]).toEqual(sibling);
  await expect(row(page, mapId + 1)).toContainText('Ranked');
  await expect(form.getByRole('button', { name: copy.saveStatus, exact: true })).toBeDisabled();
});

for (const [conflict, override, stored] of [
  ['override', 3, 3],
  ['stored', 2, 4],
] as const) {
  test(`a stale ${conflict} revision preserves status and reason until explicit difficulty refresh`, async ({
    page,
  }) => {
    const state = await fixture(page);
    state.conflict = conflict;
    await page.goto(`/admin/beatmapsets/${setId}`);
    const form = await editor(page);
    const status = form.getByRole('combobox', { name: copy.newStatus });
    const reason = form.getByRole('textbox', { name: copy.reason });
    await selectField(status, 'loved');
    await reason.fill('Synthetic retained moderation draft');
    await form.getByRole('button', { name: copy.saveStatus, exact: true }).click();
    await expect(form.getByRole('alert')).toHaveText(copy.conflict);
    await expect(reason).toHaveValue('Synthetic retained moderation draft');
    await expect(status).toHaveAttribute('data-value', 'loved');
    await expect(form.getByRole('button', { name: copy.saveStatus, exact: true })).toBeDisabled();
    await form.getByRole('button', { name: copy.refreshDifficulty, exact: true }).click();
    await expect(reason).toHaveValue('Synthetic retained moderation draft');
    await expect(status).toHaveAttribute('data-value', 'loved');
    await form.getByRole('button', { name: copy.saveStatus, exact: true }).click();
    await expect(form.getByText(copy.saved, { exact: true })).toBeVisible();
    expect(state.writes.map((write) => write.body)).toEqual([
      {
        status: 'loved',
        reason: 'Synthetic retained moderation draft',
        expected_revision: 2,
        expected_status_revision: 3,
      },
      {
        status: 'loved',
        reason: 'Synthetic retained moderation draft',
        expected_revision: override,
        expected_status_revision: stored,
      },
    ]);
  });
}

test('a denied manual set refresh removes cached private metadata and every status editor', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`/admin/beatmapsets/${setId}`);
  await editor(page);
  await expect(page.getByRole('heading', { name: state.sets[0].title, exact: true })).toBeVisible();
  state.denyRead = true;
  const denied = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/admin/beatmapsets/${setId}`) && response.status() === 403,
  );
  await page.getByRole('button', { name: copy.refresh, exact: true }).click();
  await denied;
  await expect(page.locator('[data-staff-difficulty-id]')).toHaveCount(0);
  await expect(page.locator('[data-difficulty-status-editor]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: state.sets[0].title, exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator('body')).not.toContainText('Raw synthetic error');
  expect(state.writes).toHaveLength(0);
});

test('moderation-only staff restore a withdrawn set with current availability CAS and retain the difficulty draft', async ({
  page,
}) => {
  const state = await fixture(page);
  const sibling = { ...state.sets[0].difficulties[1] };
  await page.goto(`/admin/beatmapsets/${setId}`);
  const form = await editor(page);
  const status = form.getByRole('combobox', { name: copy.newStatus });
  const reason = form.getByRole('textbox', { name: copy.reason });
  await selectField(status, 'graveyard');
  await reason.fill('Synthetic retained difficulty choice');
  state.withdrawn = true;
  state.sets[0].availability = {
    withdrawn: true,
    revision: 5,
    reason: 'Synthetic external withdrawal',
    changed_at: stamp,
  };
  await form.getByRole('button', { name: copy.saveStatus, exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText(
    'This beatmapset is withdrawn. Status changes are unavailable.',
  );
  expect(state.sets[0].difficulties[0].status).toBe('pending');
  await page.getByRole('button', { name: copy.refresh, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restore set', exact: true })).toBeVisible();
  await expect(
    row(page, mapId + 1).getByRole('button', { name: copy.editStatus, exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Restore set', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Restore this beatmap set', exact: true });
  await dialog
    .getByRole('textbox', { name: 'Reason', exact: true })
    .fill('Synthetic set restored for review');
  await dialog.getByRole('button', { name: 'Confirm restore', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Withdraw set', exact: true })).toBeVisible();
  await expect(reason).toHaveValue('Synthetic retained difficulty choice');
  await expect(status).toHaveAttribute('data-value', 'graveyard');
  await expect(form.getByRole('button', { name: copy.saveStatus, exact: true })).toBeDisabled();
  await form.getByRole('button', { name: copy.refreshDifficulty, exact: true }).click();
  await form.getByRole('button', { name: copy.saveStatus, exact: true }).click();
  await expect(form.getByText(copy.saved, { exact: true })).toBeVisible();
  expect(state.writes).toEqual([
    {
      path: `/admin/beatmapsets/${setId}/difficulties/${mapId}`,
      body: {
        status: 'graveyard',
        reason: 'Synthetic retained difficulty choice',
        expected_revision: 2,
        expected_status_revision: 3,
      },
    },
    {
      path: `/admin/beatmapsets/${setId}/availability`,
      body: { withdrawn: false, expected_revision: 5, reason: 'Synthetic set restored for review' },
    },
    {
      path: `/admin/beatmapsets/${setId}/difficulties/${mapId}`,
      body: {
        status: 'graveyard',
        reason: 'Synthetic retained difficulty choice',
        expected_revision: 2,
        expected_status_revision: 3,
      },
    },
  ]);
  expect(state.sets[0].difficulties[1]).toEqual(sibling);
  expect(state.privateReads.some((path) => path.startsWith('/admin/beatmaps/'))).toBe(false);
  expect(state.unexpectedMutations).toHaveLength(0);
});

test('ordinary viewers and malformed native set identifiers cause no private set reads', async ({
  page,
}) => {
  const state = await fixture(page, []);
  await page.goto(`/admin/beatmapsets/${setId}`);
  await expect(
    page.getByText("You don't have access to this area.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: copy.refresh, exact: true })).toHaveCount(0);
  await expect(page.locator('[data-staff-difficulty-id]')).toHaveCount(0);
  state.permissions = ['beatmaps.moderate'];
  for (const value of ['not-a-set', '0', '2147483648', '9e3']) {
    await page.goto(`/admin/beatmapsets/${value}`);
    await expect(
      page.getByText('This request is unavailable to this account.', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-staff-difficulty-id]')).toHaveCount(0);
  }
  expect(state.privateReads).toHaveLength(0);
  expect(state.writes).toHaveLength(0);
});

for (const [locale, title, edit, statusLabel, reasonLabel] of [
  ['zh-TW', '管理員檢視', '編輯狀態', '新狀態', '修改理由'],
  ['ja', '管理者ビュー', '状態を編集', '新しい状態', '変更理由'],
] as const) {
  test(`localized phone difficulty controls and reason remain contained: ${locale}`, async ({
    page,
  }) => {
    await fixture(page, ['beatmaps.moderate'], locale);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/beatmapsets/${setId}`);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await row(page).getByRole('button', { name: edit, exact: true }).click();
    const form = row(page).locator('[data-difficulty-status-editor]');
    await expect(form.getByRole('combobox', { name: statusLabel })).toBeVisible();
    await form.getByRole('textbox', { name: reasonLabel }).fill('Synthetic localized reason');
    await expect(page.locator('body')).not.toContainText('rankRequests.');
    const geometry = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
  });
}
