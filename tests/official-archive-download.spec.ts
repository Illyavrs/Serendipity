import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import {
  archiveDownloadErrorKey,
  MAX_OFFICIAL_ARCHIVE_BYTES,
  officialArchiveDownloadUrl,
  readOfficialArchive,
} from '../src/lib/archive-download';
import { ApiError } from '../src/lib/api';
import type { OfficialBeatmapset } from '../src/lib/types';
import english from '../messages/en.json';
import chinese from '../messages/zh-TW.json';
import japanese from '../messages/ja.json';

// Locally made ZIP transport fixture. It is not a playable or persisted beatmap package.
const zip = Buffer.from(
  'UEsDBBQAAAAIACcTSl2GkNE1GwAAABMAAAALAAAAZml4dHVyZS5vc3XKLy5VSMvMSVVIyy/KTSxRKDM0AQAAAP//AwBQSwECFAAUAAAACAAnE0pdhpDRNRsAAAATAAAACwAAAAAAAAAAAAAAAAAAAAAAZml4dHVyZS5vc3VQSwUGAAAAAAEAAQA5AAAARAAAAAAA',
  'base64',
);
const copies = { en: english, 'zh-TW': chinese, ja: japanese };
const archiveUrl = '/api/v1/official/beatmapsets/42/archive';
const fixturePort = Number(process.env.ILLYA_ARCHIVE_FIXTURE_PORT ?? 0);
let archiveServer: Server | null = null;
const nativeArchiveRequests: string[] = [];
// Chromium attachment requests bypass page.route. This optional, loopback-only
// fixture is the Next API rewrite target for this suite, never a real provider.
test.beforeAll(async () => {
  if (!fixturePort) return;
  if (!Number.isInteger(fixturePort) || fixturePort < 1024 || fixturePort > 65535)
    throw new Error('ILLYA_ARCHIVE_FIXTURE_PORT must be an unprivileged localhost port.');
  archiveServer = createServer((request, response) => {
    const pathname = new URL(request.url!, 'http://127.0.0.1').pathname;
    if (
      request.method === 'GET' &&
      [archiveUrl, '/api/v1/beatmaps/930001/archive'].includes(pathname)
    ) {
      nativeArchiveRequests.push(pathname);
      response.writeHead(200, {
        'content-type': 'application/x-osu-archive',
        'content-length': zip.length,
        'content-disposition': 'attachment; filename="illyaverse-official-42.osz"',
        'cache-control': 'no-store',
      });
      response.end(zip);
    } else {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'unknown_fixture_route' } }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    archiveServer!.once('error', reject);
    archiveServer!.listen(fixturePort, '127.0.0.1', resolve);
  });
});
test.afterAll(async () => {
  if (archiveServer)
    await new Promise<void>((resolve, reject) =>
      archiveServer!.close((error) => (error ? reject(error) : resolve())),
    );
});
function set(): OfficialBeatmapset {
  return {
    official_set_id: 42,
    title: 'Archive availability fixture',
    artist: 'Synthetic artist',
    creator: 'Synthetic mapper',
    status: 'ranked',
    cover_url: 'https://assets.ppy.sh/beatmaps/42/covers/card.jpg',
    official_url: 'https://osu.ppy.sh/beatmapsets/42',
    download_disabled: false,
    archive_download_available: true,
    archive_download_url: archiveUrl,
    local: { stored_count: 0, archive_available: false, withdrawn: false },
    difficulties: [
      {
        official_id: 4200,
        version: 'Complete metadata',
        mode: 0,
        stars: 3,
        status: 'ranked',
        length_seconds: 90,
        checksum: 'a'.repeat(32),
        bpm: 180,
        ar: 9,
        cs: 4,
        od: 8,
        hp: 6,
        max_combo: 300,
      },
    ],
  };
}

test.describe('archive transport unit contracts', () => {
  test('configured acquisition accepts only the exact authoritative same-origin set route', () => {
    const data = set();
    expect(officialArchiveDownloadUrl(data)).toBe(archiveUrl);
    for (const url of [
      null,
      'https://osu.direct/api/d/42',
      '//evil.invalid/archive',
      `${archiveUrl}?url=https://evil.invalid`,
      '/api/v1/official/beatmapsets/43/archive',
    ])
      expect(officialArchiveDownloadUrl({ ...data, archive_download_url: url })).toBeNull();
    expect(officialArchiveDownloadUrl({ ...data, archive_download_available: false })).toBeNull();
    expect(
      officialArchiveDownloadUrl({ ...data, archive_download_available: undefined }),
    ).toBeNull();
    expect(officialArchiveDownloadUrl({ ...data, download_disabled: true })).toBeNull();
  });
  test('retained archives take priority without upstream acquisition permission', () => {
    const data = set();
    data.local.archive_available = true;
    data.download_disabled = true;
    data.archive_download_available = false;
    data.difficulties[0].local_id = 930001;
    data.difficulties[0].archive_available = true;
    expect(officialArchiveDownloadUrl(data)).toBe('/api/v1/beatmaps/930001/archive');
    data.local.withdrawn = true;
    expect(officialArchiveDownloadUrl(data)).toBeNull();
  });
  test('a successful complete ZIP transport preserves exact bytes', async () => {
    const result = await readOfficialArchive(
      new Response(zip, {
        headers: {
          'content-type': 'application/x-osu-archive',
          'content-length': String(zip.length),
        },
      }),
    );
    expect(Buffer.from(await result.arrayBuffer())).toEqual(zip);
  });
  test('HTML, single difficulty, incorrect ZIP signatures and oversized declarations never become a download', async () => {
    for (const response of [
      new Response('<html>provider failure</html>', { headers: { 'content-type': 'text/html' } }),
      new Response('osu file format v14', {
        headers: { 'content-type': 'application/x-osu-archive' },
      }),
      new Response(zip, {
        headers: {
          'content-type': 'application/x-osu-archive',
          'content-length': String(MAX_OFFICIAL_ARCHIVE_BYTES + 1),
        },
      }),
    ])
      await expect(readOfficialArchive(response)).rejects.toBeInstanceOf(ApiError);
  });
  test('provider failures keep machine codes but never render raw provider messages', async () => {
    await expect(
      readOfficialArchive(
        new Response(
          JSON.stringify({
            error: { code: 'official_archive_timeout', message: 'RAW_SECRET_PROVIDER_MESSAGE' },
          }),
          { status: 503 },
        ),
      ),
    ).rejects.toMatchObject({ status: 503, code: 'official_archive_timeout' });
    expect(archiveDownloadErrorKey(new ApiError(429, 'x', 'RAW_SECRET_PROVIDER_MESSAGE'))).toBe(
      'archiveDownloadLimited',
    );
    expect(
      archiveDownloadErrorKey(
        new ApiError(502, 'official_archive_manifest_mismatch', 'RAW_SECRET_PROVIDER_MESSAGE'),
      ),
    ).toBe('archiveDownloadInvalid');
  });
  test('an undeclared body still enforces the byte ceiling and cancels its reader', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_OFFICIAL_ARCHIVE_BYTES + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      readOfficialArchive(
        new Response(body, {
          headers: { 'content-type': 'application/x-osu-archive' },
        }),
      ),
    ).rejects.toMatchObject({ status: 413, code: 'official_archive_too_large' });
    expect(cancelled).toBe(true);
  });
});

async function fixture(page: Page, locale: keyof typeof copies = 'en') {
  await page
    .context()
    .addCookies([
      { name: 'illya_locale', value: locale, url: test.info().project.use.baseURL as string },
    ]);
  const state = {
    data: set(),
    metadataCalls: 0,
    downloadCalls: 0,
    outcomes: [] as { status: number; code: string }[],
    hold: false,
    release: null as (() => void) | null,
    metadataFailure: false,
    storedArchive: false,
    unexpected: [] as string[],
  };
  await page.route('https://assets.ppy.sh/**', (route) => route.abort());
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== 'GET') throw new Error('Archive UI must not mutate or import data.');
    if (pathname === '/api/v1/me')
      return route.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } });
    if (pathname === '/api/v1/official/beatmapsets/42') {
      state.metadataCalls++;
      return state.metadataFailure
        ? route.fulfill({ status: 503, json: { error: { code: 'official_search_timeout' } } })
        : route.fulfill({ json: state.data });
    }
    if (pathname === archiveUrl || pathname === '/api/v1/beatmaps/930001/archive') {
      state.downloadCalls++;
      if (state.hold)
        await new Promise<void>((resolve) => {
          state.release = resolve;
        });
      const outcome = state.outcomes.shift();
      return outcome
        ? route.fulfill({
            status: outcome.status,
            json: { error: { code: outcome.code, message: 'RAW_PROVIDER_MESSAGE' } },
          })
        : route
            .fulfill({
              body: zip,
              headers: {
                'content-type': 'application/x-osu-archive',
                'content-disposition': 'attachment; filename="illyaverse-official-42.osz"',
              },
            })
            .catch(() => {});
    }
    if (pathname === '/api/v1/beatmaps/930001')
      return route.fulfill({
        json: {
          ...state.data.difficulties[0],
          id: 930001,
          official_id: 4200,
          official_set_id: 42,
          native_set_id: 42,
          title: state.data.title,
          artist: state.data.artist,
          creator: state.data.creator,
          source: 'official',
          bpm: 180,
          max_combo: 300,
          play_count: 0,
          md5: 'a'.repeat(32),
          package: state.storedArchive
            ? {
                id: '3a646ab0-bf9a-4910-ac35-9be12b387dca',
                native_set_id: 42,
                kind: 'osz',
                legacy: false,
                difficulty_count: 1,
                beatmap_ids: [930001],
                download_url: '/api/v1/beatmaps/930001/archive',
                source: 'official',
              }
            : null,
          download_kind: state.storedArchive ? 'osz' : 'osu',
          download_url: '/api/v1/beatmaps/930001/download',
        },
      });
    if (pathname === '/api/v1/beatmaps/930001/set/difficulties')
      return route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 24 } });
    if (pathname === '/api/v1/beatmaps/930001/scores')
      return route.fulfill({
        json: {
          items: [],
          total: 0,
          page: 1,
          page_size: 50,
          mode: 0,
          score_variant: 'vanilla',
          ordered_by: 'standardised_score',
        },
      });
    state.unexpected.push(pathname);
    return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });
  return { state, copy: copies[locale] };
}

test('unconfigured or restricted acquisition stays metadata-only with an official-site fallback', async ({
  page,
}) => {
  const { state, copy } = await fixture(page);
  state.data.archive_download_available = false;
  state.data.archive_download_url = null;
  await page.goto('/beatmaps/official/42');
  await expect(
    page.getByRole('button', { name: copy.maps.downloadPackage, exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(copy.maps.officialArchiveUnavailableHint, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: copy.maps.officialSetPage, exact: true }),
  ).toHaveAttribute('href', state.data.official_url);
  expect(state.downloadCalls).toBe(0);
});

test('configured acquisition downloads exact ZIP bytes once and keeps the page and navigation indicator settled', async ({
  page,
}) => {
  const { state, copy } = await fixture(page);
  state.hold = true;
  await page.goto('/beatmaps/official/42?difficulty=4200');
  const link = page.getByRole('link', { name: copy.maps.downloadPackage, exact: true });
  await expect(link).toHaveAttribute('href', archiveUrl);
  await expect(link).toHaveAttribute('download', '');
  const buttonWidth = await link.evaluate((node) => node.getBoundingClientRect().width);
  expect(buttonWidth).toBeLessThan(240);
  await expect(
    page.getByText(copy.maps.configuredArchiveDownloadHint, { exact: true }),
  ).toBeVisible();
  await link.click();
  await expect.poll(() => state.downloadCalls).toBe(1);
  const busy = page.getByRole('link', { name: copy.maps.preparingArchiveDownload, exact: true });
  await expect(busy).toHaveAttribute('aria-busy', 'true');
  // Fault-inject the second ordinary click despite the semantic disabled state.
  await busy.click({ force: true });
  expect(state.downloadCalls).toBe(1);
  const attachment = page.waitForEvent('download');
  state.release!();
  const download = await attachment;
  expect(download.suggestedFilename()).toBe('illyaverse-official-42.osz');
  expect(await readFile((await download.path())!)).toEqual(zip);
  await expect(link).not.toHaveAttribute('aria-busy', 'true');
  await expect(page).toHaveURL(/\/beatmaps\/official\/42\?difficulty=4200$/);
  await expect(page.locator('.navigation-progress')).toHaveAttribute('data-pending', 'false');
  expect(state.unexpected).toEqual([]);
});

for (const locale of ['en', 'zh-TW', 'ja'] as const) {
  test(`provider error and retry stay on page with ${locale} recovery copy`, async ({ page }) => {
    const { state, copy } = await fixture(page, locale);
    state.outcomes.push({ status: 429, code: 'official_archive_rate_limited' });
    await page.goto('/beatmaps/official/42');
    await page.getByRole('link', { name: copy.maps.downloadPackage, exact: true }).click();
    const alert = page.locator('.official-archive-download [role="alert"]');
    await expect(alert).toContainText(copy.maps.archiveDownloadLimited);
    await expect(alert).not.toContainText('RAW_PROVIDER_MESSAGE');
    const attachment = page.waitForEvent('download');
    await alert.getByRole('button', { name: copy.mapDiscovery.retry, exact: true }).click();
    await attachment;
    await expect(alert).toHaveCount(0);
    expect(state.downloadCalls).toBe(2);
    await expect(page).toHaveURL(/\/beatmaps\/official\/42$/);
  });
}

test('stored difficulty availability failures recover without offering a fabricated package', async ({
  page,
}) => {
  const { state, copy } = await fixture(page);
  state.metadataFailure = true;
  await page.goto('/beatmaps/930001');
  await expect(page.locator('.map-downloads [role="alert"]')).toHaveText(
    copy.maps.archiveAvailabilityError,
  );
  await expect(
    page.getByRole('button', { name: copy.maps.downloadPackage, exact: true }),
  ).toBeDisabled();
  state.metadataFailure = false;
  const initialMetadataCalls = state.metadataCalls;
  await page
    .locator('.map-downloads')
    .getByRole('button', { name: copy.mapDiscovery.retry, exact: true })
    .click();
  await expect(
    page.getByRole('link', { name: copy.maps.downloadPackage, exact: true }),
  ).toHaveAttribute('href', archiveUrl);
  expect(state.metadataCalls).toBe(initialMetadataCalls + 1);
  expect(state.downloadCalls).toBe(0);
});

test('retained archive remains usable when new upstream acquisition is restricted', async ({
  page,
}) => {
  test.skip(
    !fixturePort,
    'Run with a loopback archive HTTP fixture as the Next API rewrite target.',
  );
  const { state, copy } = await fixture(page);
  state.data.download_disabled = true;
  state.data.archive_download_available = false;
  state.data.local.archive_available = true;
  state.data.difficulties[0].local_id = 930001;
  state.data.difficulties[0].archive_available = true;
  await page.goto('/beatmaps/official/42');
  const link = page.getByRole('link', { name: copy.maps.downloadPackage, exact: true });
  await expect(link).toHaveAttribute('href', '/api/v1/beatmaps/930001/archive');
  await expect(page.getByText(copy.maps.archiveDownloadHint, { exact: true })).toBeVisible();
  const attachment = page.waitForEvent('download');
  const initialNativeRequests = nativeArchiveRequests.length;
  await link.click();
  expect((await attachment).suggestedFilename()).toMatch(/\.osz$/);
  expect(state.downloadCalls + nativeArchiveRequests.length - initialNativeRequests).toBe(1);
});

test('stored complete osz downloads without requesting unavailable official metadata', async ({
  page,
}) => {
  test.skip(
    !fixturePort,
    'Run with a loopback archive HTTP fixture as the Next API rewrite target.',
  );
  const { state, copy } = await fixture(page);
  state.storedArchive = true;
  state.metadataFailure = true;
  await page.goto('/beatmaps/930001');
  const link = page.getByRole('link', { name: copy.maps.downloadPackage, exact: true });
  await expect(link).toHaveAttribute('href', '/api/v1/beatmaps/930001/archive');
  await expect(page.getByText(copy.maps.archiveDownloadHint, { exact: true })).toBeVisible();
  const attachment = page.waitForEvent('download');
  const initialNativeRequests = nativeArchiveRequests.length;
  await link.click();
  const download = await attachment;
  expect(await readFile((await download.path())!)).toEqual(zip);
  expect(state.metadataCalls).toBe(0);
  expect(state.downloadCalls + nativeArchiveRequests.length - initialNativeRequests).toBe(1);
  expect(state.unexpected).toEqual([]);
});

for (const gesture of ['Control', 'middle'] as const) {
  test(`${gesture} archive link keeps native anchor behavior instead of the fetch interceptor`, async ({
    page,
  }) => {
    test.skip(
      !fixturePort,
      'Run with a loopback archive HTTP fixture as the Next API rewrite target.',
    );
    const { state, copy } = await fixture(page);
    await page.addInitScript(() => {
      const evidence = {
        fetches: [] as string[],
        events: [] as { type: string; button: number; control: boolean; cancelled: boolean }[],
      };
      Object.assign(window, { archiveGestureEvidence: evidence });
      const original = window.fetch;
      window.fetch = (...args) => {
        const input = args[0];
        const url = input instanceof Request ? input.url : String(input);
        if (/\/archive$/.test(url)) evidence.fetches.push(url);
        return original(...args);
      };
      for (const type of ['click', 'auxclick']) {
        window.addEventListener(type, (event) => {
          const mouse = event as MouseEvent;
          const anchor = (mouse.target as Element)?.closest('a[download]');
          if (anchor)
            evidence.events.push({
              type,
              button: mouse.button,
              control: mouse.ctrlKey,
              cancelled: mouse.defaultPrevented,
            });
        });
      }
    });
    await page.goto('/beatmaps/official/42');
    const link = page.getByRole('link', { name: copy.maps.downloadPackage, exact: true });
    await expect(link).toHaveAttribute('download', '');
    const attachment = page.waitForEvent('download');
    const initialNativeRequests = nativeArchiveRequests.length;
    await link.click(gesture === 'middle' ? { button: 'middle' } : { modifiers: ['Control'] });
    const download = await attachment;
    expect(await readFile((await download.path())!)).toEqual(zip);
    const evidence = await page.evaluate(
      () =>
        (
          window as unknown as {
            archiveGestureEvidence: {
              fetches: string[];
              events: { type: string; button: number; control: boolean; cancelled: boolean }[];
            };
          }
        ).archiveGestureEvidence,
    );
    expect(evidence.fetches).toEqual([]);
    expect(evidence.events).toContainEqual(
      gesture === 'middle'
        ? { type: 'auxclick', button: 1, control: false, cancelled: false }
        : { type: 'click', button: 0, control: true, cancelled: false },
    );
    expect(state.downloadCalls + nativeArchiveRequests.length - initialNativeRequests).toBe(1);
    await expect(page.locator('.navigation-progress')).toHaveAttribute('data-pending', 'false');
    await expect(page).toHaveURL(/\/beatmaps\/official\/42$/);
  });
}

test('leaving a page cancels pending acquisition without a stale download or error', async ({
  page,
}) => {
  const { state, copy } = await fixture(page);
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));
  state.hold = true;
  await page.goto('/beatmaps/official/42');
  await page.getByRole('link', { name: copy.maps.downloadPackage, exact: true }).click();
  await expect.poll(() => state.downloadCalls).toBe(1);
  await page.goto('/beatmaps/930001');
  state.release!();
  await expect(
    page.getByRole('link', { name: copy.maps.downloadPackage, exact: true }),
  ).toHaveAttribute('href', archiveUrl);
  await expect(page.locator('.official-archive-download [role="alert"]')).toHaveCount(0);
  expect(downloads).toEqual([]);
  expect(state.downloadCalls).toBe(1);
});

test('bounded acquisition timeout clears busy state and provides retry without navigating', async ({
  page,
}) => {
  const { state, copy } = await fixture(page);
  state.hold = true;
  await page.goto('/beatmaps/official/42');
  await page.clock.install();
  await page.getByRole('link', { name: copy.maps.downloadPackage, exact: true }).click();
  await expect.poll(() => state.downloadCalls).toBe(1);
  await page.clock.runFor(65_001);
  const alert = page.locator('.official-archive-download [role="alert"]');
  await expect(alert).toContainText(copy.maps.archiveDownloadTimeout);
  await expect(
    page.getByRole('link', { name: copy.maps.downloadPackage, exact: true }),
  ).not.toHaveAttribute('aria-busy', 'true');
  state.release!();
  await expect(page.locator('.navigation-progress')).toHaveAttribute('data-pending', 'false');
  await expect(page).toHaveURL(/\/beatmaps\/official\/42$/);
});
