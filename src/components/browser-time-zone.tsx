'use client';
import { NextIntlClientProvider, useLocale, useMessages } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * Formats dates in the viewer's own time zone. The server renders in UTC, so the provider
 * switches to the browser's zone once it is known.
 */
export function BrowserTimeZone({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const messages = useMessages();
  const [timeZone, setTimeZone] = useState<string | undefined>();
  useEffect(() => {
    try {
      setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      /* Keep the server's zone if the browser will not say. */
    }
  }, []);
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
      {children}
    </NextIntlClientProvider>
  );
}
