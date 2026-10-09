'use client';

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Download, LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import {
  archiveDownloadErrorKey,
  officialArchiveDownloadUrl,
  readOfficialArchive,
} from '@/lib/archive-download';
import type { OfficialBeatmapset } from '@/lib/types';

export function OfficialArchiveDownload({
  set,
  children,
  className = '',
}: {
  set: OfficialBeatmapset;
  children?: ReactNode;
  className?: string;
}) {
  const t = useTranslations('maps');
  const c = useTranslations('mapDiscovery');
  const href = officialArchiveDownloadUrl(set);
  const retained = href?.startsWith('/api/v1/beatmaps/') ?? false;
  const request = useRef<AbortController | null>(null);
  const [state, setState] = useState<{ target: string | null; busy: boolean; error: unknown }>({
    target: href,
    busy: false,
    error: null,
  });
  const busy = state.target === href && state.busy;
  const error = state.target === href ? state.error : null;
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [href],
  );

  async function acquire() {
    if (request.current || retained || !href) return;
    const controller = new AbortController();
    request.current = controller;
    setState({ target: href, error: null, busy: true });
    const timeout = setTimeout(() => controller.abort('timeout'), 65_000);
    try {
      const response = await fetch(href, {
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
      });
      const blob = await readOfficialArchive(response);
      if (controller.signal.aborted || request.current !== controller) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `illyaverse-official-${set.official_set_id}.osz`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error: unknown) {
      if (
        request.current === controller &&
        (!controller.signal.aborted || controller.signal.reason === 'timeout')
      )
        setState({
          target: href,
          busy: false,
          error:
            controller.signal.reason === 'timeout'
              ? new ApiError(503, 'official_archive_timeout', 'The download timed out.')
              : error,
        });
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        setState((current) => (current.target === href ? { ...current, busy: false } : current));
      }
    }
  }

  function download(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
      return;
    // Existing retained downloads remain ordinary browser attachment requests.
    if (retained || !href) return;
    event.preventDefault();
    void acquire();
  }

  const hint = retained
    ? 'archiveDownloadHint'
    : href
      ? 'configuredArchiveDownloadHint'
      : set.download_disabled
        ? 'officialSearch.downloadDisabled'
        : 'officialArchiveUnavailableHint';
  return (
    <div className={`official-archive-download ${className}`}>
      <div className="actions">
        {href ? (
          <Button asChild>
            <a
              href={href}
              download
              onClick={download}
              aria-disabled={busy || undefined}
              aria-busy={busy || undefined}
            >
              {busy ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <Download aria-hidden="true" />
              )}
              <span>{t(busy ? 'preparingArchiveDownload' : 'downloadPackage')}</span>
            </a>
          </Button>
        ) : (
          <Button disabled>
            <Download aria-hidden="true" />
            <span>{t('downloadPackage')}</span>
          </Button>
        )}
        {children}
      </div>
      <p className="hint">{t(hint)}</p>
      {!!error && (
        <div role="alert" className="hint">
          <p>{t(archiveDownloadErrorKey(error))}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void acquire()}
          >
            <RefreshCw aria-hidden="true" />
            {c('retry')}
          </Button>
        </div>
      )}
    </div>
  );
}
