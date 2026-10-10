'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import useSWR from 'swr';
import { LoaderCircle, RefreshCw, Search, Play, X } from 'lucide-react';
import { NavigationLink as Link } from '@/components/navigation-motion';
import { Empty, Loading, LoadError } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldSelect } from '@/components/ui/field-select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError, fetcher } from '@/lib/api';
import type {
  Page,
  RecalcFilters,
  RecalcItem,
  RecalcJob,
  RecalcJobDetail,
  RecalcPreview,
} from '@/lib/types';
import styles from './admin-recalculation.module.css';

const jobsPath = '/admin/scores/recalculation/jobs';
const modeNames = ['osu!', 'taiko', 'catch', 'mania'];

type Form = {
  user: string;
  variant: string;
  mode: string;
  from: string;
  to: string;
  beatmapId: string;
  verification: string;
  outdatedOnly: boolean;
  minPp: string;
  maxPp: string;
  scoreIds: string;
};
const emptyForm: Form = {
  user: '',
  variant: '',
  mode: '',
  from: '',
  to: '',
  beatmapId: '',
  verification: 'all',
  outdatedOnly: true,
  minPp: '',
  maxPp: '',
  scoreIds: '',
};

type Request = Record<string, string | number | boolean | number[]>;

/** Turn the form into API filters; returns an error key when a field is malformed. */
function toRequest(form: Form): { filters: Request } | { error: string } {
  const filters: Request = {};
  const number = (value: string) => (value.trim() === '' ? undefined : Number(value));
  if (form.user.trim()) filters.user = form.user.trim();
  if (form.variant) filters.variant = form.variant;
  if (form.mode) filters.mode = Number(form.mode);
  if (form.from) filters.from = form.from;
  if (form.to) filters.to = form.to;
  const beatmap = number(form.beatmapId);
  if (beatmap !== undefined) {
    if (!Number.isInteger(beatmap) || beatmap <= 0) return { error: 'errorBeatmap' };
    filters.beatmap_id = beatmap;
  }
  if (form.verification !== 'all') filters.verification = form.verification;
  if (form.outdatedOnly) filters.outdated_only = true;
  for (const [key, value] of [
    ['min_pp', form.minPp],
    ['max_pp', form.maxPp],
  ] as const) {
    const parsed = number(value);
    if (parsed === undefined) continue;
    if (!Number.isFinite(parsed) || parsed < 0) return { error: 'errorPp' };
    filters[key] = parsed;
  }
  if (form.scoreIds.trim()) {
    const ids = form.scoreIds
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map(Number);
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) return { error: 'errorScoreIds' };
    filters.score_ids = ids;
  }
  return { filters };
}

const activeStatuses = ['queued', 'running'];

function useRecalcError() {
  const t = useTranslations('adminRecalc');
  const c = useTranslations('common');
  return (error: unknown) => {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
      if (error.code === 'recalculation_active') return t('errorActive');
      if (error.code === 'player_not_found') return t('errorPlayer');
      if (error.code === 'beatmap_not_found') return t('errorBeatmapMissing');
      return error.message;
    }
    return c('serviceError');
  };
}

function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <strong className={styles.statValue}>{value}</strong>
      {note && <span className={styles.statNote}>{note}</span>}
    </div>
  );
}

function FilterSummary({ filters }: { filters: RecalcFilters }) {
  const t = useTranslations('adminRecalc');
  const f = useFormatter();
  const parts: string[] = [];
  if (filters.user_name) parts.push(t('summaryUser', { name: filters.user_name }));
  if (filters.variant)
    parts.push(t(filters.variant === 'relax' ? 'variantRelax' : 'variantVanilla'));
  if (filters.mode !== null && filters.mode !== undefined)
    parts.push(modeNames[filters.mode] ?? String(filters.mode));
  if (filters.from || filters.to)
    parts.push(t('summaryDates', { from: filters.from ?? '…', to: filters.to ?? '…' }));
  if (filters.beatmap_id) parts.push(t('summaryBeatmap', { id: filters.beatmap_id }));
  if (filters.verification.length === 1)
    parts.push(
      t(filters.verification[0] === 'pending' ? 'verificationPending' : 'verificationVerified'),
    );
  if (filters.outdated_only) parts.push(t('summaryOutdated'));
  if (filters.min_pp !== null || filters.max_pp !== null)
    parts.push(
      t('summaryPp', {
        min: filters.min_pp === null ? '…' : f.number(filters.min_pp),
        max: filters.max_pp === null ? '…' : f.number(filters.max_pp),
      }),
    );
  if (filters.score_ids) parts.push(t('summaryIds', { count: filters.score_ids.length }));
  if (parts.length === 0) parts.push(t('summaryAll'));
  return (
    <span className={styles.chips}>
      {parts.map((part) => (
        <span key={part} className={styles.chip}>
          {part}
        </span>
      ))}
    </span>
  );
}

function StatusBadge({ status }: { status: RecalcJob['status'] }) {
  const t = useTranslations('adminRecalc');
  return (
    <Badge
      variant={
        status === 'failed' ? 'destructive' : status === 'completed' ? 'default' : 'secondary'
      }
      className={styles.status}
      data-status={status}
    >
      {t(`status_${status}`)}
    </Badge>
  );
}

function Progress({ job }: { job: RecalcJob }) {
  const t = useTranslations('adminRecalc');
  const f = useFormatter();
  const ratio = job.total > 0 ? Math.min(1, job.processed / job.total) : 0;
  return (
    <div className={styles.progress}>
      <div
        className={styles.bar}
        role="progressbar"
        aria-label={t('progressLabel')}
        aria-valuemin={0}
        aria-valuemax={job.total}
        aria-valuenow={job.processed}
      >
        <span style={{ width: `${ratio * 100}%` }} data-status={job.status} />
      </div>
      <span className={styles.progressText}>
        {f.number(job.processed)} / {f.number(job.total)}
      </span>
    </div>
  );
}

function ItemTable({ items, caption }: { items: RecalcItem[]; caption: string }) {
  const t = useTranslations('adminRecalc');
  const f = useFormatter();
  if (items.length === 0) return null;
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={caption}>
      <table className={styles.table}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th>{t('colScore')}</th>
            <th>{t('colPlayer')}</th>
            <th>{t('colBeatmap')}</th>
            <th className={styles.number}>{t('colChange')}</th>
            <th>{t('colNote')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.score_id}>
              <td>
                <Link href={`/scores/${item.score_id}`}>#{item.score_id}</Link>
              </td>
              <td>{item.username}</td>
              <td>
                {item.title} [{item.version}]
              </td>
              <td className={styles.number}>
                {item.outcome === 'updated' && item.previous_pp !== null && item.new_pp !== null ? (
                  <>
                    {f.number(item.previous_pp, { maximumFractionDigits: 2 })} →{' '}
                    {f.number(item.new_pp, { maximumFractionDigits: 2 })}{' '}
                    <span
                      className={item.new_pp >= item.previous_pp ? styles.up : styles.down}
                      title={t('colChange')}
                    >
                      ({item.new_pp >= item.previous_pp ? '+' : ''}
                      {f.number(item.new_pp - item.previous_pp, { maximumFractionDigits: 2 })})
                    </span>
                  </>
                ) : (
                  <Badge variant="secondary">{t(`outcome_${item.outcome}`)}</Badge>
                )}
              </td>
              <td className={styles.note}>{item.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobDetail({ id }: { id: number }) {
  const t = useTranslations('adminRecalc');
  const f = useFormatter();
  const { data, error, mutate } = useSWR<RecalcJobDetail>(`${jobsPath}/${id}`, fetcher, {
    refreshInterval: (latest) => (latest && activeStatuses.includes(latest.status) ? 2000 : 0),
  });
  if (error && !data) return <LoadError retry={() => mutate()} />;
  if (!data) return <Loading />;
  return (
    <div className={styles.detail}>
      <div className={styles.stats}>
        <Stat label={t('statUpdated')} value={f.number(data.updated)} />
        <Stat label={t('statUnchanged')} value={f.number(data.unchanged)} />
        <Stat label={t('statSkipped')} value={f.number(data.skipped)} />
        <Stat label={t('statFailed')} value={f.number(data.failed)} />
        <Stat
          label={t('statPpDelta')}
          value={`${data.pp_delta >= 0 ? '+' : ''}${f.number(data.pp_delta, { maximumFractionDigits: 2 })}`}
          note={t('statPpDeltaNote')}
        />
      </div>
      {data.error && (
        <p className="form-error" role="alert">
          {data.error}
        </p>
      )}
      <ItemTable items={data.problems} caption={t('problemsTitle')} />
      <ItemTable items={data.changes} caption={t('changesTitle')} />
      {data.changes.length === 0 && data.problems.length === 0 && (
        <p className="hint">{t('nothingToList')}</p>
      )}
    </div>
  );
}

function JobRow({
  job,
  open,
  onToggle,
  onCancel,
  busy,
}: {
  job: RecalcJob;
  open: boolean;
  onToggle: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const t = useTranslations('adminRecalc');
  const f = useFormatter();
  const active = activeStatuses.includes(job.status);
  return (
    <li className={styles.job} data-status={job.status}>
      <div className={styles.jobHead}>
        <div>
          <strong>#{job.id}</strong> <StatusBadge status={job.status} />
          {job.cancel_requested && active && <span className="hint"> · {t('cancelling')}</span>}
          <p className="hint">
            {t('jobMeta', {
              name: job.created_by_name,
              time: f.dateTime(new Date(job.created_at), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })}
          </p>
        </div>
        <div className="actions">
          <Button variant="ghost" size="sm" aria-expanded={open} onClick={onToggle}>
            {open ? t('hideDetails') : t('showDetails')}
          </Button>
          {active && (
            <Button
              variant="outline"
              size="sm"
              className="admin-danger-action"
              disabled={busy || job.cancel_requested}
              onClick={onCancel}
            >
              <X aria-hidden="true" />
              {t('cancel')}
            </Button>
          )}
        </div>
      </div>
      <FilterSummary filters={job.filters} />
      <Progress job={job} />
      {open && <JobDetail id={job.id} />}
    </li>
  );
}

export function ScoreRecalculation() {
  const t = useTranslations('adminRecalc');
  const f = useFormatter();
  const describeError = useRecalcError();
  const [form, setForm] = useState<Form>(emptyForm);
  const [preview, setPreview] = useState<{ request: Request; data: RecalcPreview } | null>(null);
  const [busy, setBusy] = useState<'' | 'preview' | 'start' | 'cancel'>('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [openJob, setOpenJob] = useState<number | null>(null);
  const {
    data: jobs,
    error: jobsError,
    isLoading,
    mutate,
  } = useSWR<Page<RecalcJob>>(jobsPath, fetcher, {
    refreshInterval: (latest) =>
      latest?.items.some((job) => activeStatuses.includes(job.status)) ? 2000 : 0,
  });
  const active = jobs?.items.find((job) => activeStatuses.includes(job.status));

  function change(patch: Partial<Form>) {
    setForm((old) => ({ ...old, ...patch }));
    // A preview describes the filters it was made with.
    setPreview(null);
    setConfirming(false);
    setNotice('');
  }

  async function runPreview(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    const built = toRequest(form);
    setNotice('');
    if ('error' in built) {
      setError(t(built.error));
      return;
    }
    setBusy('preview');
    setError('');
    setConfirming(false);
    try {
      const data = await api<RecalcPreview>('/admin/scores/recalculation/preview', {
        method: 'POST',
        body: JSON.stringify({ filters: built.filters }),
      });
      setPreview({ request: built.filters, data });
    } catch (failure) {
      setPreview(null);
      setError(describeError(failure));
    } finally {
      setBusy('');
    }
  }

  async function start() {
    if (!preview || busy) return;
    setBusy('start');
    setError('');
    try {
      const job = await api<RecalcJob>(jobsPath, {
        method: 'POST',
        body: JSON.stringify({ filters: preview.request }),
      });
      setConfirming(false);
      setPreview(null);
      setOpenJob(job.id);
      setNotice(t('started', { id: job.id }));
      await mutate();
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy('');
    }
  }

  async function cancel(job: RecalcJob) {
    if (busy) return;
    setBusy('cancel');
    setError('');
    try {
      await api(`${jobsPath}/${job.id}/cancel`, { method: 'POST' });
      await mutate();
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy('');
    }
  }

  const presets: { label: string; apply: Partial<Form> }[] = [
    { label: t('presetOutdated'), apply: { ...emptyForm } },
    { label: t('presetOutdatedRelax'), apply: { ...emptyForm, variant: 'relax' } },
    { label: t('presetEverything'), apply: { ...emptyForm, outdatedOnly: false } },
  ];

  return (
    <div className={styles.workbench}>
      <section className="glass content-panel">
        <h2>{t('title')}</h2>
        <p className="hint">{t('intro')}</p>
        <div className={styles.presets} role="group" aria-label={t('presets')}>
          {presets.map((preset) => (
            <Button
              key={preset.label}
              type="button"
              variant="outline"
              size="sm"
              disabled={!!busy}
              onClick={() => {
                change({ ...preset.apply });
                setError('');
              }}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <form className={styles.form} onSubmit={runPreview} aria-busy={!!busy}>
          <div className="field">
            <label htmlFor="recalc-user">{t('fieldUser')}</label>
            <Input
              id="recalc-user"
              maxLength={64}
              value={form.user}
              onChange={(event) => change({ user: event.target.value })}
              placeholder={t('fieldUserHint')}
            />
          </div>
          <div className="field">
            <label htmlFor="recalc-variant">{t('fieldVariant')}</label>
            <FieldSelect
              id="recalc-variant"
              value={form.variant}
              onValueChange={(variant) => change({ variant })}
              options={[
                { value: '', label: t('any') },
                { value: 'vanilla', label: t('variantVanilla') },
                { value: 'relax', label: t('variantRelax') },
              ]}
            />
          </div>
          <div className="field">
            <label htmlFor="recalc-mode">{t('fieldMode')}</label>
            <FieldSelect
              id="recalc-mode"
              value={form.mode}
              onValueChange={(mode) => change({ mode })}
              options={[
                { value: '', label: t('any') },
                ...modeNames.map((name, index) => ({ value: String(index), label: name })),
              ]}
            />
          </div>
          <div className="field">
            <label htmlFor="recalc-verification">{t('fieldVerification')}</label>
            <FieldSelect
              id="recalc-verification"
              value={form.verification}
              onValueChange={(verification) => change({ verification })}
              options={[
                { value: 'all', label: t('verificationAll') },
                { value: 'verified', label: t('verificationVerified') },
                { value: 'pending', label: t('verificationPending') },
              ]}
            />
          </div>
          <div className="field">
            <label htmlFor="recalc-from">{t('fieldFrom')}</label>
            <Input
              id="recalc-from"
              type="date"
              value={form.from}
              max={form.to || undefined}
              onChange={(event) => change({ from: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="recalc-to">{t('fieldTo')}</label>
            <Input
              id="recalc-to"
              type="date"
              value={form.to}
              min={form.from || undefined}
              onChange={(event) => change({ to: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="recalc-beatmap">{t('fieldBeatmap')}</label>
            <Input
              id="recalc-beatmap"
              inputMode="numeric"
              value={form.beatmapId}
              onChange={(event) => change({ beatmapId: event.target.value })}
            />
          </div>
          <div className={`field ${styles.range}`}>
            <label htmlFor="recalc-min">{t('fieldPpRange')}</label>
            <div>
              <Input
                id="recalc-min"
                inputMode="decimal"
                aria-label={t('fieldMinPp')}
                placeholder={t('fieldMinPp')}
                value={form.minPp}
                onChange={(event) => change({ minPp: event.target.value })}
              />
              <span aria-hidden="true">–</span>
              <Input
                inputMode="decimal"
                aria-label={t('fieldMaxPp')}
                placeholder={t('fieldMaxPp')}
                value={form.maxPp}
                onChange={(event) => change({ maxPp: event.target.value })}
              />
            </div>
          </div>
          <div className={`field ${styles.wide}`}>
            <label htmlFor="recalc-ids">{t('fieldScoreIds')}</label>
            <Textarea
              id="recalc-ids"
              rows={2}
              value={form.scoreIds}
              onChange={(event) => change({ scoreIds: event.target.value })}
              aria-describedby="recalc-ids-hint"
            />
            <p className="hint" id="recalc-ids-hint">
              {t('fieldScoreIdsHint')}
            </p>
          </div>
          <label htmlFor="recalc-outdated" className={`${styles.wide} ${styles.check}`}>
            <Checkbox
              id="recalc-outdated"
              checked={form.outdatedOnly}
              onCheckedChange={(checked) => change({ outdatedOnly: checked === true })}
            />
            <span>
              {t('fieldOutdated')}
              <small className="hint">{t('fieldOutdatedHint')}</small>
            </span>
          </label>
          <div className={`actions ${styles.wide}`}>
            <Button disabled={!!busy}>
              {busy === 'preview' ? (
                <LoaderCircle className="spin" aria-hidden="true" />
              ) : (
                <Search aria-hidden="true" />
              )}
              {t('preview')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={!!busy}
              onClick={() => {
                change({ ...emptyForm });
                setError('');
              }}
            >
              {t('reset')}
            </Button>
          </div>
        </form>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="form-success" role="status">
            {notice}
          </p>
        )}
      </section>

      {preview && (
        <section className="glass content-panel" aria-live="polite">
          <h2>{t('previewTitle')}</h2>
          <FilterSummary filters={preview.data.filters} />
          <div className={styles.stats}>
            <Stat label={t('statMatching')} value={f.number(preview.data.total)} />
            <Stat label={t('statPlayers')} value={f.number(preview.data.players)} />
            <Stat
              label={t('statOutdated')}
              value={f.number(preview.data.outdated)}
              note={t('statOutdatedNote')}
            />
            <Stat
              label={t('statSplit')}
              value={`${f.number(preview.data.by_variant.vanilla)} / ${f.number(preview.data.by_variant.relax)}`}
              note={t('statSplitNote')}
            />
            <Stat
              label={t('statModes')}
              value={preview.data.by_mode
                .map((count, index) => (count > 0 ? `${modeNames[index]} ${f.number(count)}` : ''))
                .filter(Boolean)
                .join(' · ')}
            />
          </div>
          {preview.data.sample.length > 0 && (
            <div className="table-scroll" tabIndex={0} role="region" aria-label={t('sampleTitle')}>
              <table className={styles.table}>
                <caption>{t('sampleTitle')}</caption>
                <thead>
                  <tr>
                    <th>{t('colScore')}</th>
                    <th>{t('colPlayer')}</th>
                    <th>{t('colBeatmap')}</th>
                    <th>{t('colRuleset')}</th>
                    <th className={styles.number}>pp</th>
                    <th>{t('colVersion')}</th>
                    <th>{t('colDate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.data.sample.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link href={`/scores/${row.id}`}>#{row.id}</Link>
                      </td>
                      <td>{row.username}</td>
                      <td>
                        {row.title} [{row.version}]
                      </td>
                      <td>
                        {modeNames[row.mode]}
                        {row.score_variant === 'relax' ? ' RX' : ''}
                      </td>
                      <td className={styles.number}>
                        {f.number(row.pp, { maximumFractionDigits: 2 })}
                      </td>
                      <td className={styles.note}>
                        {row.pp_calculation_version ?? t('versionNone')}
                        {row.pp_calculation_version !==
                          preview.data.current_versions[
                            row.score_variant === 'relax' ? 'relax' : 'vanilla'
                          ] && <Badge variant="secondary">{t('outdatedBadge')}</Badge>}
                      </td>
                      <td>{f.dateTime(new Date(row.created_at), { dateStyle: 'medium' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.data.total > preview.data.sample.length && (
            <p className="hint">{t('sampleNote', { count: preview.data.sample.length })}</p>
          )}
          {active ? (
            <p className="hint">{t('blockedByActive', { id: active.id })}</p>
          ) : preview.data.total === 0 ? (
            <Empty title={t('noMatches')} />
          ) : confirming ? (
            <div className="admin-confirm" role="group" aria-labelledby="recalc-confirm-title">
              <strong id="recalc-confirm-title">
                {t('confirmTitle', { count: preview.data.total })}
              </strong>
              <p className="hint">{t('confirmHint')}</p>
              <div className="actions">
                <Button size="sm" disabled={!!busy} autoFocus onClick={start}>
                  {busy === 'start' ? (
                    <LoaderCircle className="spin" aria-hidden="true" />
                  ) : (
                    <Play aria-hidden="true" />
                  )}
                  {t('confirmStart')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => setConfirming(false)}
                >
                  {t('back')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="actions">
              <Button onClick={() => setConfirming(true)} disabled={!!busy}>
                <Play aria-hidden="true" />
                {t('start', { count: preview.data.total })}
              </Button>
            </div>
          )}
        </section>
      )}

      <section className="glass content-panel">
        <div className="section-heading">
          <h2>{t('jobsTitle')}</h2>
          <Button variant="ghost" size="sm" onClick={() => mutate()}>
            <RefreshCw aria-hidden="true" />
            {t('refresh')}
          </Button>
        </div>
        {isLoading ? (
          <Loading />
        ) : jobsError && !jobs ? (
          <LoadError retry={() => mutate()} />
        ) : jobs && jobs.items.length > 0 ? (
          <ul className={styles.jobs}>
            {jobs.items.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                open={openJob === job.id}
                busy={busy === 'cancel'}
                onToggle={() => setOpenJob(openJob === job.id ? null : job.id)}
                onCancel={() => cancel(job)}
              />
            ))}
          </ul>
        ) : (
          <Empty title={t('noJobs')} />
        )}
      </section>
    </div>
  );
}
