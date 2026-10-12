import { test, expect, type Page } from '@playwright/test';

// Synthetic browser responses; no real scores or accounts are changed.
async function account(page: Page, baseURL: string, signedIn = true) {
  await page.context().addCookies([{ name: 'illya_locale', value: 'en', url: baseURL }]);
  await page.route('**/api/v1/me', (route) =>
    signedIn
      ? route.fulfill({
          json: {
            id: 987995,
            username: 'Review fixture',
            email: 'fixture@example.test',
            country: 'TW',
            permissions: [],
            roles: ['player'],
            pp: 0,
            play_count: 0,
            joined_at: '2026-10-12T00:00:00Z',
          },
        })
      : route.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } }),
  );
  await page.route('**/api/v1/me/preferences', (route) =>
    route.fulfill({
      json: {
        locale: 'en',
        accent_color: '#f28eb6',
        background_url: null,
        background_dim: 0.5,
        background_blur: 0,
        theme: 'dark',
        preferred_mode: 0,
        preferred_variant: 'vanilla',
      },
    }),
  );
}
const file = {
  name: 'fixture.osr',
  mimeType: 'application/octet-stream',
  buffer: Buffer.from('synthetic replay; backend parsing is tested separately'),
};

test('mobile resubmission preserves the file on uncertain failure and retries without claiming approval', async ({
  page,
  baseURL,
}) => {
  await account(page, baseURL!);
  await page.setViewportSize({ width: 390, height: 844 });
  let attempts = 0;
  await page.route('**/api/v1/scores/resubmit', (route) => {
    attempts++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['content-type']).toContain('multipart/form-data; boundary=');
    expect(route.request().postDataBuffer()?.toString()).toContain('filename="fixture.osr"');
    return attempts === 1
      ? route.fulfill({ status: 503, json: { error: { code: 'service_unavailable' } } })
      : route.fulfill({ json: { id: 987996, verification: 'pending', idempotent: true } });
  });
  await page.goto('/scores/resubmit');
  await expect(page.getByRole('heading', { name: 'Resubmit a score' })).toBeVisible();
  await page.getByLabel('Replay file', { exact: true }).setInputFiles(file);
  await page.getByRole('button', { name: 'Submit for review', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('Keep the file and retry');
  expect(
    await page
      .getByLabel('Replay file', { exact: true })
      .evaluate((input: HTMLInputElement) => input.files?.[0]?.name),
  ).toBe('fixture.osr');
  await page.getByRole('button', { name: 'Submit for review', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('current review status has been preserved');
  await expect(page.getByRole('link', { name: 'View score and review status' })).toHaveAttribute(
    'href',
    '/scores/987996',
  );
  expect(attempts).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('new replay submissions explain pending review and offer another submission', async ({
  page,
  baseURL,
}) => {
  await account(page, baseURL!);
  await page.route('**/api/v1/scores/resubmit', (route) =>
    route.fulfill({ json: { id: 987996, verification: 'pending', idempotent: false } }),
  );
  await page.goto('/scores/resubmit');
  await page.getByLabel('Replay file', { exact: true }).setInputFiles(file);
  await page.getByRole('button', { name: 'Submit for review', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('pending moderator review');
  await page.getByRole('button', { name: 'Submit another replay' }).click();
  await expect(page.getByRole('button', { name: 'Submit for review', exact: true })).toBeDisabled();
});

test('guests cannot upload', async ({ page, baseURL }) => {
  await account(page, baseURL!, false);
  let requests = 0;
  await page.route('**/api/v1/scores/resubmit', (route) => {
    requests++;
    return route.abort();
  });
  await page.goto('/scores/resubmit');
  await expect(page.getByRole('link', { name: 'Sign in to continue' })).toBeVisible();
  await expect(page.getByLabel('Replay file', { exact: true })).toHaveCount(0);
  expect(requests).toBe(0);
});

test('invalid file selection is rejected before an upload request', async ({ page, baseURL }) => {
  await account(page, baseURL!);
  let requests = 0;
  await page.route('**/api/v1/scores/resubmit', (route) => {
    requests++;
    return route.abort();
  });
  await page.goto('/scores/resubmit');
  await page
    .getByLabel('Replay file', { exact: true })
    .setInputFiles({ ...file, name: 'fixture.txt' });
  await page.getByRole('button', { name: 'Submit for review', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('Choose a valid');
  expect(requests).toBe(0);
});
