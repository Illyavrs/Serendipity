'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Upload } from 'lucide-react';
import { NavigationLink as Link } from '@/components/navigation-motion';
import { Protected } from '@/components/common';
import { useSession } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { api, ApiError } from '@/lib/api';
import type { Score } from '@/lib/types';
import styles from './score-resubmission.module.css';

type Result = { id: number; verification: string; idempotent: boolean };
function failure(error: unknown) {
  if (error instanceof ApiError) {
    if ([401, 403].includes(error.status)) return 'errorSession';
    if (error.code === 'replay_owner') return 'errorOwner';
    if (error.code === 'replay_map' || error.code === 'beatmap_withdrawn') return 'errorMap';
    if (error.code === 'replay_review_limit') return 'errorLimit';
    if (error.status === 413) return 'errorSize';
    if (error.status === 400) return 'errorFile';
  }
  return 'errorRequest';
}

function SubmissionForm() {
  const t = useTranslations('scoreResubmission');
  const [file, setFile] = useState<File | null>(null);
  const [passed, setPassed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || result) return;
    if (!file || !file.name.toLowerCase().endsWith('.osr') || file.size === 0) {
      setError('errorFile');
      return;
    }
    if (file.size > 16_777_216) {
      setError('errorSize');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError('');
    const body = new FormData();
    body.set('file', file);
    body.set('passed', String(passed));
    try {
      const saved = await api<Result>('/scores/resubmit', { method: 'POST', body });
      if (mounted.current) setResult(saved);
    } catch (error) {
      if (mounted.current) setError(failure(error));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className={`glass content-panel ${styles.panel}`}>
      <h1 className={styles.heading}>
        <Upload aria-hidden="true" />
        {t('title')}
      </h1>
      <p className="lede">{t('description')}</p>
      <p className="hint">{t('instructions')}</p>
      {result ? (
        <div role="status" className={styles.result}>
          <p>{t(result.idempotent ? 'existing' : 'submitted')}</p>
          <Button asChild>
            <Link href={`/scores/${result.id}`}>{t('viewScore')}</Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setResult(null);
              setFile(null);
            }}
          >
            {t('another')}
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className={styles.form}>
          <label htmlFor="resubmission-file">{t('file')}</label>
          <Input
            id="resubmission-file"
            type="file"
            accept=".osr"
            disabled={busy}
            onChange={(event) => {
              setFile(event.currentTarget.files?.[0] ?? null);
              setError('');
            }}
          />
          <p className="hint">{t('limits')}</p>
          <label>
            <input
              type="checkbox"
              checked={passed}
              disabled={busy}
              onChange={(event) => setPassed(event.target.checked)}
            />{' '}
            {t('passed')}
          </label>
          <p className="hint">{t('passedHint')}</p>
          {error && (
            <p className="form-error" role="alert">
              {t(error)}
            </p>
          )}
          <Button type="submit" disabled={busy || !file}>
            {t(busy ? 'submitting' : 'submit')}
          </Button>
        </form>
      )}
    </section>
  );
}

export function ScoreResubmissionPage() {
  const { user } = useSession();
  return (
    <div className="page-container narrow">
      <Protected>
        <SubmissionForm key={user?.id ?? 'guest'} />
      </Protected>
    </div>
  );
}

export function ReplayClaimOrigin({
  score,
}: {
  score: Pick<Score, 'submission_origin' | 'replay_played_at'>;
}) {
  const t = useTranslations('scoreResubmission');
  const f = useFormatter();
  if (score.submission_origin !== 'replay') return null;
  const date = score.replay_played_at ? new Date(score.replay_played_at) : null;
  return (
    <p className="hint">
      <Badge variant="outline">{t('origin')}</Badge>
      {date && Number.isFinite(date.getTime()) && (
        <>
          {' '}
          · {t('playedAt', { date: f.dateTime(date, { dateStyle: 'medium', timeStyle: 'short' }) })}
        </>
      )}
    </p>
  );
}
