'use client';

import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { useTranslations } from 'next-intl';
import { LoaderCircle, Pause, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import styles from './map-audio-preview.module.css';

type PreviewState = 'idle' | 'loading' | 'playing' | 'error';
type ActivePreview = { element: HTMLAudioElement; stop: () => void };
// Audio belongs to the current page. Starting another preview releases the old
// element and its request, rather than allowing several cards to play at once.
let activePreview: ActivePreview | null = null;

export function mapAudioPreviewPath(setId: number) {
  return Number.isSafeInteger(setId) && setId > 0 && setId <= 2_147_483_647
    ? `/api/v2/beatmapsets/${setId}/preview`
    : null;
}

export function MapAudioPreview({
  setId,
  title,
  available = true,
}: {
  setId: number;
  title: string;
  available?: boolean;
}) {
  const path = mapAudioPreviewPath(setId);
  return available && path ? <AudioPreview key={path} path={path} title={title} /> : null;
}

function AudioPreview({ path, title }: { path: string; title: string }) {
  const t = useTranslations('mapDiscovery');
  const audioRef = useRef<HTMLAudioElement>(null);
  const generation = useRef(0);
  const [state, setState] = useState<PreviewState>('idle');
  const statusId = useId();

  useEffect(() => {
    const audio = audioRef.current;
    const attempts = generation;
    return () => {
      attempts.current++;
      if (!audio) return;
      if (activePreview?.element === audio) activePreview = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };
  }, []);

  function stop() {
    const audio = audioRef.current;
    generation.current++;
    if (activePreview?.element === audio) activePreview = null;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setState('idle');
  }

  function failed() {
    if (activePreview?.element !== audioRef.current) return;
    stop();
    setState('error');
  }

  async function toggle(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (activePreview?.element === audio && (state === 'playing' || state === 'loading')) {
      if (state === 'loading') stop();
      else {
        generation.current++;
        audio.pause();
        setState('idle');
      }
      return;
    }
    if (activePreview?.element !== audio) activePreview?.stop();
    activePreview = { element: audio, stop };
    const attempt = ++generation.current;
    setState('loading');
    // Assigning the source only after the click prevents catalogue browsing
    // from issuing audio requests or downloading every listed preview.
    if (audio.getAttribute('src') !== path) audio.src = path;
    try {
      await audio.play();
      if (generation.current === attempt && activePreview?.element === audio) setState('playing');
    } catch {
      // A stopped/replaced track can reject its old play promise. That must
      // not turn the previous card into a playback error.
      if (generation.current === attempt && activePreview?.element === audio) failed();
    }
  }

  const action =
    state === 'playing'
      ? t('audioPause', { title })
      : state === 'loading'
        ? t('audioCancel', { title })
        : t(state === 'error' ? 'audioRetry' : 'audioPlay', { title });
  return (
    <div className={styles.preview} data-audio-state={state}>
      <audio
        ref={audioRef}
        preload="none"
        onPlaying={() => {
          if (activePreview?.element === audioRef.current) setState('playing');
        }}
        onWaiting={() => {
          if (activePreview?.element === audioRef.current) setState('loading');
        }}
        onError={() => {
          if (audioRef.current?.error) failed();
        }}
        onEnded={() => {
          if (audioRef.current?.ended && activePreview?.element === audioRef.current) stop();
        }}
        onPause={() => {
          if (audioRef.current?.paused && activePreview?.element === audioRef.current) {
            generation.current++;
            setState('idle');
          }
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={styles.button}
        aria-label={action}
        title={action}
        aria-pressed={state === 'playing' || state === 'loading'}
        aria-busy={state === 'loading'}
        aria-describedby={state === 'error' ? statusId : undefined}
        onClick={toggle}
      >
        <span className={styles.face}>
          {state === 'loading' ? (
            <LoaderCircle aria-hidden="true" className={styles.loading} />
          ) : state === 'playing' ? (
            <Pause aria-hidden="true" fill="currentColor" />
          ) : state === 'error' ? (
            <RotateCcw aria-hidden="true" />
          ) : (
            <Play aria-hidden="true" fill="currentColor" />
          )}
        </span>
      </Button>
      {state === 'error' && (
        <span className={styles.error} id={statusId} role="status">
          {t('audioUnavailable')}
        </span>
      )}
    </div>
  );
}
