import { expect, test, type Page } from '@playwright/test';
import { selectField } from './helpers/field-select';

const stamp = '2026-10-10T04:00:00Z';
const actor = {
  id: 991501,
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
const filters = {
  user_id: null,
  user_name: null,
  variant: 'relax',
  mode: null,
  from: null,
  to: null,
  beatmap_id: null,
  verification: ['pending', 'verified'],
  outdated_only: true,
  min_pp: null,
  max_pp: null,
  score_ids: null,
};
const job = (id: number, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  created_by_name: 'Synthetic moderator',
  filters,
  status,
  total: 40,
  processed: status === 'running' ? 12 : 40,
  updated: 30,
  unchanged: 8,
  skipped: 1,
  failed: 1,
  cancel_requested: false,
  error: null,
  created_at: stamp,
  started_at: stamp,
  finished_at: status === 'running' ? null : stamp,
  ...extra,
});
const item = (score_id: number, outcome: string, extra: Record<string, unknown> = {}) => ({
  score_id,
  outcome,
  previous_pp: 100,
  new_pp: 160.5,
  detail: null,
  username: 'Synthetic player',
  title: 'Fixture title',
  version: 'Fixture difficulty',
  beatmap_id: 991601,
  ...extra,
});
const preview = {
  filters,
  total: 37,
  outdated: 37,
  players: 4,
  pp_sum: 5000,
  by_variant: { vanilla: 0, relax: 37 },
  by_mode: [30, 5, 2, 0],
  current_versions: { vanilla: 'rosu_pp4.v1', relax: 'rosu_pp4.relax.sunrise.v1' },
  sample: [
    {
      id: 991701,
      user_id: 1,
      username: 'Synthetic player',
      title: 'Fixture title',
      artist: 'Fixture artist',
      version: 'Fixture difficulty',
      beatmap_id: 991601,
      mode: 0,
      score_variant: 'relax',
      pp: 120.25,
      pp_calculation_version: 'rosu_pp4.v1',
      created_at: stamp,
    },
  ],
};

async function fixture(page: Page, permissions: string[], jobs: unknown[]) {
  const state = {
    jobs,
    previews: [] as unknown[],
    started: [] as unknown[],
    cancelled: [] as string[],
    startFails: false,
  };
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const body = () => (request.postData() ? JSON.parse(request.postData()!) : {});
    if (path === '/me') return route.fulfill({ json: { ...actor, permissions } });
    if (path === '/me/preferences')
      return route.fulfill({
        json: {
          mode: 'dark',
          locale: 'en',
          accent_color: '#f28eb6',
          background_url: null,
          background_blur: 0,
          background_dim: 0.76,
          panel_blur: 8,
          panel_opacity: 0.55,
          border_radius: 14,
        },
      });
    if (path === '/admin/scores/recalculation/preview') {
      state.previews.push(body());
      return route.fulfill({ json: preview });
    }
    if (path === '/admin/scores/recalculation/jobs' && request.method() === 'POST') {
      state.started.push(body());
      if (state.startFails)
        return route.fulfill({
          status: 409,
          json: { error: { code: 'recalculation_active', message: 'raw' } },
        });
      const created = job(9, 'queued', {
        processed: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        failed: 0,
      });
      state.jobs = [created, ...state.jobs];
      return route.fulfill({ json: created });
    }
    if (path === '/admin/scores/recalculation/jobs')
      return route.fulfill({
        json: { items: state.jobs, total: state.jobs.length, page: 1, page_size: 20 },
      });
    const cancel = path.match(/^\/admin\/scores\/recalculation\/jobs\/(\d+)\/cancel$/);
    if (cancel) {
      state.cancelled.push(cancel[1]);
      state.jobs = state.jobs.map((entry) =>
        (entry as { id: number }).id === Number(cancel[1])
          ? { ...(entry as object), status: 'cancelled', finished_at: stamp }
          : entry,
      );
      return route.fulfill({
        json: state.jobs.find((entry) => (entry as { id: number }).id === Number(cancel[1])),
      });
    }
    if (/^\/admin\/scores\/recalculation\/jobs\/\d+$/.test(path))
      return route.fulfill({
        json: {
          ...job(7, 'completed'),
          pp_delta: 1834.5,
          changes: [
            item(991801, 'updated'),
            item(991802, 'updated', { previous_pp: 80, new_pp: 60 }),
          ],
          problems: [
            item(991803, 'failed', {
              previous_pp: null,
              new_pp: null,
              detail: 'The beatmap file is missing.',
            }),
            item(991804, 'skipped', {
              previous_pp: null,
              new_pp: null,
              detail: 'These mods are not eligible for pp.',
            }),
          ],
        },
      });
    if (path.startsWith('/notifications'))
      return route.fulfill({ json: { items: [], total: 0, unread: 0 } });
    return route.fulfill({
      status: 404,
      json: { error: { code: 'not_found', message: 'fixture' } },
    });
  });
  return state;
}

test('the recalculation tab is only offered to score moderators', async ({ page }) => {
  await fixture(page, ['audit.read'], []);
  await page.goto('/admin');
  await expect(page.getByRole('button', { name: 'Recalculate', exact: true })).toHaveCount(0);
  await page.unroute('**/api/v1/**');
  await fixture(page, ['scores.moderate'], []);
  await page.goto('/admin?tab=recalculation');
  await expect(page.getByRole('heading', { name: 'Recalculate scores' })).toBeVisible();
  await expect(page.getByText('No recalculations yet.')).toBeVisible();
});

test('operators preview the exact filters, then confirm before starting a job', async ({
  page,
}) => {
  const state = await fixture(page, ['scores.moderate'], []);
  await page.goto('/admin?tab=recalculation');
  await page.getByLabel('Player', { exact: true }).fill('  Synthetic player ');
  await selectField(page.getByRole('combobox', { name: 'Score type' }), 'relax');
  await selectField(page.getByRole('combobox', { name: 'Ruleset' }), '0');
  await page.getByLabel('From date').fill('2026-10-01');
  await page.getByLabel('To date').fill('2026-10-09');
  await page.getByLabel('Beatmap ID').fill('991601');
  await page.getByLabel('Minimum pp').fill('50');
  await page.getByLabel('Specific score IDs').fill('5, 6 7');
  await page.getByRole('button', { name: 'Preview matches' }).click();
  await expect(page.getByRole('heading', { name: 'Matching scores' })).toBeVisible();
  expect(state.previews).toEqual([
    {
      filters: {
        user: 'Synthetic player',
        variant: 'relax',
        mode: 0,
        from: '2026-10-01',
        to: '2026-10-09',
        beatmap_id: 991601,
        outdated_only: true,
        min_pp: 50,
        score_ids: [5, 6, 7],
      },
    },
  ]);
  await expect(page.getByText('37', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Fixture title [Fixture difficulty]')).toBeVisible();
  await expect(page.getByText('outdated', { exact: true })).toBeVisible();
  // Changing a filter discards the preview so a job can never run unseen filters.
  await page.getByLabel('Beatmap ID').fill('991602');
  await expect(page.getByRole('heading', { name: 'Matching scores' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview matches' }).click();
  await page.getByRole('button', { name: 'Recalculate 37 scores' }).click();
  await expect(page.getByText('Recalculate 37 scores?')).toBeVisible();
  expect(state.started).toEqual([]);
  await page.getByRole('button', { name: 'Start recalculation' }).click();
  await expect(page.getByText('Recalculation #9 started.')).toBeVisible();
  expect(state.started).toEqual([state.previews.at(-1) as object]);
  await expect(page.getByText('Queued', { exact: true })).toBeVisible();
});

test('malformed fields are explained without calling the server', async ({ page }) => {
  const state = await fixture(page, ['scores.moderate'], []);
  await page.goto('/admin?tab=recalculation');
  await page.getByLabel('Beatmap ID').fill('abc');
  await page.getByRole('button', { name: 'Preview matches' }).click();
  await expect(page.locator('.form-error')).toHaveText(
    'Beatmap ID must be a positive whole number.',
  );
  await page.getByLabel('Beatmap ID').fill('');
  await page.getByLabel('Specific score IDs').fill('1, x');
  await page.getByRole('button', { name: 'Preview matches' }).click();
  await expect(page.locator('.form-error')).toHaveText('Score IDs must be positive whole numbers.');
  expect(state.previews).toEqual([]);
});

test('a running job blocks new ones, shows progress and can be cancelled', async ({ page }) => {
  const state = await fixture(page, ['scores.moderate'], [job(7, 'running')]);
  await page.goto('/admin?tab=recalculation');
  await expect(page.getByRole('progressbar', { name: 'Recalculation progress' })).toHaveAttribute(
    'aria-valuenow',
    '12',
  );
  await expect(page.getByText('12 / 40')).toBeVisible();
  await page.getByRole('button', { name: 'Preview matches' }).click();
  await expect(page.getByText('Recalculation #7 is still running.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Recalculate \d+ scores?$/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
  expect(state.cancelled).toEqual(['7']);
});

test('finished jobs list the biggest changes and the scores that need attention', async ({
  page,
}) => {
  await fixture(page, ['scores.moderate'], [job(7, 'completed')]);
  await page.goto('/admin?tab=recalculation');
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Details' }).click();
  await expect(page.getByText('+1,834.5')).toBeVisible();
  await expect(page.getByText('The beatmap file is missing.')).toBeVisible();
  await expect(page.getByText('These mods are not eligible for pp.')).toBeVisible();
  await expect(page.getByText('100 → 160.5')).toBeVisible();
  await expect(page.getByText('(-20)')).toBeVisible();
  await expect(page.getByRole('link', { name: '#991801' })).toHaveAttribute(
    'href',
    '/scores/991801',
  );
});

test('an active job from another operator is reported when starting', async ({ page }) => {
  const state = await fixture(page, ['scores.moderate'], []);
  state.startFails = true;
  await page.goto('/admin?tab=recalculation');
  await page.getByRole('button', { name: 'Preview matches' }).click();
  await page.getByRole('button', { name: 'Recalculate 37 scores' }).click();
  await page.getByRole('button', { name: 'Start recalculation' }).click();
  await expect(page.locator('.form-error')).toHaveText(
    'Another recalculation is already queued or running. Wait for it or cancel it.',
  );
});
