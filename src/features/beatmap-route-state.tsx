'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  parseBeatmapDifficultyHash,
  readCatalogueReturn,
  rememberCatalogueReturn,
  safeCatalogueReturn,
} from '@/lib/beatmap-routes';

const hashEvent = 'illyaverse:beatmap-difficulty';
function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback);
  window.addEventListener('popstate', callback);
  window.addEventListener(hashEvent, callback);
  return () => {
    window.removeEventListener('hashchange', callback);
    window.removeEventListener('popstate', callback);
    window.removeEventListener(hashEvent, callback);
  };
}

export function useBeatmapDifficultyHash() {
  return useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => '',
  );
}

export function useBeatmapDifficultySelection() {
  return parseBeatmapDifficultyHash(useBeatmapDifficultyHash());
}

export function setBeatmapDifficultyLocation(href: string, replace = false) {
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (href === current) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', href);
  window.dispatchEvent(new Event(hashEvent));
}

export function useCatalogueReturn(fallback = '/beatmaps') {
  const pathname = usePathname();
  const search = useSearchParams();
  const legacy = safeCatalogueReturn(search.get('returnTo'));
  const saved = useSyncExternalStore(
    subscribeCatalogueReturn,
    () => readCatalogueReturn(pathname),
    () => null,
  );
  useEffect(() => {
    if (legacy) rememberCatalogueReturn(pathname, legacy);
  }, [pathname, legacy]);
  return legacy ?? saved ?? fallback;
}

function subscribeCatalogueReturn(callback: () => void) {
  window.addEventListener('illyaverse:map-catalogue-return', callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener('illyaverse:map-catalogue-return', callback);
    window.removeEventListener('storage', callback);
  };
}
