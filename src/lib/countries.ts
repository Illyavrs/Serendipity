import flagCodes from './country-flags.json';

const availableFlags = new Set(flagCodes);
// The asset collection also contains organisational and subdivision flags.
// Offer country/territory choices, including the commonly used XK code, here.
const nonCountryFlags = new Set(['AC', 'CP', 'CQ', 'DG', 'EA', 'EU', 'IC', 'TA', 'UN']);
export const countryCodes = flagCodes.filter((code) => !nonCountryFlags.has(code));

export function countryCode(value: string): string {
  return /^[a-z]{2}$/i.test(value) ? value.toUpperCase() : value;
}

export function hasCountryFlag(value: string): boolean {
  return availableFlags.has(countryCode(value));
}

export function countryName(value: string, locale: string): string {
  const code = countryCode(value);
  if (!availableFlags.has(code)) return code;
  try {
    return new Intl.DisplayNames([locale, 'en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function searchable(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .trim();
}

export function countryOptions(locale: string) {
  const collator = new Intl.Collator(locale, { sensitivity: 'base' });
  return countryCodes
    .map((code) => {
      const name = countryName(code, locale);
      return { code, name, search: searchable(`${name} ${countryName(code, 'en')} ${code}`) };
    })
    .sort((a, b) => collator.compare(a.name, b.name));
}

export function matchesCountry(search: string, query: string): boolean {
  return search.includes(searchable(query));
}
