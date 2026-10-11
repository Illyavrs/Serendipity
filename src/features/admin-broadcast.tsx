'use client';

import { useState, type FormEvent } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import useSWR from 'swr';
import { LoaderCircle, Megaphone } from 'lucide-react';
import { Loading, LoadError } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError, fetcher } from '@/lib/api';
import './admin-broadcast.css';

type Broadcast = {
  id: number;
  title: string;
  message: string;
  web: boolean;
  game: boolean;
  recipients: number;
  created_at: string;
  sender: string;
};

const TITLE_LIMIT = 120;
const MESSAGE_LIMIT = 800;

/** Staff broadcast: custom text delivered as a website notification, in the game chat, or both. */
export function AdminBroadcast() {
  const t = useTranslations('broadcast');
  const f = useFormatter();
  const history = useSWR<{ items: Broadcast[] }>('/admin/broadcasts', fetcher);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [web, setWeb] = useState(true);
  const [game, setGame] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<{ recipients: number; web: boolean; game: boolean } | null>(
    null,
  );
  const valid =
    title.trim().length > 0 &&
    Array.from(title.trim()).length <= TITLE_LIMIT &&
    message.trim().length > 0 &&
    Array.from(message.trim()).length <= MESSAGE_LIMIT &&
    (web || game);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    // Sending reaches every player and cannot be undone, so it needs a second deliberate click.
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError('');
    setSent(null);
    try {
      const result = await api<{ recipients: number; web: boolean; game: boolean }>(
        '/admin/broadcasts',
        {
          method: 'POST',
          body: JSON.stringify({ title: title.trim(), message: message.trim(), web, game }),
        },
      );
      setSent(result);
      setTitle('');
      setMessage('');
      void history.mutate();
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.code === 'broadcast_cooldown'
          ? t('cooldown')
          : failure instanceof ApiError && [401, 403].includes(failure.status)
            ? t('forbidden')
            : t('failed'),
      );
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="broadcast-panel">
      <form className="glass content-panel broadcast-form" onSubmit={send}>
        <header>
          <h2>
            <Megaphone aria-hidden="true" />
            {t('title')}
          </h2>
          <p className="hint">{t('description')}</p>
        </header>
        <div className="field">
          <label htmlFor="broadcast-title">{t('fieldTitle')}</label>
          <Input
            id="broadcast-title"
            value={title}
            maxLength={TITLE_LIMIT}
            onChange={(event) => {
              setTitle(event.target.value);
              setConfirming(false);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="broadcast-message">{t('fieldMessage')}</label>
          <Textarea
            id="broadcast-message"
            rows={5}
            value={message}
            maxLength={MESSAGE_LIMIT}
            onChange={(event) => {
              setMessage(event.target.value);
              setConfirming(false);
            }}
          />
          <small className="hint">
            {Array.from(message).length}/{MESSAGE_LIMIT}
          </small>
        </div>
        <fieldset className="broadcast-targets">
          <legend>{t('destinations')}</legend>
          <label htmlFor="broadcast-web">
            <Checkbox
              id="broadcast-web"
              checked={web}
              onCheckedChange={(checked) => {
                setWeb(checked === true);
                setConfirming(false);
              }}
            />
            <span>
              {t('toWeb')}
              <small className="hint">{t('toWebHint')}</small>
            </span>
          </label>
          <label htmlFor="broadcast-game">
            <Checkbox
              id="broadcast-game"
              checked={game}
              onCheckedChange={(checked) => {
                setGame(checked === true);
                setConfirming(false);
              }}
            />
            <span>
              {t('toGame')}
              <small className="hint">{t('toGameHint')}</small>
            </span>
          </label>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {sent && (
          <p className="hint" role="status">
            {t('sent', { count: sent.recipients })}
          </p>
        )}
        <div className="broadcast-actions">
          <Button
            type="submit"
            disabled={!valid || busy}
            variant={confirming ? 'default' : 'outline'}
          >
            {busy ? (
              <LoaderCircle className="spin" aria-hidden="true" />
            ) : (
              <Megaphone aria-hidden="true" />
            )}
            {confirming ? t('confirm') : t('send')}
          </Button>
          {confirming && (
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              {t('cancel')}
            </Button>
          )}
        </div>
      </form>
      <section className="glass content-panel" aria-labelledby="broadcast-history-title">
        <h2 id="broadcast-history-title">{t('history')}</h2>
        {history.isLoading ? (
          <Loading />
        ) : history.error ? (
          <LoadError retry={() => history.mutate()} />
        ) : !history.data?.items.length ? (
          <p className="hint">{t('historyEmpty')}</p>
        ) : (
          <ul className="broadcast-history">
            {history.data.items.map((item) => (
              <li key={item.id}>
                <div className="broadcast-history-heading">
                  <strong>{item.title}</strong>
                  {item.web && <Badge variant="outline">{t('badgeWeb')}</Badge>}
                  {item.game && <Badge variant="outline">{t('badgeGame')}</Badge>}
                </div>
                <p>{item.message}</p>
                <small className="hint">
                  {item.sender} ·{' '}
                  {f.dateTime(new Date(item.created_at), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                  {item.web ? ` · ${t('recipients', { count: item.recipients })}` : ''}
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
