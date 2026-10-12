import { expect, test, type Locator, type Page } from '@playwright/test';
import { selectField } from './helpers/field-select';

// These intercepted fixtures test browser behavior. Eligibility, privacy and CAS
// enforcement require the separate owned backend integration tests.
const stamp = '2026-10-10T04:00:00Z';
const viewerId = 991101;
const localMapId = 991201;
const localNativeId = 2_000_000_301;
const localSetId = 2_000_000_201;
const officialSetId = 991211;
const pendingId = 991301;
type Status = 'pending' | 'approved' | 'rejected' | 'withdrawn';
type Identity = {
  id: number;
  username: string;
  country: string;
  avatar_url: string | null;
};
type RankRequest = {
  id: number;
  native_set_id: number;
  source: 'local' | 'official';
  requester: Identity;
  reason: string;
  status: Status;
  revision: number;
  metadata: {
    title: string;
    artist: string;
    creator: string;
    difficulty_count: number;
    official_url: string | null;
  };
  review_reason: string | null;
  reviewer: Identity | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  representative_id: number | null;
  difficulties: {
    native_id: number;
    version: string;
    mode: number;
    stars: number;
    status: string;
    revision: number;
    status_revision: number | null;
  }[];
  approved_difficulty_ids: number[] | null;
};
type FixtureError = { status: number; code: string };
const actor: Identity = {
  id: viewerId,
  username: 'Synthetic ranking requester',
  country: 'TW',
  avatar_url: null,
};
const reviewer: Identity = {
  id: 991102,
  username: 'Synthetic ranking reviewer',
  country: 'JP',
  avatar_url: null,
};
const copy = {
  request: 'Request ranking',
  reason: 'Request reason',
  send: 'Submit request',
  submitted: 'Ranking request submitted.',
  duplicate: 'This beatmapset already has a pending request. Your draft has been kept.',
  limit:
    'The request limit has been reached. Try again later or withdraw an unused pending request.',
  ineligible:
    'This beatmapset cannot currently be requested. Check its status, uploader and availability.',
  invalidReason: 'Enter 1–1000 characters without control characters.',
  conflict: 'This request has changed. Your draft has been kept. Refresh it before continuing.',
  difficultyConflict:
    'A difficulty has changed. Your draft and selection have been kept. Refresh before continuing.',
  manifestChanged:
    'The official difficulty list has changed. Refresh the request before reviewing it.',
  refreshRequest: 'Refresh this request',
  refresh: 'Refresh requests',
  review: 'Review request',
  reviewReason: 'Review reason',
  decision: 'Decision',
  saveDecision: 'Save decision',
  withdraw: 'Withdraw request',
  refreshFailed:
    'The action was saved, but the list could not be refreshed. Refresh before making another change.',
  selectShown: 'Select all shown',
  clearSelection: 'Clear selection',
};

function rankRequest(id: number, status: Status = 'pending', owner = actor): RankRequest {
  const terminal = status === 'approved' || status === 'rejected';
  return {
    id,
    native_set_id: localSetId + id - pendingId,
    source: 'local',
    requester: { ...owner },
    reason: `Private synthetic request reason ${id}`,
    status,
    revision: 4,
    metadata: {
      title: `Synthetic ranking set ${id}`,
      artist: 'Synthetic artist',
      creator: 'Synthetic mapper',
      difficulty_count: 2,
      official_url: null,
    },
    review_reason: terminal ? `Private synthetic review reason ${id}` : null,
    reviewer: terminal ? { ...reviewer } : null,
    created_at: stamp,
    updated_at: stamp,
    reviewed_at: terminal ? stamp : null,
    representative_id: localMapId,
    difficulties: [
      {
        native_id: localNativeId,
        version: 'Synthetic Normal',
        mode: 0,
        stars: 2.4,
        status: terminal && status === 'approved' ? 'ranked' : 'pending',
        revision: 2,
        status_revision: 3,
      },
      {
        native_id: localNativeId + 1,
        version: 'Synthetic Hard',
        mode: 0,
        stars: 4.2,
        status: 'pending',
        revision: 0,
        status_revision: 5,
      },
    ],
    approved_difficulty_ids: status === 'approved' ? [localNativeId] : null,
  };
}

function localMap() {
  return {
    id: localMapId,
    native_id: localNativeId,
    native_set_id: localSetId,
    uploaded_by: viewerId,
    official_id: null,
    official_set_id: null,
    title: 'Synthetic uploaded ranking set',
    artist: 'Synthetic artist',
    creator: 'Synthetic mapper',
    version: 'Synthetic Normal',
    mode: 0,
    status: 'pending',
    source: 'local',
    stars: 2.4,
    bpm: 180,
    length_seconds: 90,
    max_combo: 250,
    play_count: 0,
    md5: 'a'.repeat(32),
    download_url: `/api/v1/beatmaps/${localMapId}/archive`,
    download_kind: 'osz',
    package: {
      id: '26ce0ea7-e1d9-41ec-80d7-531989380fe3',
      native_set_id: localSetId,
      kind: 'osz',
      source: 'local',
      legacy: false,
      difficulty_count: 2,
      beatmap_ids: [localMapId, localMapId + 1],
      download_url: `/api/v1/beatmaps/${localMapId}/archive`,
    },
    availability: { withdrawn: false, revision: 0, reason: null, changed_at: null },
  };
}

function officialSet() {
  return {
    official_set_id: officialSetId,
    title: 'Synthetic official ranking set',
    artist: 'Synthetic artist',
    creator: 'Synthetic official mapper',
    status: 'pending',
    cover_url: `https://assets.ppy.sh/beatmaps/${officialSetId}/covers/card.jpg`,
    official_url: `https://osu.ppy.sh/beatmapsets/${officialSetId}`,
    download_disabled: false,
    difficulties: [
      {
        official_id: 991212,
        version: 'Synthetic official Normal',
        mode: 0,
        stars: 2.4,
        status: 'pending',
        length_seconds: 90,
        bpm: 180,
        ar: 7,
        cs: 4,
        od: 6,
        hp: 5,
        max_combo: 250,
      },
      {
        official_id: 991213,
        version: 'Synthetic official Hard',
        mode: 0,
        stars: 4.2,
        status: 'pending',
        length_seconds: 90,
        bpm: 180,
        ar: 8,
        cs: 4,
        od: 7,
        hp: 5,
        max_combo: 400,
      },
    ],
    local: { stored_count: 0, archive_available: false, withdrawn: false },
  };
}

async function fixture(page: Page, permissions = ['beatmaps.rank.request'], locale = 'en') {
  const state = {
    viewer: viewerId as number | null,
    permissions,
    rows: [
      rankRequest(pendingId),
      rankRequest(pendingId + 1, 'approved'),
      rankRequest(pendingId + 2, 'rejected'),
      rankRequest(pendingId + 3, 'withdrawn'),
      rankRequest(pendingId + 4, 'pending', {
        ...actor,
        id: 991103,
        username: 'Synthetic other requester',
      }),
    ],
    map: localMap(),
    localDifficulties: [
      localMap(),
      ...(['graveyard', 'unranked', 'ranked', 'loved', 'wip'] as const).map((status, index) => ({
        ...localMap(),
        id: localMapId + index + 1,
        native_id: localNativeId + index + 1,
        status,
        version: `Synthetic ${status} sibling`,
      })),
    ],
    official: officialSet(),
    calls: [] as string[],
    reads: [] as string[],
    writes: [] as { path: string; method: string; body: Record<string, unknown> }[],
    createError: null as FixtureError | null,
    withdrawConflict: false,
    reviewConflict: false,
    reviewMapConflict: null as 'beatmap_status_conflict' | 'rank_request_map_changed' | null,
    denyRead: false,
    failRefreshAfterWrite: false,
    holdCollection: false,
    releaseCollection: null as (() => void) | null,
    completedHeldReads: 0,
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
    const allowed = (permission: string) =>
      state.permissions.includes(permission) || state.permissions.includes('*');
    const fail = (status: number, code: string) =>
      route.fulfill({
        status,
        json: { error: { code, message: 'Raw synthetic backend error must not be rendered' } },
      });
    if (routePath === '/me')
      return state.viewer === null
        ? fail(401, 'unauthorized')
        : route.fulfill({
            json: {
              ...actor,
              id: state.viewer,
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
          mode: 'dark',
          locale,
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
    if (routePath === '/auth/logout') {
      state.viewer = null;
      return route.fulfill({ status: 204 });
    }
    if (routePath === `/beatmaps/${localMapId}`) return route.fulfill({ json: state.map });
    if (method === 'GET' && routePath === `/beatmapsets/${localSetId}`) {
      const rawDifficulty = url.searchParams.get('difficulty');
      const rawMode = url.searchParams.get('mode');
      const difficulty = rawDifficulty === null ? null : Number(rawDifficulty);
      const mode = rawMode === null ? null : Number(rawMode);
      if (
        (rawDifficulty !== null &&
          (!/^[1-9]\d*$/.test(rawDifficulty) ||
            !Number.isSafeInteger(difficulty) ||
            Number(difficulty) < 1_000_000_000 ||
            Number(difficulty) > 2_147_483_647)) ||
        (rawMode !== null && !/^[0-3]$/.test(rawMode))
      )
        return fail(400, 'invalid_request');
      const map = [state.map, ...state.localDifficulties.filter((item) => item.id !== state.map.id)]
        .filter(
          (item) =>
            item.source === 'local' &&
            item.native_set_id === localSetId &&
            (difficulty === null || item.native_id === difficulty) &&
            (mode === null || item.mode === mode),
        )
        .sort((left, right) => left.id - right.id)[0];
      if (!map) return fail(404, 'not_found');
      if (map.availability.withdrawn) return fail(410, 'beatmapset_withdrawn');
      return route.fulfill({ json: map });
    }
    if (routePath === `/beatmaps/${localMapId}/set/difficulties`) {
      const pageNumber = Number(url.searchParams.get('page') ?? 1);
      const pageSize = Number(url.searchParams.get('page_size') ?? 24);
      return route.fulfill({
        json: {
          items: state.localDifficulties.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
          total: state.localDifficulties.length,
          page: pageNumber,
          page_size: pageSize,
        },
      });
    }
    if (routePath === `/beatmaps/${localMapId}/scores`)
      return route.fulfill({
        json: { items: [], total: 0, page: 1, page_size: 24, ordered_by: 'standardised_score' },
      });
    if (routePath === `/official/beatmapsets/${officialSetId}`)
      return route.fulfill({ json: state.official });
    if (routePath === '/me/beatmap-rank-requests' || routePath === '/admin/beatmap-rank-requests') {
      state.reads.push(`${routePath}${url.search}`);
      if (state.viewer === null) return fail(401, 'unauthorized');
      const staff = routePath.startsWith('/admin/');
      if ((staff && !allowed('beatmaps.rank.review')) || state.denyRead)
        return fail(403, 'forbidden');
      if (state.failRefreshAfterWrite && state.writes.length) return fail(503, 'unavailable');
      const status = url.searchParams.get('status') ?? (staff ? 'pending' : 'all');
      const setId = url.searchParams.get('native_set_id');
      const items = state.rows.filter(
        (row) =>
          (staff || row.requester.id === state.viewer) &&
          (status === 'all' || row.status === status) &&
          (!setId || row.native_set_id === Number(setId)),
      );
      const pageNumber = Number(url.searchParams.get('page') ?? 1);
      const pageSize = Number(url.searchParams.get('page_size') ?? 24);
      // Snapshot before releasing the request: this deliberately returns old
      // authorized data after another query has received a policy denial.
      const response = JSON.parse(
        JSON.stringify({
          items: items.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
          total: items.length,
          page: pageNumber,
          page_size: pageSize,
        }),
      );
      if (state.holdCollection) {
        state.holdCollection = false;
        await new Promise<void>((resolve) => {
          state.releaseCollection = resolve;
        });
        await route.fulfill({ json: response }).catch(() => {});
        state.completedHeldReads++;
        return;
      }
      return route.fulfill({ json: response });
    }
    const detail = /^\/beatmap-rank-requests\/(\d+)$/.exec(routePath);
    if (detail && method === 'GET') {
      state.reads.push(routePath);
      if (state.viewer === null) return fail(401, 'unauthorized');
      if (state.denyRead) return fail(403, 'forbidden');
      if (state.failRefreshAfterWrite && state.writes.length) return fail(503, 'unavailable');
      const row = state.rows.find((item) => item.id === Number(detail[1]));
      return row && (row.requester.id === state.viewer || allowed('beatmaps.rank.review'))
        ? route.fulfill({ json: row })
        : fail(404, 'not_found');
    }
    if (routePath === '/beatmap-rank-requests' && method === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.writes.push({ path: routePath, method, body });
      if (state.viewer === null) return fail(401, 'unauthorized');
      if (!allowed('beatmaps.rank.request')) return fail(403, 'forbidden');
      if (state.createError) return fail(state.createError.status, state.createError.code);
      const official = body.official_set_id !== undefined;
      const ids = body.difficulty_ids;
      if (!Array.isArray(ids) || !ids.length) return fail(400, 'rank_request_ineligible');
      const available = official
        ? state.official.difficulties
            .filter((difficulty) =>
              ['pending', 'graveyard', 'unranked'].includes(difficulty.status),
            )
            .map((difficulty) => ({
              native_id: difficulty.official_id,
              version: difficulty.version,
              mode: difficulty.mode,
              stars: difficulty.stars,
              status: difficulty.status,
              revision: 0,
              status_revision: null,
            }))
        : state.localDifficulties
            .filter((difficulty) =>
              ['pending', 'graveyard', 'unranked'].includes(difficulty.status),
            )
            .map((difficulty) => ({
              native_id: difficulty.native_id,
              version: difficulty.version,
              mode: difficulty.mode,
              stars: difficulty.stars,
              status: difficulty.status,
              revision: 0,
              status_revision: 0,
            }));
      if (ids.some((id) => !available.some((difficulty) => difficulty.native_id === id)))
        return fail(400, 'rank_request_ineligible');
      const requested = available.filter((difficulty) => ids.includes(difficulty.native_id));
      const row: RankRequest = {
        ...rankRequest(991399),
        native_set_id: official ? Number(body.official_set_id) : Number(body.native_set_id),
        source: official ? 'official' : 'local',
        reason: String(body.reason),
        revision: 0,
        metadata: {
          title: official ? state.official.title : state.map.title,
          artist: 'Synthetic artist',
          creator: 'Synthetic mapper',
          difficulty_count: requested.length,
          official_url: official ? state.official.official_url : null,
        },
        representative_id: official ? null : localMapId,
        difficulties: requested,
      };
      state.rows.push(row);
      return route.fulfill({ status: 201, json: row });
    }
    const withdraw = /^\/beatmap-rank-requests\/(\d+)\/withdraw$/.exec(routePath);
    const review = /^\/admin\/beatmap-rank-requests\/(\d+)$/.exec(routePath);
    if ((withdraw && method === 'POST') || (review && method === 'PATCH')) {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.writes.push({ path: routePath, method, body });
      if (state.viewer === null) return fail(401, 'unauthorized');
      const row = state.rows.find((item) => item.id === Number((withdraw ?? review)![1]));
      if (!row) return fail(404, 'not_found');
      if (withdraw && row.requester.id !== state.viewer) return fail(404, 'not_found');
      if (review && !allowed('beatmaps.rank.review')) return fail(403, 'forbidden');
      if ((withdraw && state.withdrawConflict) || (review && state.reviewConflict)) {
        state.withdrawConflict = false;
        state.reviewConflict = false;
        row.revision += 2;
        return fail(409, 'rank_request_conflict');
      }
      if (body.expected_revision !== row.revision) return fail(409, 'rank_request_conflict');
      if (row.status !== 'pending') return fail(409, 'rank_request_closed');
      if (withdraw) row.status = 'withdrawn';
      else {
        if (body.decision === 'approved') {
          if (!allowed('beatmaps.moderate')) return fail(403, 'forbidden');
          if (state.reviewMapConflict) {
            const code = state.reviewMapConflict;
            state.reviewMapConflict = null;
            if (code === 'beatmap_status_conflict') {
              const previous = row.difficulties[0].status_revision;
              row.difficulties[0].status_revision = previous === null ? 1 : previous + 1;
            } else row.difficulties[0].revision++;
            return fail(409, code);
          }
          const ids = body.difficulty_ids;
          const revisions = body.difficulty_revisions;
          if (!Array.isArray(ids) || !ids.length || !Array.isArray(revisions))
            return fail(400, 'invalid_request');
          if (
            revisions.length !== ids.length ||
            ids.some((id) => {
              const difficulty = row.difficulties.find((item) => item.native_id === id);
              const revision = revisions.find((item) => item.native_id === id);
              return (
                !difficulty ||
                !revision ||
                revision.expected_revision !== difficulty.revision ||
                revision.expected_status_revision !== difficulty.status_revision
              );
            })
          )
            return fail(409, 'rank_request_map_changed');
          row.status = 'approved';
          row.approved_difficulty_ids = ids;
          row.difficulties.forEach((difficulty) => {
            if (!ids.includes(difficulty.native_id)) return;
            difficulty.status = 'ranked';
            difficulty.revision++;
            if (difficulty.status_revision !== null) difficulty.status_revision++;
          });
        } else {
          if (body.decision !== 'rejected') return fail(400, 'invalid_request');
          row.status = 'rejected';
        }
        row.review_reason = String(body.reason);
        row.reviewer = { ...reviewer };
        row.reviewed_at = stamp;
      }
      row.revision++;
      row.updated_at = stamp;
      return route.fulfill({ json: row });
    }
    if (method !== 'GET') state.unexpectedMutations.push(`${method} ${routePath}`);
    return fail(404, 'not_found');
  });
  return state;
}

const requestArticle = (page: Page, id = pendingId) =>
  page.locator(`[data-rank-request-id="${id}"]`);
async function creationForm(page: Page) {
  await page.getByRole('button', { name: copy.request, exact: true }).click();
  const form = page
    .locator('div[class*="requestAction"]')
    .filter({ has: page.locator('a[href="/beatmaps/rank-requests"]') });
  await form.getByRole('button', { name: 'Source', exact: true }).click();
  return form;
}
async function reviewForm(article: Locator) {
  await article.getByRole('button', { name: copy.review, exact: true }).click();
  const form = article.locator('form[data-rank-request-editor]');
  await form.getByRole('button', { name: 'Source', exact: true }).click();
  return form;
}
async function withdrawForm(article: Locator) {
  await article.getByRole('button', { name: copy.withdraw, exact: true }).click();
  return article.locator('form[data-rank-request-editor]');
}

test('anonymous map visitors never fetch private requests or receive a create action', async ({
  page,
}) => {
  const state = await fixture(page);
  state.viewer = null;
  await page.goto(`/beatmaps/${localMapId}`);
  await expect(page.getByRole('heading', { name: state.map.title })).toBeVisible();
  await expect(page.getByRole('button', { name: copy.request, exact: true })).toHaveCount(0);
  await page.goto('/beatmaps/rank-requests');
  await expect(page.getByText('Sign in to continue', { exact: true }).first()).toBeVisible();
  await expect(page.locator('[data-rank-request-id]')).toHaveCount(0);
  expect(state.reads).toHaveLength(0);
  expect(state.writes).toHaveLength(0);
});

test('local creation submits exactly the native set and trimmed reason then links own status', async ({
  page,
}) => {
  const state = await fixture(page);
  state.rows = [];
  await page.goto(`/beatmaps/${localMapId}`);
  const form = await creationForm(page);
  await expect(form.getByRole('checkbox', { name: 'Synthetic Normal', exact: true })).toBeChecked();
  await form.getByRole('textbox', { name: copy.reason }).fill('  Synthetic local evidence  ');
  await form.getByRole('button', { name: copy.send, exact: true }).click();
  await expect(form.getByText(copy.submitted, { exact: true })).toBeVisible();
  expect(state.writes).toEqual([
    {
      path: '/beatmap-rank-requests',
      method: 'POST',
      body: {
        native_set_id: localSetId,
        reason: 'Synthetic local evidence',
        reason_format: 'markdown',
        difficulty_ids: [localNativeId],
      },
    },
  ]);
  await expect(form.locator('a[href^="/beatmaps/rank-requests"]')).toBeVisible();
  expect(state.unexpectedMutations).toHaveLength(0);
});

test('upstream-only official Pending creation uses official_set_id without importing or retaining a map', async ({
  page,
}) => {
  const state = await fixture(page);
  state.rows = [];
  await page.goto(`/beatmaps/official/${officialSetId}`);
  const form = await creationForm(page);
  await expect(
    form.getByRole('checkbox', { name: 'Synthetic official Normal', exact: true }),
  ).toBeChecked();
  await expect(
    form.getByRole('checkbox', { name: 'Synthetic official Hard', exact: true }),
  ).toBeChecked();
  await form.getByRole('checkbox', { name: 'Synthetic official Hard', exact: true }).uncheck();
  await form.getByRole('textbox', { name: copy.reason }).fill('Synthetic official evidence');
  await form.getByRole('button', { name: copy.send, exact: true }).click();
  await expect(form.getByText(copy.submitted, { exact: true })).toBeVisible();
  expect(state.writes).toEqual([
    {
      path: '/beatmap-rank-requests',
      method: 'POST',
      body: {
        official_set_id: officialSetId,
        reason: 'Synthetic official evidence',
        reason_format: 'markdown',
        difficulty_ids: [991212],
      },
    },
  ]);
  expect(state.unexpectedMutations).toHaveLength(0);
});

for (const setStatus of ['pending', 'graveyard'] as const) {
  test(`official ${setStatus} creation excludes Ranked, Loved and WIP difficulties and submits the checked eligible subset`, async ({
    page,
  }) => {
    const state = await fixture(page);
    state.rows = [];
    state.official.status = setStatus;
    state.official.difficulties = (['pending', 'graveyard', 'ranked', 'loved', 'wip'] as const).map(
      (status, index) => ({
        ...officialSet().difficulties[0],
        official_id: 991212 + index,
        version: `Synthetic official ${status} difficulty`,
        status,
        local_id: ['ranked', 'loved'].includes(status) ? localMapId + index : undefined,
      }),
    );
    const statusesBefore = state.official.difficulties.map((difficulty) => difficulty.status);
    await page.goto(`/beatmaps/official/${officialSetId}`);
    const panel = await creationForm(page);
    await expect(panel.getByRole('checkbox')).toHaveCount(2);
    for (const status of ['ranked', 'loved', 'wip'])
      await expect(
        panel.getByRole('checkbox', {
          name: `Synthetic official ${status} difficulty`,
          exact: true,
        }),
      ).toHaveCount(0);
    const pending = panel.getByRole('checkbox', {
      name: 'Synthetic official pending difficulty',
      exact: true,
    });
    const graveyard = panel.getByRole('checkbox', {
      name: 'Synthetic official graveyard difficulty',
      exact: true,
    });
    await expect(pending).toBeChecked();
    await expect(graveyard).toBeChecked();
    await panel
      .getByRole('textbox', { name: copy.reason })
      .fill('Synthetic mixed official evidence');
    await panel.getByRole('button', { name: copy.clearSelection, exact: true }).click();
    await expect(pending).not.toBeChecked();
    await expect(graveyard).not.toBeChecked();
    await expect(panel.getByRole('button', { name: copy.send, exact: true })).toBeDisabled();
    expect(state.writes).toHaveLength(0);
    await panel.getByRole('button', { name: copy.selectShown, exact: true }).click();
    await expect(pending).toBeChecked();
    await expect(graveyard).toBeChecked();
    await pending.uncheck();
    await panel.getByRole('button', { name: copy.send, exact: true }).click();
    await expect(panel.getByText(copy.submitted, { exact: true })).toBeVisible();
    expect(state.writes).toEqual([
      {
        path: '/beatmap-rank-requests',
        method: 'POST',
        body: {
          official_set_id: officialSetId,
          reason: 'Synthetic mixed official evidence',
          reason_format: 'markdown',
          difficulty_ids: [991213],
        },
      },
    ]);
    expect(state.rows[0].difficulties.map((difficulty) => difficulty.native_id)).toEqual([991213]);
    expect(state.official.difficulties.map((difficulty) => difficulty.status)).toEqual(
      statusesBefore,
    );
    expect(state.unexpectedMutations).toHaveLength(0);
  });
}

test('local creation excludes Ranked, Loved and WIP siblings and sends only the checked eligible subset', async ({
  page,
}) => {
  const state = await fixture(page);
  state.rows = [];
  const statusesBefore = state.localDifficulties.map((difficulty) => difficulty.status);
  await page.goto(`/beatmaps/${localMapId}`);
  const panel = await creationForm(page);
  await expect(panel.getByRole('checkbox')).toHaveCount(3);
  for (const status of ['ranked', 'loved', 'wip'])
    await expect(
      panel.getByRole('checkbox', { name: `Synthetic ${status} sibling`, exact: true }),
    ).toHaveCount(0);
  const current = panel.getByRole('checkbox', { name: 'Synthetic Normal', exact: true });
  const graveyard = panel.getByRole('checkbox', {
    name: 'Synthetic graveyard sibling',
    exact: true,
  });
  const legacy = panel.getByRole('checkbox', { name: 'Synthetic unranked sibling', exact: true });
  await expect(current).toBeChecked();
  await expect(graveyard).not.toBeChecked();
  await expect(legacy).not.toBeChecked();
  await panel
    .getByRole('textbox', { name: copy.reason })
    .fill('Synthetic selected legacy evidence');
  await panel.getByRole('button', { name: copy.clearSelection, exact: true }).click();
  await expect(current).not.toBeChecked();
  await expect(panel.getByRole('button', { name: copy.send, exact: true })).toBeDisabled();
  expect(state.writes).toHaveLength(0);
  await panel.getByRole('button', { name: copy.selectShown, exact: true }).click();
  await expect(current).toBeChecked();
  await expect(graveyard).toBeChecked();
  await expect(legacy).toBeChecked();
  await current.uncheck();
  await legacy.uncheck();
  await panel.getByRole('button', { name: copy.send, exact: true }).click();
  await expect(panel.getByText(copy.submitted, { exact: true })).toBeVisible();
  expect(state.writes).toEqual([
    {
      path: '/beatmap-rank-requests',
      method: 'POST',
      body: {
        native_set_id: localSetId,
        reason: 'Synthetic selected legacy evidence',
        reason_format: 'markdown',
        difficulty_ids: [localNativeId + 1],
      },
    },
  ]);
  expect(state.rows[0].difficulties.map((difficulty) => difficulty.native_id)).toEqual([
    localNativeId + 1,
  ]);
  expect(state.localDifficulties.map((difficulty) => difficulty.status)).toEqual(statusesBefore);
  expect(
    state.calls.some(
      (call) => call.includes('/set/difficulties?') && call.includes('page_size=100'),
    ),
  ).toBe(true);
  expect(state.calls.some((call) => call.startsWith('GET /admin/'))).toBe(false);
});

test('creation preserves reason and selection across public difficulty pages while select-shown adds only that page', async ({
  page,
}) => {
  const state = await fixture(page);
  state.rows = [];
  state.localDifficulties = Array.from({ length: 104 }, (_, index) => ({
    ...localMap(),
    id: localMapId + index,
    native_id: localNativeId + index,
    version: index === 0 ? 'Synthetic Normal' : `Synthetic paged difficulty ${index + 1}`,
  }));
  await page.goto(`/beatmaps/${localMapId}`);
  const panel = await creationForm(page);
  await expect(panel.getByRole('checkbox')).toHaveCount(100);
  const reason = panel.getByRole('textbox', { name: copy.reason });
  await reason.fill('Synthetic paginated selection draft');
  await panel.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(panel.getByRole('checkbox')).toHaveCount(4);
  await expect(reason).toHaveValue('Synthetic paginated selection draft');
  await panel.getByRole('button', { name: copy.selectShown, exact: true }).click();
  for (let index = 101; index <= 104; index++)
    await expect(
      panel.getByRole('checkbox', { name: `Synthetic paged difficulty ${index}`, exact: true }),
    ).toBeChecked();
  await panel.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(panel.getByRole('checkbox')).toHaveCount(100);
  await expect(
    panel.getByRole('checkbox', { name: 'Synthetic Normal', exact: true }),
  ).toBeChecked();
  await expect(
    panel.getByRole('checkbox', { name: 'Synthetic paged difficulty 2', exact: true }),
  ).not.toBeChecked();
  await expect(reason).toHaveValue('Synthetic paginated selection draft');
  await panel.getByRole('button', { name: copy.send, exact: true }).click();
  await expect(panel.getByText(copy.submitted, { exact: true })).toBeVisible();
  expect(state.writes[0].body).toEqual({
    native_set_id: localSetId,
    reason: 'Synthetic paginated selection draft',
    reason_format: 'markdown',
    difficulty_ids: [
      localNativeId,
      ...Array.from({ length: 4 }, (_, index) => localNativeId + 100 + index),
    ],
  });
  expect(state.calls.some((call) => call.includes('/set/difficulties?page=2&page_size=100'))).toBe(
    true,
  );
  expect(state.calls.some((call) => call.startsWith('GET /admin/'))).toBe(false);
});

test('ineligible, duplicate and limit responses retain the exact creation draft and localized errors', async ({
  page,
}) => {
  const state = await fixture(page);
  state.rows = [];
  await page.goto(`/beatmaps/${localMapId}`);
  const form = await creationForm(page);
  const reason = form.getByRole('textbox', { name: copy.reason });
  await reason.fill('Synthetic preserved request draft');
  for (const failure of [
    { status: 400, code: 'rank_request_ineligible', message: copy.ineligible },
    { status: 409, code: 'rank_request_exists', message: copy.duplicate },
    { status: 429, code: 'rank_request_limit', message: copy.limit },
  ]) {
    state.createError = failure;
    await form.getByRole('button', { name: copy.send, exact: true }).click();
    await expect(form.getByRole('alert')).toHaveText(failure.message);
    await expect(reason).toHaveValue('Synthetic preserved request draft');
    await expect(form.getByRole('button', { name: copy.send, exact: true })).toBeEnabled();
  }
  expect(state.writes).toHaveLength(3);
  await expect(page.locator('body')).not.toContainText('Raw synthetic backend error');
});

test('empty and control-character creation reasons are rejected before any write', async ({
  page,
}) => {
  const state = await fixture(page);
  state.rows = [];
  await page.goto(`/beatmaps/${localMapId}`);
  const form = await creationForm(page);
  const reason = form.getByRole('textbox', { name: copy.reason });
  for (const value of ['   ', 'Synthetic reason\u007fwith a control character']) {
    await reason.fill(value);
    await form.getByRole('button', { name: copy.send, exact: true }).click();
    await expect(form.getByRole('alert')).toHaveText(copy.invalidReason);
  }
  expect(state.writes).toHaveLength(0);
});

test('own collection excludes another account and exposes withdraw only for pending requests', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/beatmaps/rank-requests');
  await expect(page.locator('[data-rank-request-id]')).toHaveCount(4);
  await expect(requestArticle(page)).toContainText(state.rows[0].reason);
  await expect(page.locator('body')).not.toContainText(state.rows[4].reason);
  await expect(page.locator('body')).not.toContainText('Synthetic other requester');
  await expect(page.getByRole('button', { name: copy.withdraw, exact: true })).toHaveCount(1);
  for (const id of [pendingId + 1, pendingId + 2, pendingId + 3]) {
    await expect(requestArticle(page, id).getByRole('button', { name: copy.withdraw })).toHaveCount(
      0,
    );
    await expect(requestArticle(page, id).locator('[data-rank-request-editor]')).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: copy.review, exact: true })).toHaveCount(0);
  expect(state.reads.every((path) => !path.startsWith('/admin/'))).toBe(true);
});

test('an authenticated owner can still read and withdraw after the create grant is removed', async ({
  page,
}) => {
  const state = await fixture(page, []);
  await page.goto('/beatmaps/rank-requests');
  await expect(page.locator('[data-rank-request-id]')).toHaveCount(4);
  const article = requestArticle(page);
  const form = await withdrawForm(article);
  await form.getByRole('button', { name: copy.withdraw, exact: true }).click();
  await expect(article.getByRole('button', { name: copy.withdraw, exact: true })).toHaveCount(0);
  expect(state.writes).toEqual([
    {
      path: `/beatmap-rank-requests/${pendingId}/withdraw`,
      method: 'POST',
      body: { expected_revision: 4 },
    },
  ]);
  await page.goto(`/beatmaps/${localMapId}`);
  await expect(page.getByRole('heading', { name: state.map.title })).toBeVisible();
  await expect(page.getByRole('button', { name: copy.request, exact: true })).toHaveCount(0);
});

test('withdraw conflict blocks retries until explicit detail refresh obtains the current revision', async ({
  page,
}) => {
  const state = await fixture(page);
  state.withdrawConflict = true;
  await page.goto('/beatmaps/rank-requests');
  const article = requestArticle(page);
  const form = await withdrawForm(article);
  await form.getByRole('button', { name: copy.withdraw, exact: true }).click();
  await expect(article.getByRole('alert')).toHaveText(copy.conflict);
  await expect(article.getByRole('button', { name: copy.withdraw, exact: true })).toBeDisabled();
  expect(state.writes[0].body).toEqual({ expected_revision: 4 });
  await article.getByRole('button', { name: copy.refreshRequest, exact: true }).click();
  await expect(article.getByRole('button', { name: copy.withdraw, exact: true })).toBeEnabled();
  await article.getByRole('button', { name: copy.withdraw, exact: true }).click();
  await expect(article.getByRole('button', { name: copy.withdraw, exact: true })).toHaveCount(0);
  expect(state.writes[1]).toEqual({
    path: `/beatmap-rank-requests/${pendingId}/withdraw`,
    method: 'POST',
    body: { expected_revision: 6 },
  });
  expect(state.reads).toContain(`/beatmap-rank-requests/${pendingId}`);
});

test('review conflict preserves rejection reason and decision until explicit request refresh', async ({
  page,
}) => {
  const state = await fixture(page, ['beatmaps.rank.review']);
  state.reviewConflict = true;
  await page.goto('/admin?tab=beatmaps&map_tool=requests');
  const article = requestArticle(page);
  const form = await reviewForm(article);
  const reason = form.getByRole('textbox', { name: copy.reviewReason });
  await reason.fill('  Synthetic rejection evidence  ');
  await selectField(form.getByRole('combobox', { name: copy.decision }), 'rejected');
  await form.getByRole('button', { name: copy.saveDecision, exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText(copy.conflict);
  await expect(reason).toHaveValue('  Synthetic rejection evidence  ');
  await expect(form.getByRole('combobox', { name: copy.decision })).toHaveAttribute(
    'data-value',
    'rejected',
  );
  await expect(form.getByRole('button', { name: copy.saveDecision, exact: true })).toBeDisabled();
  await form.getByRole('button', { name: copy.refreshRequest, exact: true }).click();
  await expect(form.getByRole('button', { name: copy.saveDecision, exact: true })).toBeEnabled();
  await form.getByRole('button', { name: copy.saveDecision, exact: true }).click();
  await expect(article).toHaveCount(0);
  expect(state.writes.map((write) => write.body)).toEqual([
    {
      decision: 'rejected',
      reason: 'Synthetic rejection evidence',
      reason_format: 'markdown',
      expected_revision: 4,
    },
    {
      decision: 'rejected',
      reason: 'Synthetic rejection evidence',
      reason_format: 'markdown',
      expected_revision: 6,
    },
  ]);
  expect(state.reads).toContain(`/beatmap-rank-requests/${pendingId}`);
  expect(state.reads.some((path) => path.startsWith('/admin/beatmap-rank-requests'))).toBe(true);
});

test('review-only staff can navigate to the default queue without unrelated admin reads', async ({
  page,
}) => {
  const state = await fixture(page, ['beatmaps.rank.review']);
  await page.goto('/beatmaps/rank-requests');
  await expect(page.locator('[data-rank-request-id]')).toHaveCount(4);
  await page
    .locator('.desktop-nav')
    .getByRole('link', { name: 'Administration', exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);
  await expect(requestArticle(page)).toBeVisible();
  expect(state.reads.some((path) => path.startsWith('/admin/beatmap-rank-requests'))).toBe(true);
  expect(
    state.calls.some((call) => /^GET \/admin\/(users|roles|beatmaps)(?:\?|$)/.test(call)),
  ).toBe(false);
  const form = await reviewForm(requestArticle(page));
  await expect(form.getByRole('combobox', { name: copy.decision })).toHaveAttribute(
    'data-value',
    'rejected',
  );
  await form.getByRole('combobox', { name: copy.decision }).click();
  await expect(
    page.getByRole('option').and(page.locator('[data-option-value="approved"]')),
  ).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  expect(state.writes).toHaveLength(0);
});

test('approval starts with no selected difficulties and submits only the explicit subset and both revisions', async ({
  page,
}) => {
  const state = await fixture(page, ['beatmaps.rank.review', 'beatmaps.moderate']);
  await page.goto('/admin?tab=beatmaps&map_tool=requests');
  const article = requestArticle(page);
  const form = await reviewForm(article);
  await selectField(form.getByRole('combobox', { name: copy.decision }), 'approved');
  await form
    .getByRole('textbox', { name: copy.reviewReason })
    .fill('  Synthetic selected evidence  ');
  const first = form.getByRole('checkbox', { name: 'Synthetic Normal', exact: true });
  const second = form.getByRole('checkbox', { name: 'Synthetic Hard', exact: true });
  await expect(first).not.toBeChecked();
  await expect(second).not.toBeChecked();
  await expect(form.getByRole('button', { name: copy.saveDecision, exact: true })).toBeDisabled();
  await first.check();
  await expect(second).not.toBeChecked();
  await form.getByRole('button', { name: copy.saveDecision, exact: true }).click();
  await expect(article).toHaveCount(0);
  expect(state.writes).toEqual([
    {
      path: `/admin/beatmap-rank-requests/${pendingId}`,
      method: 'PATCH',
      body: {
        decision: 'approved',
        reason: 'Synthetic selected evidence',
        reason_format: 'markdown',
        expected_revision: 4,
        difficulty_ids: [localNativeId],
        difficulty_revisions: [
          { native_id: localNativeId, expected_revision: 2, expected_status_revision: 3 },
        ],
      },
    },
  ]);
  expect(state.rows[0].approved_difficulty_ids).toEqual([localNativeId]);
  expect(state.rows[0].difficulties.map((difficulty) => difficulty.status)).toEqual([
    'ranked',
    'pending',
  ]);
});

for (const [code, refreshedOverride, refreshedStatus] of [
  ['beatmap_status_conflict', 2, 4],
  ['rank_request_map_changed', 3, 3],
] as const) {
  test(`approval ${code} retains selected subset and draft until explicit refresh obtains both revisions`, async ({
    page,
  }) => {
    const state = await fixture(page, ['beatmaps.rank.review', 'beatmaps.moderate']);
    state.reviewMapConflict = code;
    await page.goto('/admin?tab=beatmaps&map_tool=requests');
    const article = requestArticle(page);
    const form = await reviewForm(article);
    const reason = form.getByRole('textbox', { name: copy.reviewReason });
    await selectField(form.getByRole('combobox', { name: copy.decision }), 'approved');
    await reason.fill('Synthetic preserved subset review');
    const first = form.getByRole('checkbox', { name: 'Synthetic Normal', exact: true });
    const second = form.getByRole('checkbox', { name: 'Synthetic Hard', exact: true });
    await first.check();
    await form.getByRole('button', { name: copy.saveDecision, exact: true }).click();
    await expect(form.getByRole('alert')).toHaveText(
      code === 'rank_request_map_changed' ? copy.manifestChanged : copy.difficultyConflict,
    );
    await expect(reason).toHaveValue('Synthetic preserved subset review');
    await expect(first).toBeChecked();
    await expect(second).not.toBeChecked();
    await expect(form.getByRole('button', { name: copy.saveDecision, exact: true })).toBeDisabled();
    expect(state.writes[0].body.difficulty_revisions).toEqual([
      { native_id: localNativeId, expected_revision: 2, expected_status_revision: 3 },
    ]);
    await form.getByRole('button', { name: copy.refreshRequest, exact: true }).click();
    await expect(reason).toHaveValue('Synthetic preserved subset review');
    await expect(first).toBeChecked();
    await expect(second).not.toBeChecked();
    await form.getByRole('button', { name: copy.saveDecision, exact: true }).click();
    await expect(article).toHaveCount(0);
    expect(state.writes[1].body).toEqual({
      decision: 'approved',
      reason: 'Synthetic preserved subset review',
      reason_format: 'markdown',
      expected_revision: 4,
      difficulty_ids: [localNativeId],
      difficulty_revisions: [
        {
          native_id: localNativeId,
          expected_revision: refreshedOverride,
          expected_status_revision: refreshedStatus,
        },
      ],
    });
  });
}

test('own status and page are URL state and changing status resets page while Back restores it', async ({
  page,
}) => {
  const state = await fixture(page);
  state.rows = Array.from({ length: 26 }, (_, index) => rankRequest(991500 + index));
  await page.goto('/beatmaps/rank-requests?rank_status=all&rank_page=2');
  await expect(page.locator('[data-rank-request-id]')).toHaveCount(2);
  await expect.poll(() => state.reads.at(-1)).toMatch(/page=2/);
  await selectField(page.getByRole('combobox', { name: 'Request status' }), 'rejected');
  await expect(page.getByText('No ranking requests', { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('rank_status')).toBe('rejected');
  expect(new URL(page.url()).searchParams.get('rank_page') ?? '1').toBe('1');
  await page.goBack();
  await expect(page.locator('[data-rank-request-id]')).toHaveCount(2);
  expect(new URL(page.url()).searchParams.get('rank_page')).toBe('2');
  expect(new URL(page.url()).searchParams.get('rank_status')).toBe('all');
});

test('a late authorized collection response cannot restore records after a changed filter gets 403', async ({
  page,
}) => {
  const state = await fixture(page, ['beatmaps.rank.review']);
  await page.goto('/admin?tab=beatmaps&map_tool=requests');
  await expect(requestArticle(page)).toBeVisible();
  state.holdCollection = true;
  await page.getByRole('button', { name: copy.refresh, exact: true }).click();
  await expect.poll(() => state.releaseCollection !== null).toBe(true);
  state.denyRead = true;
  const deniedRead = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/admin/beatmap-rank-requests?') &&
      new URL(response.url()).searchParams.get('status') === 'rejected' &&
      response.status() === 403,
  );
  await selectField(page.getByRole('combobox', { name: 'Request status' }), 'rejected');
  await deniedRead;
  await expect(page.locator('[data-rank-request-id]')).toHaveCount(0);
  state.releaseCollection!();
  await expect.poll(() => state.completedHeldReads).toBe(1);
  await expect(page.locator('[data-rank-request-id]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(state.rows[0].reason);
  await expect(page.getByRole('button', { name: copy.review, exact: true })).toHaveCount(0);
});

test('a saved withdrawal followed by a read failure reports saved state and prevents a duplicate write', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/beatmaps/rank-requests');
  const article = requestArticle(page);
  state.failRefreshAfterWrite = true;
  const form = await withdrawForm(article);
  await form.getByRole('button', { name: copy.withdraw, exact: true }).click();
  await expect(page.getByText(copy.refreshFailed, { exact: true })).toBeVisible();
  await expect(form.getByRole('button', { name: copy.withdraw, exact: true })).toBeDisabled();
  expect(state.writes).toHaveLength(1);
  expect(state.rows[0].status).toBe('withdrawn');
  state.failRefreshAfterWrite = false;
  await page.getByRole('button', { name: copy.refresh, exact: true }).click();
  await expect(page.getByText(copy.refreshFailed, { exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
});

for (const [locale, title, statusLabel, withdraw] of [
  ['zh-TW', '我的圖譜排名申請', '申請狀態', '撤回申請'],
  ['ja', '自分のランク申請', '申請の状態', '申請を取り下げ'],
] as const) {
  test(`localized owner requests retain readable controls at phone width: ${locale}`, async ({
    page,
  }) => {
    await fixture(page, ['beatmaps.rank.request'], locale);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/beatmaps/rank-requests');
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: statusLabel })).toBeVisible();
    await expect(
      requestArticle(page).getByRole('button', { name: withdraw, exact: true }),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText('rankRequests.');
    const geometry = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
  });
}
