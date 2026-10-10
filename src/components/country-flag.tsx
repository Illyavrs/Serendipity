'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { countryCode, countryName, hasCountryFlag } from '@/lib/countries';

// Only names present in the pinned, self-hosted asset manifest become paths.
// Country text remains visible when a code or its image is unavailable.
export function CountryFlag({
  country,
  display = 'code',
}: {
  country: string;
  display?: 'code' | 'name';
}) {
  const locale = useLocale();
  const code = countryCode(country);
  const known = hasCountryFlag(code);
  const [failedCode, setFailedCode] = useState<string | null>(null);
  const name = countryName(code, locale);
  return (
    <span className="country-flag" title={name} data-country={code}>
      {known && failedCode !== code && (
        // These original Twemoji SVG bytes are vendored with CC BY 4.0 attribution.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="country-flag-image"
          src={`/flags/twemoji/${code}.svg`}
          alt={display === 'name' ? '' : name}
          width={24}
          height={18}
          draggable={false}
          onError={() => setFailedCode(code)}
        />
      )}
      <span>{display === 'name' ? name : code}</span>
    </span>
  );
}
