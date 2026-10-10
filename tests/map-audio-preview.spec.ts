import { test, expect, type Page } from '@playwright/test';

// This is an original synthetic PCM clip. The browser must actually decode and
// advance it: no play(), canplay or media event is mocked. It does not prove
// native lazer playback or the live upstream preview's availability.
function audioFixture() {
  const samples = 8_000 * 20;
  const wave = Buffer.alloc(44 + samples);
  wave.write('RIFF', 0);
  wave.writeUInt32LE(36 + samples, 4);
  wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(8_000, 24);
  wave.writeUInt32LE(8_000, 28);
  wave.writeUInt16LE(1, 32);
  wave.writeUInt16LE(8, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(samples, 40);
  for (let index = 0; index < samples; index++)
    wave[44 + index] = 128 + Math.round(5 * Math.sin((index * 440 * 2 * Math.PI) / 8_000));
  return wave;
}

function officialSet(id: number) {
  return {
    official_set_id: id,
    title: `Audio fixture ${id}`,
    artist: 'Synthetic artist',
    creator: 'Fixture mapper',
    status: 'ranked',
    cover_url: `https://assets.ppy.sh/beatmaps/${id}/covers/card.jpg`,
    official_url: `https://osu.ppy.sh/beatmapsets/${id}`,
    download_disabled: true,
    difficulties: [
      {
        official_id: id * 100,
        version: 'Hard',
        mode: 0,
        stars: 3,
        status: 'ranked',
        length_seconds: 90,
        bpm: 180,
        ar: 9,
        cs: 4,
        od: 8,
        hp: 6,
        max_combo: 400,
      },
    ],
    local: { stored_count: 0, archive_available: false, withdrawn: false },
  };
}

function localSet(id: number, preview: boolean) {
  const map = {
    id: id - 2_000_000_000,
    native_id: id + 10_000,
    native_set_id: id,
    official_id: null,
    official_set_id: null,
    title: `Local audio fixture ${id}`,
    artist: 'Synthetic artist',
    creator: 'Fixture mapper',
    version: 'Hard',
    mode: 0,
    status: 'graveyard',
    source: 'local',
    stars: 3,
    length_seconds: 90,
    bpm: 180,
    max_combo: 400,
    play_count: 0,
    md5: 'a'.repeat(32),
    download_url: `/api/v1/beatmaps/${id - 2_000_000_000}/download`,
    download_kind: preview ? 'osz' : 'osu',
    package: preview
      ? {
          id: '00000000-0000-4000-8000-000000000100',
          native_set_id: id,
          kind: 'osz',
          legacy: false,
          difficulty_count: 1,
          beatmap_ids: [id - 2_000_000_000],
          download_url: `/api/v1/beatmaps/${id - 2_000_000_000}/archive`,
        }
      : null,
  };
  return {
    kind: 'stored',
    stored: {
      native_set_id: id,
      representative: map,
      matching_count: 1,
      stored_count: 1,
      matching_modes: [0],
      matching_statuses: ['graveyard'],
      stars_min: 3,
      stars_max: 3,
      length_min: 90,
      length_max: 90,
      added_at: '2026-10-10T00:00:00Z',
      preview: [map],
      preview_available: preview ? null : false,
    },
  };
}

async function fixture(page: Page) {
  await page
    .context()
    .addCookies([
      { name: 'illya_locale', value: 'en', url: test.info().project.use.baseURL as string },
    ]);
  const state = {
    audioRequests: [] as number[],
    queries: [] as URLSearchParams[],
    directMedia: [] as string[],
    failAudio: false,
    holdAudio: false,
    release: null as (() => void) | null,
  };
  await page.route('https://assets.ppy.sh/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="124"><rect width="96" height="124" fill="#343034"/></svg>',
    }),
  );
  await page.route('https://b.ppy.sh/**', (route) => {
    state.directMedia.push(route.request().url());
    return route.abort();
  });
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.replace('/api/v1', '');
    if (endpoint === '/me')
      return route.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } });
    if (endpoint === '/official/beatmapsets/search') {
      state.queries.push(new URLSearchParams(url.searchParams));
      const emptyPage =
        url.searchParams.get('q') === 'between' && !url.searchParams.has('cursor_string');
      return route.fulfill({
        json: {
          items: emptyPage
            ? []
            : url.searchParams.has('status_modified_only')
              ? [officialSet(42)]
              : [officialSet(42), officialSet(43)],
          total: 2,
          total_is_exact: false,
          ordering: 'server_modified_first',
          cursor_string: emptyPage ? 'illyaf2.next' : null,
        },
      });
    }
    if (endpoint === '/server/beatmapsets')
      return route.fulfill({
        json: {
          items: [localSet(2_000_000_100, true), localSet(2_000_000_101, false)],
          total: 2,
          page: 1,
          page_size: 24,
        },
      });
    return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });
  await page.route('**/api/v2/beatmapsets/*/preview', async (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/')[4]);
    state.audioRequests.push(id);
    if (state.holdAudio)
      await new Promise<void>((resolve) => {
        state.release = resolve;
      });
    if (state.failAudio)
      return route
        .fulfill({ status: 415, contentType: 'application/json', body: '{}' })
        .catch(() => {});
    return route.fulfill({ contentType: 'audio/wav', body: audioFixture() }).catch(() => {});
  });
  return state;
}

test('previews load only on click, actually decode, and stop when switching tracks', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/beatmaps');
  const cards = page.locator('.discovery-set');
  await expect(cards).toHaveCount(2);
  expect(state.audioRequests).toEqual([]);
  await expect(cards.nth(0).locator('audio')).not.toHaveAttribute('src');
  await cards
    .nth(0)
    .getByRole('button', { name: 'Play preview: Audio fixture 42', exact: true })
    .click();
  await expect
    .poll(() =>
      cards
        .nth(0)
        .locator('audio')
        .evaluate(
          (audio: HTMLAudioElement) =>
            !audio.paused && audio.currentTime > 0.2 && audio.readyState >= 2,
        ),
    )
    .toBe(true);
  await expect(cards.nth(0).locator('audio')).toHaveAttribute(
    'src',
    '/api/v2/beatmapsets/42/preview',
  );
  await cards
    .nth(1)
    .getByRole('button', { name: 'Play preview: Audio fixture 43', exact: true })
    .click();
  await expect
    .poll(() =>
      cards
        .nth(1)
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => !audio.paused && audio.currentTime > 0.2),
    )
    .toBe(true);
  await expect(cards.nth(0).locator('audio')).not.toHaveAttribute('src');
  await expect(
    cards.nth(0).getByRole('button', { name: 'Play preview: Audio fixture 42', exact: true }),
  ).toBeVisible();
  await cards
    .nth(1)
    .getByRole('button', { name: 'Pause preview: Audio fixture 43', exact: true })
    .click();
  const pausedAt = await cards
    .nth(1)
    .locator('audio')
    .evaluate((audio: HTMLAudioElement) => audio.currentTime);
  expect(
    await cards
      .nth(1)
      .locator('audio')
      .evaluate((audio: HTMLAudioElement) => audio.paused),
  ).toBe(true);
  await cards
    .nth(1)
    .getByRole('button', { name: 'Play preview: Audio fixture 43', exact: true })
    .click();
  await expect
    .poll(() =>
      cards
        .nth(1)
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(pausedAt);
  expect(state.directMedia).toEqual([]);
});

test('a client-side catalogue change releases the previous playing element', async ({ page }) => {
  await fixture(page);
  await page.goto('/beatmaps');
  await page.getByRole('button', { name: 'Play preview: Audio fixture 42', exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .first()
        .evaluate((audio: HTMLAudioElement) => audio.currentTime > 0.2),
    )
    .toBe(true);
  // Keep the removed element so an unmounted DOM node alone cannot pass the
  // test without pausing playback and releasing its requested source.
  await page.evaluate(() => {
    (window as unknown as { formerAudio: HTMLAudioElement }).formerAudio =
      document.querySelector('audio')!;
  });
  await page.locator('.catalogue-source a').nth(1).click();
  await expect(page.locator('.server-map-discovery')).toBeVisible();
  expect(
    await page.evaluate(() => {
      const audio = (window as unknown as { formerAudio: HTMLAudioElement }).formerAudio;
      return audio.paused && audio.getAttribute('src') === null;
    }),
  ).toBe(true);
});

test('preview errors allow retry and pending playback can be cancelled', async ({ page }) => {
  const state = await fixture(page);
  state.failAudio = true;
  await page.goto('/beatmaps');
  const card = page.locator('.discovery-set').first();
  await card.getByRole('button', { name: 'Play preview: Audio fixture 42', exact: true }).click();
  await expect(card.getByRole('status')).toHaveText('Preview unavailable');
  state.failAudio = false;
  await card.getByRole('button', { name: 'Retry preview: Audio fixture 42', exact: true }).click();
  await expect(
    card.getByRole('button', { name: 'Pause preview: Audio fixture 42', exact: true }),
  ).toBeVisible();
  await card.getByRole('button', { name: 'Pause preview: Audio fixture 42', exact: true }).click();
  expect(await card.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(
    true,
  );
  // Use a fresh component for the held request, avoiding a buffered paused clip.
  await page.goto('/beatmaps');
  state.holdAudio = true;
  await card.getByRole('button', { name: 'Play preview: Audio fixture 42', exact: true }).click();
  await expect.poll(() => state.release !== null).toBe(true);
  await card
    .getByRole('button', { name: 'Cancel loading preview: Audio fixture 42', exact: true })
    .click();
  state.release?.();
  await expect(card.locator('audio')).not.toHaveAttribute('src');
  await expect(
    card.getByRole('button', { name: 'Play preview: Audio fixture 42', exact: true }),
  ).toBeVisible();
  await expect(card.getByRole('status')).toHaveCount(0);
});

test('local preview uses numeric native identity only when availability is advertised', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/beatmaps?catalogue=server');
  const cards = page.locator('.discovery-set');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(1).locator('audio')).toHaveCount(0);
  await cards
    .nth(0)
    .getByRole('button', { name: 'Play preview: Local audio fixture 2000000100', exact: true })
    .click();
  await expect.poll(() => state.audioRequests.includes(2_000_000_100)).toBe(true);
  await expect(cards.nth(0).locator('audio')).toHaveAttribute(
    'src',
    '/api/v2/beatmapsets/2000000100/preview',
  );
});

test('modified-status checkbox preserves filters, resets an opaque cursor, and supports history', async ({
  page,
}) => {
  const state = await fixture(page);
  const cursor = `illyaf2.${'a'.repeat(3000)}`;
  await page.goto(`/beatmaps?status=ranked&q=fixture&cursor=${cursor}`);
  await expect(page.locator('.discovery-set')).toHaveCount(2);
  expect(state.queries.at(-1)?.get('cursor_string')).toBe(cursor);
  const checkbox = page.getByRole('checkbox', { name: 'Only status changed on this server' });
  // This controlled state follows the committed URL. Click and wait for that
  // state, rather than check()'s immediate post-click DOM assertion.
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect.poll(() => state.queries.at(-1)?.get('status_modified_only')).toBe('true');
  expect(state.queries.at(-1)?.get('cursor_string')).toBeNull();
  expect(state.queries.at(-1)?.get('status')).toBe('ranked');
  expect(state.queries.at(-1)?.get('q')).toBe('fixture');
  await expect(page).toHaveURL(/status_modified_only=true/);
  await expect(page.locator('.discovery-set')).toHaveCount(1);
  await expect(page.locator('.discovery-result-count')).toContainText('About 2 sets');
  await page.goBack();
  await expect(checkbox).not.toBeChecked();
  await expect.poll(() => state.queries.at(-1)?.get('cursor_string')).toBe(cursor);
});

test('an empty federated page keeps its continuation available', async ({ page }) => {
  await fixture(page);
  await page.goto('/beatmaps?q=between');
  await expect(
    page.getByText('No matches on this page. Continue to see more results.'),
  ).toBeVisible();
  await page.locator('.discovery-pagination').getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('.discovery-set')).toHaveCount(2);
  await expect(page).toHaveURL(/cursor=illyaf2.next/);
});
