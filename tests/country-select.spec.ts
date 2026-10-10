import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import {
  countryCode,
  countryName,
  countryOptions,
  hasCountryFlag,
  matchesCountry,
} from '../src/lib/countries';

// Browser fixtures are intercepted; no account, profile or public ranking is changed.
const id = 988250;
const copy = {
  en: {
    country: 'Country',
    search: 'Search countries',
    empty: 'No countries found',
    all: 'All countries',
    name: 'Taiwan',
  },
  'zh-TW': {
    country: '國家代碼',
    search: '搜尋國家／地區',
    empty: '找不到國家／地區',
    all: '所有國家／地區',
    name: '台灣',
  },
  ja: {
    country: '国コード',
    search: '国・地域を検索',
    empty: '国・地域が見つかりません',
    all: 'すべての国・地域',
    name: '台湾',
  },
};
type Locale = keyof typeof copy;

async function fixture(page: Page, locale: Locale) {
  await page
    .context()
    .addCookies([
      { name: 'illya_locale', value: locale, url: test.info().project.use.baseURL as string },
    ]);
  const user = {
    id,
    username: 'Country dropdown fixture',
    country: 'TW',
    bio: '',
    roles: [],
    permissions: [],
    avatar_url: null,
    banner_url: null,
    joined_at: '2026-10-09T00:00:00Z',
    pp: 0,
    play_count: 0,
  };
  const queries: URL[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/me')
      return route.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } });
    if (url.pathname === '/api/v1/leaderboard') {
      queries.push(url);
      const country = url.searchParams.get('country') || 'TW';
      return route.fulfill({
        json: {
          items: Array.from({ length: 24 }, (_, index) => ({
            ...user,
            id: id + index,
            username: `Country selection ${country} ${index}`,
            rank: index + 1,
            accuracy: 98,
          })),
          total: 74,
          page: Number(url.searchParams.get('page') || 1),
          page_size: 24,
        },
      });
    }
    if (url.pathname === `/api/v1/users/${id}`) return route.fulfill({ json: user });
    if (url.pathname === `/api/v1/users/${id}/rank-history`) {
      const days = Number(url.searchParams.get('days') || 90);
      return route.fulfill({
        json: {
          mode: 0,
          variant: 'vanilla',
          days,
          start_date: '2026-07-13',
          end_date: '2026-10-10',
          time_zone: 'UTC',
          collection_interval_seconds: 1800,
          last_captured_at: null,
          points: [],
        },
      });
    }
    return route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 24 } });
  });
  return { queries, errors };
}

test('country catalogue uses readable region names, English/code search and safe unknown fallbacks', () => {
  expect(countryName('tw', 'en')).toBe('Taiwan');
  expect(countryCode('tw')).toBe('TW');
  expect(countryName('ZZ', 'en')).toBe('ZZ');
  expect(hasCountryFlag('../TW')).toBe(false);
  expect(hasCountryFlag('TW')).toBe(true);
  for (const locale of Object.keys(copy)) {
    const choices = countryOptions(locale);
    expect(choices.some((choice) => choice.code === 'EU' || choice.code === 'UN')).toBe(false);
    const japan = choices.find((choice) => choice.code === 'JP')!;
    expect(japan.name).not.toBe('JP');
    expect(matchesCountry(japan.search, 'Japan')).toBe(true);
    expect(matchesCountry(japan.search, 'jp')).toBe(true);
    const reunion = choices.find((choice) => choice.code === 'RE')!;
    expect(matchesCountry(reunion.search, 'reunion')).toBe(true);
  }
});

for (const locale of ['en', 'zh-TW', 'ja'] as const) {
  test(`${locale} country dropdown searches names, preserves URL state and displays a full profile name`, async ({
    page,
  }) => {
    const state = await fixture(page, locale);
    await page.setViewportSize({ width: locale === 'en' ? 1280 : 390, height: 900 });
    await page.goto('/rankings?country=TW&page=2&mode=1&variant=relax&note=kept#rankings');
    const trigger = page.locator('.ranking-country-select');
    await expect(trigger).toHaveAttribute('data-value', 'TW');
    await expect(trigger).toContainText(copy[locale].name);
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      x: document.querySelector('.rankings-toolbar')!.getBoundingClientRect().x,
      scroll: scrollY,
    }));
    await trigger.focus();
    await trigger.press('ArrowDown');
    const search = page.getByRole('combobox', { name: copy[locale].search, exact: true });
    await expect(search).toBeFocused();
    if (process.env.ILLYA_COUNTRY_CAPTURE_DIR) {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: path.join(process.env.ILLYA_COUNTRY_CAPTURE_DIR, `${locale}-country-menu.png`),
        animations: 'disabled',
      });
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.clientWidth))
      .toBe(dimensions.width);
    expect(
      await page.evaluate(
        () => document.querySelector('.rankings-toolbar')!.getBoundingClientRect().x,
      ),
    ).toBe(dimensions.x);
    expect(await page.evaluate(() => document.body.hasAttribute('data-scroll-locked'))).toBe(false);
    await search.fill('does not name a country');
    await expect(page.getByRole('status').filter({ hasText: copy[locale].empty })).toBeVisible();
    await search.press('Enter');
    expect(new URL(page.url()).searchParams.get('country')).toBe('TW');
    await search.fill('Japan');
    await search.evaluate((element) =>
      element.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }),
      ),
    );
    await expect(trigger).toHaveAttribute('data-value', 'TW');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('option')).toHaveCount(1);
    await expect(page.getByRole('option').locator('img')).toHaveAttribute(
      'src',
      '/flags/twemoji/JP.svg',
    );
    if (locale !== 'en') {
      const bounds = await page.getByRole('option').boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    await search.press('Home');
    await search.press('Enter');
    await expect(trigger).toHaveAttribute('data-value', 'JP');
    await expect(trigger).toBeFocused();
    await expect.poll(() => new URL(page.url()).searchParams.get('country')).toBe('JP');
    expect(new URL(page.url()).searchParams.get('page')).toBe(null);
    expect(new URL(page.url()).searchParams.get('mode')).toBe('1');
    expect(new URL(page.url()).searchParams.get('variant')).toBe('relax');
    expect(new URL(page.url()).searchParams.get('note')).toBe('kept');
    expect(new URL(page.url()).hash).toBe('#rankings');
    await trigger.click();
    await search.fill('Taiwan');
    await search.press('Escape');
    await expect(trigger).toHaveAttribute('data-value', 'JP');
    await expect(trigger).toBeFocused();
    await trigger.click();
    await search.press('Tab');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.getByRole('option', { name: copy[locale].all, exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('country')).toBe(null);
    await page.goto(`/users/${id}`);
    const country = page.locator('.profile-player-name .country-flag');
    await expect(country).toHaveText(copy[locale].name);
    await expect(country.locator('img')).toHaveAttribute('src', '/flags/twemoji/TW.svg');
    await expect(country.locator('img')).toHaveAttribute('alt', '');
    if (process.env.ILLYA_COUNTRY_CAPTURE_DIR) {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: path.join(process.env.ILLYA_COUNTRY_CAPTURE_DIR, `${locale}-profile-country.png`),
        animations: 'disabled',
      });
    }
    expect(
      state.queries.every(
        (url) =>
          !url.searchParams.has('country') || /^[A-Z]{2}$/.test(url.searchParams.get('country')!),
      ),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(state.errors).toEqual([]);
  });
}
