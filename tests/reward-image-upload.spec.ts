import { expect, test, type Page } from '@playwright/test';
import { selectField } from './helpers/field-select';
import type { AdminReward } from '../src/lib/rewards';

// All accounts and media below are synthetic HTTP fixtures; no real player is changed.
const stamp = '2026-10-13T00:00:00Z';
const frameId = 993501;
const imageUrl = '/media/reward-frames/00000000-0000-4000-8000-000000000001.png';
function frame(): AdminReward {
  return {
    id: frameId,
    name: 'Synthetic image frame',
    description: '',
    kind: 'avatar_frame',
    price: 20,
    color: null,
    style: 'image',
    image_url: null,
    active: false,
    revision: 7,
    owned_count: 0,
    created_at: stamp,
    updated_at: stamp,
  };
}
async function png(page: Page, width = 512, height = width) {
  const encoded = await page.evaluate(
    ({ width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d')!;
      context.strokeStyle = '#f28eb6';
      context.lineWidth = 12;
      context.strokeRect(8, 8, width - 16, height - 16);
      return canvas.toDataURL('image/png').split(',')[1];
    },
    { width, height },
  );
  return Buffer.from(encoded, 'base64');
}
async function fixture(page: Page, locale = 'en', permissions = ['rewards.manage']) {
  const preferences = {
    mode: 'dark',
    locale,
    glass_level: 100,
    accent_color: '#f28eb6',
    panel_blur: 8,
    panel_opacity: 0.55,
  };
  const store = {
    viewerId: 993001,
    signedIn: true,
    selfEquipped: false,
    sessionReads: 0,
    permissions,
    catalog: [frame()],
    reads: 0,
    readFailure: 0,
    uploadFailure: 0,
    uncertain: false,
    holdUpload: false,
    releaseUpload: null as (() => void) | null,
    uploads: [] as { revision: number; contentType: string; filename: string }[],
    writes: [] as { method: string; body: Record<string, unknown> }[],
  };
  await page
    .context()
    .addCookies([
      { name: 'illya_locale', value: locale, url: test.info().project.use.baseURL as string },
    ]);
  await page.addInitScript(
    (value) => localStorage.setItem('illya_appearance', JSON.stringify(value)),
    preferences,
  );
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const failure = (status: number, code: string) =>
      route.fulfill({
        status,
        json: { error: { code, message: 'Private untranslated server details' } },
      });
    if (path === '/me') {
      store.sessionReads++;
      return store.signedIn
        ? route.fulfill({
            json: {
              id: store.viewerId,
              username: `Synthetic administrator ${store.viewerId}`,
              country: 'TW',
              avatar_url: null,
              banner_url: null,
              accent_color: '#f28eb6',
              permissions: store.permissions,
              roles: [],
              pp: 0,
              play_count: 0,
              joined_at: stamp,
              bio: '',
              cosmetics: {
                title: null,
                avatar_frame: store.selfEquipped
                  ? (store.catalog.find((item) => item.id === frameId) ?? null)
                  : null,
              },
            },
          })
        : failure(401, 'unauthorized');
    }
    if (path === '/me/preferences') return route.fulfill({ json: preferences });
    if (path === '/me/relationships') return route.fulfill({ json: { friends: [], blocks: [] } });
    if (path === '/admin/rewards' && request.method() === 'GET') {
      store.reads++;
      if (store.readFailure)
        return failure(
          store.readFailure,
          store.readFailure === 403 ? 'forbidden' : 'service_unavailable',
        );
      return route.fulfill({
        json: { items: store.catalog, page: 1, page_size: 12, total: store.catalog.length },
      });
    }
    if (path.endsWith('/image')) {
      const body = request.postDataBuffer()!.toString('latin1');
      const revision = Number(body.match(/name="revision"\r\n\r\n(\d+)/)?.[1]);
      store.uploads.push({
        revision,
        contentType: request.headers()['content-type'],
        filename: body.match(/filename="([^"]*)"/)?.[1] ?? '',
      });
      if (store.holdUpload) {
        store.holdUpload = false;
        await new Promise<void>((resolve) => {
          store.releaseUpload = resolve;
        });
        return route
          .fulfill({ json: { ...frame(), image_url: imageUrl, revision: 8 } })
          .catch(() => {});
      }
      if (store.uploadFailure)
        return failure(
          store.uploadFailure,
          store.uploadFailure === 409
            ? 'reward_conflict'
            : store.uploadFailure === 403
              ? 'forbidden'
              : store.uploadFailure === 400
                ? 'invalid_request'
                : 'service_unavailable',
        );
      const reward = store.catalog.find((item) => item.id === frameId)!;
      if (reward.revision !== revision) return failure(409, 'reward_conflict');
      reward.style = 'image';
      reward.image_url = imageUrl;
      reward.revision++;
      if (store.uncertain) {
        store.uncertain = false;
        return failure(503, 'service_unavailable');
      }
      return route.fulfill({ json: reward });
    }
    if (path.startsWith('/admin/rewards') && request.method() !== 'GET') {
      const body = request.postDataJSON();
      store.writes.push({ method: request.method(), body });
      if (request.method() === 'POST') {
        const reward = { ...frame(), ...body, revision: 0 };
        store.catalog = [reward];
        return route.fulfill({ json: reward });
      }
      const reward = store.catalog.find((item) => item.id === frameId)!;
      if (body.revision !== reward.revision) return failure(409, 'reward_conflict');
      Object.assign(reward, body, { revision: reward.revision + 1 });
      return route.fulfill({ json: reward });
    }
    return route.fulfill({
      json: { items: [], total: 0, page: 1, page_size: 24, unread_count: 0 },
    });
  });
  const frameImage = await png(page);
  await page.route('**/media/reward-frames/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: frameImage }),
  );
  return store;
}
function form(page: Page) {
  return page.getByRole('form', { name: 'Manage rewards' });
}
async function edit(page: Page) {
  await page.goto('/admin?tab=rewards', { waitUntil: 'domcontentloaded' });
  await page
    .locator(`[data-reward-id="${frameId}"]`)
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  return form(page);
}
async function pickImage(page: Page, width = 512, height = width) {
  await form(page)
    .getByLabel('Frame image', { exact: true })
    .setInputFiles({
      name: 'synthetic-frame.png',
      mimeType: 'image/png',
      buffer: await png(page, width, height),
    });
}

test('an image frame is saved as a draft, uploaded with its revision, then explicitly published', async ({
  page,
}) => {
  const store = await fixture(page);
  store.catalog = [];
  await page.goto('/admin?tab=rewards', { waitUntil: 'domcontentloaded' });
  const editor = form(page);
  await editor.getByLabel('Name (1–32 characters)').fill('New uploaded frame');
  await editor.getByLabel('Price in Stardust (1–100,000)').fill('25');
  await selectField(editor.getByRole('combobox', { name: 'Reward type' }), 'avatar_frame');
  await expect(editor.getByRole('combobox', { name: 'Frame style' })).toHaveAttribute(
    'data-value',
    'image',
  );
  await expect(editor.getByLabel('Color', { exact: true })).toBeDisabled();
  await expect(editor.getByLabel('Published in the shop')).not.toBeChecked();
  await expect(editor.getByLabel('Published in the shop')).toBeDisabled();
  await expect(editor.getByLabel('Frame image', { exact: true })).toBeDisabled();
  await expect(editor).toContainText('512 × 512 px');
  await expect(editor).toContainText('384 × 384 px');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  expect(store.writes[0].body).toMatchObject({ style: 'image', active: false });
  expect(store.writes[0].body).not.toHaveProperty('image_url');
  await pickImage(page);
  await editor.getByRole('button', { name: 'Upload image', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Frame image uploaded');
  expect(store.uploads).toHaveLength(1);
  expect(store.uploads[0]).toMatchObject({ revision: 0, filename: 'synthetic-frame.png' });
  expect(store.uploads[0].contentType).toMatch(/^multipart\/form-data; boundary=/);
  await expect(editor.locator('[data-reward-frame="image"] img')).toHaveAttribute('src', imageUrl);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  await page.screenshot({
    path: test.info().outputPath('admin-image-frame-mobile.png'),
    fullPage: true,
  });
  await editor.getByLabel('Published in the shop').check();
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  expect(store.writes.at(-1)?.body).toMatchObject({ revision: 1, active: true });
  expect(store.writes.at(-1)?.body).not.toHaveProperty('image_url');
});

test('an owned published geometric frame upgrades atomically without saving an incomplete frame', async ({
  page,
}) => {
  const store = await fixture(page);
  store.catalog[0] = { ...frame(), style: 'double', active: true, owned_count: 3 };
  store.selfEquipped = true;
  const editor = await edit(page);
  const account = page.getByRole('button', { name: 'Account menu', exact: true });
  await expect(account.locator('[data-reward-frame="double"]')).toBeVisible();
  const sessionReadsBefore = store.sessionReads;
  await editor.getByLabel('Name (1–32 characters)').fill('Retained upgraded frame name');
  await selectField(editor.getByRole('combobox', { name: 'Frame style' }), 'image');
  await expect(editor.getByLabel('Published in the shop')).toBeChecked();
  await expect(editor.getByLabel('Frame image', { exact: true })).toBeEnabled();
  await expect(editor).toContainText('Players keep their current frame until the upload succeeds');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('Upload a frame image');
  await expect(editor.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  expect(store.writes).toHaveLength(0);
  expect(store.catalog[0]).toMatchObject({
    style: 'double',
    image_url: null,
    active: true,
    owned_count: 3,
    revision: 7,
  });
  await expect(account.locator('[data-reward-frame="double"]')).toBeVisible();
  await pickImage(page);
  await editor.getByRole('button', { name: 'Upload image', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Frame image uploaded');
  await expect(editor.locator('[data-reward-frame="image"] img')).toHaveAttribute('src', imageUrl);
  await expect(account.locator('[data-reward-frame="image"] img')).toHaveAttribute('src', imageUrl);
  expect(store.sessionReads).toBeGreaterThan(sessionReadsBefore);
  await expect(editor.getByLabel('Name (1–32 characters)')).toHaveValue(
    'Retained upgraded frame name',
  );
  await expect(editor.getByLabel('Published in the shop')).toBeChecked();
  expect(store.catalog[0]).toMatchObject({
    style: 'image',
    image_url: imageUrl,
    active: true,
    owned_count: 3,
    revision: 8,
  });
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  expect(store.uploads).toHaveLength(1);
  expect(store.uploads[0].revision).toBe(7);
  expect(store.writes).toHaveLength(1);
  expect(store.writes[0].body).toMatchObject({
    name: 'Retained upgraded frame name',
    style: 'image',
    active: true,
    revision: 8,
  });
});

test('uploading preserves unsaved fields and the accepted revision survives a failed catalog refresh', async ({
  page,
}) => {
  const store = await fixture(page);
  const editor = await edit(page);
  await editor.getByLabel('Name (1–32 characters)').fill('Private unsaved name');
  await pickImage(page);
  store.readFailure = 503;
  await editor.getByRole('button', { name: 'Upload image', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toBeVisible();
  await expect(editor.getByLabel('Name (1–32 characters)')).toHaveValue('Private unsaved name');
  // The upload response confirmed the new revision, so saving remains safe even
  // though its subsequent list refresh failed. The selected file was consumed.
  await expect(editor.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await expect(editor.getByRole('button', { name: 'Upload image', exact: true })).toBeDisabled();
  store.readFailure = 0;
  await page.locator('main').getByRole('button', { name: 'Refresh', exact: true }).click();
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  expect(store.writes.at(-1)?.body).toMatchObject({ name: 'Private unsaved name', revision: 8 });
  expect(store.uploads).toHaveLength(1);
});

test('a conflicting image upload keeps the draft and requires explicit latest-version loading', async ({
  page,
}) => {
  const store = await fixture(page);
  const editor = await edit(page);
  await editor.getByLabel('Name (1–32 characters)').fill('Retained private draft');
  await pickImage(page);
  store.catalog[0].revision = 9;
  store.catalog[0].name = 'New saved frame';
  await editor.getByRole('button', { name: 'Upload image', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('This reward has changed');
  await expect(editor.getByLabel('Name (1–32 characters)')).toHaveValue('Retained private draft');
  await expect(editor.getByRole('button', { name: 'Upload image', exact: true })).toBeDisabled();
  await page.locator('main').getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await editor.getByRole('button', { name: 'Load latest version', exact: true }).click();
  await expect(editor.getByLabel('Name (1–32 characters)')).toHaveValue('New saved frame');
  await pickImage(page);
  await editor.getByRole('button', { name: 'Upload image', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Frame image uploaded');
  expect(store.uploads.map((item) => item.revision)).toEqual([7, 9]);
});

test('an uncertain upload is verified by loading the saved version before another write', async ({
  page,
}) => {
  const store = await fixture(page);
  store.uncertain = true;
  const editor = await edit(page);
  await pickImage(page);
  await editor.getByRole('button', { name: 'Upload image', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('could not be confirmed');
  await expect(editor.getByRole('button', { name: 'Upload image', exact: true })).toBeDisabled();
  await editor.getByRole('button', { name: 'Load latest version', exact: true }).click();
  await expect(editor.locator('[data-reward-frame="image"] img')).toHaveAttribute('src', imageUrl);
  await expect(editor.getByLabel('Published in the shop')).toBeEnabled();
  expect(store.uploads).toHaveLength(1);
});

for (const status of [401, 403]) {
  test(`a ${status} image-upload denial removes the private editor and selected file`, async ({
    page,
  }) => {
    const store = await fixture(page);
    const editor = await edit(page);
    await editor.getByLabel('Name (1–32 characters)').fill('Private denied draft');
    await pickImage(page);
    store.uploadFailure = status;
    if (status === 401) store.signedIn = false;
    await editor.getByRole('button', { name: 'Upload image', exact: true }).click();
    await expect(form(page)).toHaveCount(0);
    await expect(page.locator('[data-reward-id]')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('Private untranslated server details');
    if (status === 403) {
      store.uploadFailure = 0;
      await page.locator('main').getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect(form(page).getByLabel('Name (1–32 characters)')).toHaveValue('');
      await expect(form(page).getByLabel('Frame image', { exact: true })).toHaveCount(0);
    }
  });
}

test('unsupported, oversized, nonsquare, corrupt and server-rejected images never publish a frame', async ({
  page,
}) => {
  const store = await fixture(page);
  const editor = await edit(page);
  const input = editor.getByLabel('Frame image', { exact: true });
  const upload = editor.getByRole('button', { name: 'Upload image', exact: true });
  for (const file of [
    { name: 'fixture.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') },
    { name: 'oversized.png', mimeType: 'image/png', buffer: Buffer.alloc(2 * 1024 * 1024 + 1) },
  ]) {
    await input.setInputFiles(file);
    await expect(page.locator('main').getByRole('alert')).toContainText('PNG or WebP');
    await expect(upload).toBeDisabled();
  }
  await pickImage(page, 512, 256);
  await upload.click();
  await expect(page.locator('main').getByRole('alert')).toContainText('square');
  await input.setInputFiles({
    name: 'corrupt.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not PNG'),
  });
  await upload.click();
  await expect(page.locator('main').getByRole('alert')).toContainText('PNG or WebP');
  expect(store.uploads).toHaveLength(0);
  store.uploadFailure = 400;
  await pickImage(page);
  await upload.click();
  await expect(page.locator('main').getByRole('alert')).toContainText('transparent');
  await expect(editor.getByLabel('Published in the shop')).toBeDisabled();
  await expect(page.locator('body')).not.toContainText('Private untranslated server details');
  expect(store.uploads).toHaveLength(1);
});

test('an administrator without rewards.manage has no image editor and makes no admin request', async ({
  page,
}) => {
  const store = await fixture(page, 'en', []);
  await page.goto('/admin?tab=rewards', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Synthetic administrator 993001', { exact: true })).toBeVisible();
  await expect(form(page)).toHaveCount(0);
  expect(store.reads).toBe(0);
  expect(store.uploads).toHaveLength(0);
});

test('a late image-upload response cannot restore the previous administrator draft', async ({
  page,
}) => {
  const store = await fixture(page);
  const editor = await edit(page);
  await editor.getByLabel('Name (1–32 characters)').fill('Previous administrator private draft');
  await pickImage(page);
  store.holdUpload = true;
  await editor.getByRole('button', { name: 'Upload image', exact: true }).click();
  await expect.poll(() => !!store.releaseUpload).toBeTruthy();
  store.viewerId = 993002;
  store.catalog = [];
  await page.waitForTimeout(5100);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(form(page).getByLabel('Name (1–32 characters)')).toHaveValue('');
  store.releaseUpload!();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(form(page).getByLabel('Name (1–32 characters)')).toHaveValue('');
  await expect(form(page).locator('[data-reward-frame]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Previous administrator private draft');
});
