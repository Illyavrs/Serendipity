'use client';
import { Suspense, useCallback, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import { Dialog } from 'radix-ui';
import { NavigationLink as Link } from '@/components/navigation-motion';
import { LoaderCircle, ShieldCheck, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ColorPicker } from '@/components/color-picker';
import { RoleBadge } from '@/components/role-badge';
import {
  PageHeading,
  Protected,
  Loading,
  LoadError,
  Empty,
  Pagination,
  Avatar,
} from '@/components/common';
import { useSession } from '@/components/providers';
import { api, ApiError, fetcher, hasPermission } from '@/lib/api';
import type { Page, AdminUser, Role, Beatmap, BeatmapAvailability, Audit } from '@/lib/types';
import { AdminAnnouncements, type AnnouncementNavigationGuard } from './announcements';
import { AuditDisclosure, ChatModeration, ScoreModeration } from './admin-moderation';
import { AdminRankRequests } from './beatmap-rank-requests';
import { LocalBeatmapAdminCatalogue } from './beatmap-admin-view';
import moderationStyles from './admin-moderation.module.css';

const grants = [
  'chat.send',
  'chat.moderate',
  'social.manage',
  'beatmaps.upload',
  'beatmaps.import',
  'beatmaps.moderate',
  'beatmaps.rank.request',
  'beatmaps.rank.review',
  'users.moderate',
  'users.sessions.revoke',
  'roles.manage',
  'audit.read',
  'scores.moderate',
  'admin.view',
  'announcements.manage',
];
type Section = 'users' | 'roles' | 'beatmaps' | 'scores' | 'chat' | 'audit' | 'announcements';
type RefreshAdmin = () => Promise<boolean>;
const errorKeys = {
  builtin_role: 'errorBuiltinRole',
  last_administrator: 'errorLastAdministrator',
  stronger_role: 'errorStrongerRole',
  invalid_search: 'errorInvalidSearch',
  role_assigned: 'errorRoleAssigned',
  forbidden: 'errorForbidden',
  unauthorized: 'errorUnauthorized',
} as const;
function useAdminError() {
  const t = useTranslations('admin');
  const c = useTranslations('common');
  return (error: unknown) => {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
      const key = errorKeys[error.code as keyof typeof errorKeys];
      return key ? t(key) : error.message;
    }
    return c('serviceError');
  };
}
function canDelegate(role: Role, permissions: string[]) {
  return role.permissions.every((permission) => hasPermission(permissions, permission));
}
function Feedback({
  error,
  success,
  stale = false,
}: {
  error?: string;
  success?: string;
  stale?: boolean;
}) {
  const t = useTranslations('admin');
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="form-success" role="status">
          {success}
        </p>
      )}
      {stale && (
        <p className="hint admin-refresh-note" role="status">
          {t('refreshFailed')}
        </p>
      )}
    </>
  );
}
function InlineConfirm({
  id,
  title,
  children,
  confirm,
  busy,
  onConfirm,
  onCancel,
}: {
  id: string;
  title: string;
  children: ReactNode;
  confirm: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const c = useTranslations('common');
  return (
    <div
      className="admin-confirm"
      id={id}
      role="group"
      aria-labelledby={`${id}-title`}
      aria-busy={busy}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <strong id={`${id}-title`}>{title}</strong>
      <p className="hint">{children}</p>
      <div className="actions">
        <Button
          className="admin-danger-action"
          variant="outline"
          size="sm"
          disabled={busy}
          autoFocus
          onClick={onConfirm}
        >
          {busy && <LoaderCircle className="spin" aria-hidden="true" />}
          {confirm}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          {c('cancel')}
        </Button>
      </div>
    </div>
  );
}
function UserRoles({
  player,
  roles,
  permissions,
  changed,
}: {
  player: AdminUser;
  roles: Role[];
  permissions: string[];
  changed: RefreshAdmin;
}) {
  const t = useTranslations('admin');
  const describeError = useAdminError();
  const [changes, setChanges] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [stale, setStale] = useState(false);
  const available = [
    ...roles,
    ...player.roles.filter((role) => !roles.some((known) => known.id === role.id)),
  ];
  const editableIds = new Set(
    roles.filter((role) => canDelegate(role, permissions)).map((role) => role.id),
  );
  // Keep server memberships authoritative unless this operator explicitly edits
  // a role they can still delegate. Newly returned or unseen roles are preserved.
  const chosen = Array.from(
    new Set([
      ...player.roles
        .filter((role) => !editableIds.has(role.id) || changes[role.id] !== false)
        .map((role) => role.id),
      ...roles
        .filter((role) => editableIds.has(role.id) && changes[role.id] === true)
        .map((role) => role.id),
    ]),
  );
  const locked = available.some(
    (role) => !('permissions' in role) || !canDelegate(role as Role, permissions),
  );
  const unchanged =
    chosen.length === player.roles.length && player.roles.every((role) => chosen.includes(role.id));
  return (
    <div className="admin-user-roles" aria-busy={busy}>
      <fieldset
        className="permission-list"
        aria-label={t('rolesFor', { name: player.username })}
        disabled={busy || stale}
      >
        {available.map((role) => {
          const enabled = 'permissions' in role && canDelegate(role as Role, permissions);
          return (
            <label
              key={role.id}
              htmlFor={`user-role-${player.id}-${role.id}`}
              aria-disabled={!enabled}
              title={!enabled ? t('roleLocked') : undefined}
            >
              <Checkbox
                id={`user-role-${player.id}-${role.id}`}
                checked={chosen.includes(role.id)}
                disabled={busy || stale || !enabled}
                onCheckedChange={(checked) =>
                  setChanges((old) => ({ ...old, [role.id]: checked === true }))
                }
              />
              {role.name}
            </label>
          );
        })}
      </fieldset>
      {locked && <p className="hint admin-access-hint">{t('roleLocked')}</p>}
      <Button
        variant="outline"
        size="sm"
        disabled={busy || stale || unchanged}
        onClick={async () => {
          if (busy || stale || unchanged) return;
          setBusy(true);
          setError('');
          setSuccess('');
          try {
            await api(`/admin/users/${player.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ roles: chosen }),
            });
            setSuccess(t('saved'));
            const refreshed = await changed();
            setStale(!refreshed);
            if (refreshed) setChanges({});
          } catch (error) {
            setError(describeError(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <LoaderCircle className="spin" aria-hidden="true" />
        ) : (
          <ShieldCheck aria-hidden="true" />
        )}
        {t('assignRole')}
      </Button>
      <Feedback error={error} success={success} stale={stale} />
    </div>
  );
}
function UserActions({
  player,
  permissions,
  changed,
}: {
  player: AdminUser;
  permissions: string[];
  changed: RefreshAdmin;
}) {
  const t = useTranslations('admin');
  const describeError = useAdminError();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [stale, setStale] = useState(false);
  const revokeButton = useRef<HTMLButtonElement>(null);
  const moderate = hasPermission(permissions, 'users.moderate') && player.can_moderate;
  const revoke = hasPermission(permissions, 'users.sessions.revoke') && player.can_revoke_sessions;
  function cancel() {
    setConfirm(false);
    queueMicrotask(() => revokeButton.current?.focus());
  }
  async function write(revoking = false) {
    if (busy || stale) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      if (revoking) {
        const result = await api<{ revoked: { web: number; stable: number; lazer: number } }>(
          `/admin/users/${player.id}/sessions/revoke`,
          { method: 'POST' },
        );
        setSuccess(t('sessionsRevoked', result.revoked));
        setConfirm(false);
      } else {
        await api(`/admin/users/${player.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ is_restricted: !player.is_restricted }),
        });
        setSuccess(t('saved'));
      }
      setStale(!(await changed()));
    } catch (error) {
      setError(describeError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="admin-user-actions" aria-busy={busy}>
      <div className="actions">
        {moderate && (
          <Button variant="outline" size="sm" disabled={busy || stale} onClick={() => write()}>
            {busy && !confirm && <LoaderCircle className="spin" aria-hidden="true" />}
            {t(player.is_restricted ? 'unrestrict' : 'restrict')}
          </Button>
        )}
        {revoke && (
          <Button
            ref={revokeButton}
            variant="outline"
            size="sm"
            disabled={busy || stale}
            aria-expanded={confirm}
            aria-controls={`revoke-${player.id}`}
            onClick={() => {
              setConfirm(true);
              setError('');
              setSuccess('');
            }}
          >
            {t('revokeSessions')}
          </Button>
        )}
      </div>
      {!moderate && !revoke && <p className="hint admin-access-hint">{t('actionsReadOnly')}</p>}
      {confirm && (
        <InlineConfirm
          id={`revoke-${player.id}`}
          title={t('revokeConfirm', { name: player.username })}
          confirm={t('confirmRevoke')}
          busy={busy}
          onConfirm={() => write(true)}
          onCancel={cancel}
        >
          {t('revokeHint')}
        </InlineConfirm>
      )}
      <Feedback error={error} success={success} stale={stale} />
    </div>
  );
}
const defaultBadgeColour = '#3b82f6';
const emptyBadge = { show: false, short: '', colour: defaultBadgeColour };
const badgeSwatches = ['#ff5c8d', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6'] as const;

function RolesEditor({ changed, permissions }: { changed: RefreshAdmin; permissions: string[] }) {
  const t = useTranslations('admin');
  const c = useTranslations('common');
  const describeError = useAdminError();
  const { data, error: loadError, isLoading, mutate } = useSWR<Page<Role>>('/admin/roles', fetcher);
  const [edit, setEdit] = useState<Role | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [badge, setBadge] = useState(emptyBadge);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [success, setSuccess] = useState('');
  const [stale, setStale] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const deleteButton = useRef<HTMLButtonElement | null>(null);
  const permissionChoices = Array.from(new Set([...grants, ...chosen]));
  const badgeEditable = !edit || canDelegate(edit, permissions);
  const editable = badgeEditable && (!edit || edit.name !== 'administrator');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || stale || !badgeEditable) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await api(edit ? `/admin/roles/${edit.id}` : '/admin/roles', {
        method: edit ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name: values.get('name'),
          description: values.get('description') ?? '',
          permissions: chosen,
          short_name: badge.short.trim(),
          colour: badge.colour,
          display_badge: badge.show,
        }),
      });
      setEdit(null);
      setChosen([]);
      setBadge(emptyBadge);
      form.reset();
      setSuccess(t('saved'));
      setStale(!(await changed()));
    } catch (error) {
      setError(describeError(error));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting || busy || stale) return;
    setBusy(true);
    setDeleteError('');
    setSuccess('');
    try {
      await api(`/admin/roles/${deleting.id}`, { method: 'DELETE' });
      if (edit?.id === deleting.id) {
        setEdit(null);
        setChosen([]);
        setBadge(emptyBadge);
      }
      setDeleting(null);
      setSuccess(t('roleDeleted'));
      setStale(!(await changed()));
    } catch (error) {
      setDeleteError(describeError(error));
    } finally {
      setBusy(false);
    }
  }
  function cancelDelete() {
    setDeleting(null);
    setDeleteError('');
    queueMicrotask(() => deleteButton.current?.focus());
  }
  return (
    <div aria-busy={busy}>
      {isLoading ? (
        <Loading />
      ) : loadError && !data ? (
        <LoadError retry={() => mutate()} />
      ) : (
        <div className="role-list">
          {data?.items.map((role) => {
            const delegable = canDelegate(role, permissions);
            const administrator = role.name === 'administrator';
            const editAllowed = delegable;
            const deleteAllowed = delegable && !role.is_builtin && role.membership_count === 0;
            const lockReason = !delegable ? t('roleLocked') : '';
            const deleteReason =
              lockReason ||
              (role.is_builtin
                ? t('builtinRoleHint')
                : role.membership_count > 0
                  ? t('assignedRoleHint')
                  : '');
            return (
              <div className="role-row" key={role.id} data-role-id={role.id}>
                <div className="section-heading">
                  <div>
                    <strong>
                      {role.name}
                      {role.display_badge && (
                        <RoleBadge label={role.short_name} name={role.name} colour={role.colour} />
                      )}
                    </strong>
                    <p className="hint">{role.description}</p>
                    <p className="hint admin-role-meta">
                      {t('memberships', { count: role.membership_count })}
                      {role.is_builtin && ` · ${t('builtinRole')}`}
                    </p>
                  </div>
                  <div className="actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!editAllowed || busy || stale}
                      title={lockReason || undefined}
                      onClick={() => {
                        setEdit(role);
                        setChosen(role.permissions);
                        setBadge({
                          show: role.display_badge ?? false,
                          short: role.short_name ?? '',
                          colour: role.colour ?? defaultBadgeColour,
                        });
                        setError('');
                        setSuccess('');
                        setDeleting(null);
                        queueMicrotask(() =>
                          formRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus(),
                        );
                      }}
                    >
                      {t('editRole')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!deleteAllowed || busy || stale}
                      title={deleteReason || undefined}
                      aria-expanded={deleting?.id === role.id}
                      aria-controls={`delete-${role.id}`}
                      onClick={(event) => {
                        deleteButton.current = event.currentTarget;
                        setDeleting(role);
                        setDeleteError('');
                        setSuccess('');
                      }}
                    >
                      {t('deleteRole')}
                    </Button>
                  </div>
                </div>
                <div className="permission-list">
                  {role.permissions.map((permission) => (
                    <span key={permission}>{permission}</span>
                  ))}
                </div>
                {administrator && (
                  <p className="hint admin-access-hint">{t('operatorRoleReadOnly')}</p>
                )}
                {(lockReason || deleteReason) && (
                  <p className="hint admin-access-hint">{lockReason || deleteReason}</p>
                )}
                {deleting?.id === role.id && (
                  <>
                    <InlineConfirm
                      id={`delete-${role.id}`}
                      title={t('deleteConfirm', { name: role.name })}
                      confirm={t('confirmDelete')}
                      busy={busy}
                      onConfirm={remove}
                      onCancel={cancelDelete}
                    >
                      {t('deleteHint')}
                    </InlineConfirm>
                    <Feedback error={deleteError} />
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Feedback success={success} stale={stale} />
      <form ref={formRef} className="admin-role-form" onSubmit={submit} key={edit?.id ?? 'create'}>
        <h2>{t(edit ? 'editRole' : 'newRole')}</h2>
        <div className="field">
          <label htmlFor="roleName">{t('roleName')}</label>
          <Input
            id="roleName"
            name="name"
            minLength={3}
            maxLength={32}
            pattern="[A-Za-z0-9_-]+"
            required
            defaultValue={edit?.name ?? ''}
            readOnly={edit?.is_builtin}
            disabled={busy || stale || !editable}
            aria-describedby={edit?.is_builtin ? 'builtin-role-name-hint' : 'role-name-hint'}
          />
          <p className="hint" id={edit?.is_builtin ? 'builtin-role-name-hint' : 'role-name-hint'}>
            {t(edit?.is_builtin ? 'builtinRoleHint' : 'roleNameHint')}
          </p>
        </div>
        <div className="field">
          <label htmlFor="roleDescription">{t('description')}</label>
          <Textarea
            id="roleDescription"
            name="description"
            maxLength={500}
            defaultValue={edit?.description ?? ''}
            disabled={busy || stale || !editable}
          />
        </div>
        <fieldset
          className="field permission-checkboxes"
          disabled={busy || stale || !editable}
          aria-describedby="role-permission-hint"
        >
          <legend>{t('permissions')}</legend>
          {permissionChoices.map((permission) => (
            <label
              key={permission}
              htmlFor={`role-permission-${permission}`}
              aria-disabled={!hasPermission(permissions, permission)}
            >
              <Checkbox
                id={`role-permission-${permission}`}
                checked={chosen.includes(permission)}
                disabled={busy || stale || !editable || !hasPermission(permissions, permission)}
                onCheckedChange={(checked) =>
                  setChosen((old) =>
                    checked === true
                      ? [...old, permission]
                      : old.filter((value) => value !== permission),
                  )
                }
              />
              <span>{permission}</span>
            </label>
          ))}
        </fieldset>
        <p className="hint admin-access-hint" id="role-permission-hint">
          {t('roleHint')}
        </p>
        <fieldset className="field role-badge-fields" disabled={busy || stale || !badgeEditable}>
          <legend>{t('badge')}</legend>
          <label htmlFor="roleShowBadge" className="role-badge-toggle">
            <Checkbox
              id="roleShowBadge"
              checked={badge.show}
              disabled={busy || stale || !badgeEditable}
              onCheckedChange={(checked) => setBadge((old) => ({ ...old, show: checked === true }))}
            />
            <span>{t('badgeShow')}</span>
          </label>
          <div className="field">
            <label htmlFor="roleBadgeLabel">{t('badgeLabel')}</label>
            <Input
              id="roleBadgeLabel"
              maxLength={8}
              value={badge.short}
              required={badge.show}
              onChange={(event) => setBadge((old) => ({ ...old, short: event.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="roleBadgeColour">{t('badgeColour')}</label>
            <ColorPicker
              id="roleBadgeColour"
              label={t('badgeColour')}
              value={badge.colour}
              onValueChange={(colour) => setBadge((old) => ({ ...old, colour }))}
              disabled={busy || stale || !badgeEditable}
              swatches={badgeSwatches}
            />
          </div>
          <div className="role-badge-preview" aria-label={t('badgePreview')}>
            <RoleBadge
              label={badge.short.trim() || t('badgePreviewSample')}
              name={t('badgePreview')}
              colour={badge.colour}
            />
          </div>
          <p className="hint">{t('badgeHint')}</p>
        </fieldset>
        <Feedback error={error} />
        <div className="actions">
          <Button disabled={busy || stale || !badgeEditable}>
            {busy ? (
              <LoaderCircle className="spin" aria-hidden="true" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            {edit ? c('save') : t('create')}
          </Button>
          {edit && (
            <Button
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                setEdit(null);
                setChosen([]);
                setBadge(emptyBadge);
                setError('');
              }}
            >
              {c('cancel')}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

export function BeatmapAvailabilityAction({
  map,
  disabled = false,
  changed,
  onBusy,
  accepted,
  denied,
}: {
  map: Pick<Beatmap, 'id' | 'title' | 'artist' | 'native_set_id' | 'availability'> &
    Partial<Pick<Beatmap, 'package'>>;
  disabled?: boolean;
  changed: RefreshAdmin;
  onBusy?: (busy: boolean) => void;
  accepted?: (availability: BeatmapAvailability) => void;
  denied?: (error: ApiError) => Promise<unknown>;
}) {
  const t = useTranslations('mapAvailability');
  const c = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const [stale, setStale] = useState(false);
  const writing = useRef(false);
  const withdrawn = map.availability?.withdrawn ?? false;
  const revision = map.availability?.revision ?? 0;
  const nativeSetId = map.native_set_id ?? map.package?.native_set_id;
  async function refresh() {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    try {
      const refreshed = await changed();
      setStale(!refreshed);
      if (refreshed) {
        setConflict(false);
        setError('');
        if (saved) setOpen(false);
      }
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      writing.current ||
      disabled ||
      saved ||
      stale ||
      conflict ||
      !nativeSetId ||
      target === withdrawn
    )
      return;
    const trimmed = reason.trim();
    if (
      !trimmed ||
      Array.from(trimmed).length > 500 ||
      new TextEncoder().encode(trimmed).length > 2000
    ) {
      setError(t('reasonInvalid'));
      return;
    }
    writing.current = true;
    setBusy(true);
    onBusy?.(true);
    setError('');
    try {
      const result = await api<{ native_set_id: number; availability: BeatmapAvailability }>(
        `/admin/beatmapsets/${nativeSetId}/availability`,
        {
          method: 'PATCH',
          body: JSON.stringify({ withdrawn: target, expected_revision: revision, reason: trimmed }),
        },
      );
      accepted?.(result.availability);
      // A successful write stays acknowledged even when the following read fails.
      setSaved(true);
      const refreshed = await changed();
      setStale(!refreshed);
      if (refreshed) setOpen(false);
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'availability_conflict') {
        setConflict(true);
        setError(t('conflict'));
      } else if (failure instanceof ApiError && [401, 403].includes(failure.status)) {
        await denied?.(failure);
        setError(t('permissionError'));
      } else {
        setError(t('writeError'));
      }
    } finally {
      writing.current = false;
      setBusy(false);
      onBusy?.(false);
    }
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
    >
      <Dialog.Trigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !nativeSetId || stale}
          onClick={() => {
            setTarget(!withdrawn);
            setReason('');
            setError('');
            setConflict(false);
            setSaved(false);
          }}
        >
          {t(withdrawn ? 'restore' : 'withdraw')}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="map-availability-overlay" />
        <Dialog.Content
          className="map-availability-dialog glass"
          data-material="floating"
          aria-busy={busy}
        >
          <Dialog.Title asChild>
            <h2>{t(target ? 'withdrawTitle' : 'restoreTitle')}</h2>
          </Dialog.Title>
          <Dialog.Description className="hint">
            {t(target ? 'withdrawHint' : 'restoreHint')}
          </Dialog.Description>
          <p className="map-availability-context">
            <strong>
              {map.artist} — {map.title}
            </strong>
            <span>
              {t('setId', { id: nativeSetId ?? 0 })} · {t('revision', { revision })}
            </span>
          </p>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor={`set-${map.id}-reason`}>{t('reason')}</label>
              <Textarea
                id={`set-${map.id}-reason`}
                value={reason}
                required
                maxLength={1000}
                disabled={busy || saved}
                aria-describedby={`set-${map.id}-reason-hint`}
                onChange={(event) => setReason(event.target.value)}
              />
              <p className="hint" id={`set-${map.id}-reason-hint`}>
                {t('reasonHint')}
              </p>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {saved && (
              <p className="form-success" role="status">
                {t(target ? 'withdrawnSaved' : 'restoredSaved')}
              </p>
            )}
            {stale && (
              <p className="hint" role="status">
                {t('refreshFailed')}
              </p>
            )}
            {!saved && !conflict && target === withdrawn && (
              <p className="hint" role="status">
                {t('alreadyChanged')}
              </p>
            )}
            <div className="actions">
              {stale || conflict ? (
                <Button type="button" variant="outline" disabled={busy} onClick={refresh}>
                  {busy && <LoaderCircle className="spin" aria-hidden="true" />}
                  {t('refresh')}
                </Button>
              ) : (
                <Button
                  type="submit"
                  variant="outline"
                  className={target ? 'admin-danger-action' : undefined}
                  disabled={busy || disabled || saved || target === withdrawn || !reason.trim()}
                >
                  {busy && <LoaderCircle className="spin" aria-hidden="true" />}
                  {t(target ? 'confirmWithdraw' : 'confirmRestore')}
                </Button>
              )}
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={busy}>
                  {c(saved ? 'close' : 'cancel')}
                </Button>
              </Dialog.Close>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function BeatmapAdminTools() {
  const t = useTranslations('rankRequests');
  const a = useTranslations('admin');
  const { user } = useSession();
  const query = useSearchParams();
  const canReview = !!user && hasPermission(user.permissions, 'beatmaps.rank.review');
  const canModerate = !!user && hasPermission(user.permissions, 'beatmaps.moderate');
  const requested = query.get('map_tool');
  const tool = requested === 'local' && canModerate ? 'local' : canReview ? 'requests' : 'local';
  function select(value: string) {
    const next = new URLSearchParams(window.location.search);
    next.set('tab', 'beatmaps');
    next.set('map_tool', value);
    window.history.pushState(null, '', `/admin?${next}`);
  }
  return (
    <div className={moderationStyles.beatmapWorkbench}>
      <div className={moderationStyles.subNavigation} role="group" aria-label={t('mapTools')}>
        {canReview && (
          <Button
            type="button"
            variant="ghost"
            aria-pressed={tool === 'requests'}
            onClick={() => select('requests')}
          >
            {a('rankRequests')}
          </Button>
        )}
        {canModerate && (
          <Button
            type="button"
            variant="ghost"
            aria-pressed={tool === 'local'}
            onClick={() => select('local')}
          >
            {t('localTitle')}
          </Button>
        )}
      </div>
      {tool === 'requests' ? <AdminRankRequests /> : <LocalBeatmapAdminCatalogue />}
    </div>
  );
}

function AdminContents() {
  const t = useTranslations('admin');
  const c = useTranslations('common');
  const f = useFormatter();
  const query = useSearchParams();
  const { user, refresh } = useSession();
  const { mutate: refreshCache, cache } = useSWRConfig();
  const describeError = useAdminError();
  const permissions = user?.permissions ?? [];
  const allowed = (p: string) => hasPermission(user?.permissions ?? [], p);
  const sections: Section[] = [];
  if (['users.moderate', 'roles.manage', 'users.sessions.revoke'].some(allowed))
    sections.push('users');
  if (allowed('roles.manage')) sections.push('roles');
  if (allowed('beatmaps.rank.review') || allowed('beatmaps.moderate')) sections.push('beatmaps');
  if (allowed('scores.moderate')) sections.push('scores');
  if (allowed('chat.moderate')) sections.push('chat');
  if (allowed('audit.read')) sections.push('audit');
  if (allowed('announcements.manage')) sections.push('announcements');
  const requestedSection = query.get('tab') as Section | null;
  const section =
    requestedSection && sections.includes(requestedSection) ? requestedSection : sections[0];
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const announcementNavigationGuard = useRef<AnnouncementNavigationGuard | null>(null);
  const registerAnnouncementNavigationGuard = useCallback(
    (guard: AnnouncementNavigationGuard | null) => {
      announcementNavigationGuard.current = guard;
    },
    [],
  );
  const key = section
    ? `/admin/${section}?page=${page}&page_size=24${section === 'users' && search ? `&search=${encodeURIComponent(search)}` : ''}`
    : null;
  const {
    data: result,
    error,
    isLoading,
    mutate,
  } = useSWR<Page<AdminUser | Audit>>(
    ['roles', 'beatmaps', 'announcements', 'scores', 'chat'].includes(section) || !key || !user
      ? null
      : section === 'audit'
        ? [key, user.id]
        : key,
    (request: string | [string, number]) =>
      fetcher(typeof request === 'string' ? request : request[0]),
    {
      keepPreviousData: false,
      // A decision can return to a page whose cached response predates the write.
      dedupingInterval: 0,
      onSuccess: (result, requestedKey) => {
        // Only a response for this collection and page can shrink its pagination.
        if (
          (typeof requestedKey === 'string' ? requestedKey : requestedKey[0]) !== key ||
          result.page !== page ||
          result.page_size < 1
        )
          return;
        const lastPage = Math.max(1, Math.ceil(result.total / result.page_size));
        setPage((current) => (current === result.page && current > lastPage ? lastPage : current));
      },
    },
  );
  const data =
    error instanceof ApiError && [401, 403, 404].includes(error.status) ? undefined : result;
  const {
    data: roles,
    error: rolesError,
    mutate: refreshRoles,
  } = useSWR<Page<Role>>(allowed('roles.manage') ? '/admin/roles' : null, fetcher);
  async function refreshAdministration() {
    const adminKey = (key: unknown): key is string =>
      typeof key === 'string' &&
      (key.startsWith('/admin/users') ||
        key.startsWith('/admin/roles') ||
        key.startsWith('/me/sessions'));
    const keys = Array.from(cache.keys()).filter(adminKey);
    const results = await Promise.allSettled([refreshCache(adminKey), refresh()]);
    // SWR revalidation can resolve with cached data after a failed fetch.
    return (
      results.every((result) => result.status === 'fulfilled') &&
      keys.every((key) => !cache.get(key)?.error)
    );
  }
  return (
    <>
      <div
        className={`admin-toolbar ${moderationStyles.sectionNavigation}`}
        role="group"
        aria-label={t('sections')}
      >
        {sections.map((s) => (
          <Button
            key={s}
            type="button"
            variant="ghost"
            aria-pressed={section === s}
            onClick={() => {
              if (section === s) return;
              const navigate = () => {
                const next = new URLSearchParams(window.location.search);
                next.set('tab', s);
                next.delete('page');
                window.history.pushState(null, '', `?${next}`);
                setPage(1);
              };
              if (section === 'announcements' && announcementNavigationGuard.current)
                announcementNavigationGuard.current(navigate);
              else navigate();
            }}
          >
            {t(s)}
          </Button>
        ))}
      </div>
      {section === 'users' && (
        <form
          className={`admin-search ${moderationStyles.search}`}
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(searchInput.trim());
            setPage(1);
          }}
        >
          <label className={moderationStyles.searchLabel} htmlFor="admin-user-search">
            {t('searchUsers')}
          </label>
          <div className={moderationStyles.searchControls}>
            <Input
              id="admin-user-search"
              type="search"
              maxLength={64}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              aria-describedby="admin-search-hint"
            />
            <Button type="submit" variant="outline">
              <Search aria-hidden="true" />
              {c('search')}
            </Button>
            {search && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearch('');
                  setSearchInput('');
                  setPage(1);
                }}
              >
                {t('clearSearch')}
              </Button>
            )}
          </div>
          <p className={`hint ${moderationStyles.searchHint}`} id="admin-search-hint">
            {t('searchHint')}
          </p>
        </form>
      )}
      {section === 'announcements' ? (
        <AdminAnnouncements registerNavigationGuard={registerAnnouncementNavigationGuard} />
      ) : section === 'beatmaps' ? (
        <BeatmapAdminTools key={user?.id} />
      ) : section === 'scores' ? (
        <ScoreModeration key={user?.id} />
      ) : section === 'chat' ? (
        <ChatModeration key={user?.id} />
      ) : (
        <section className="glass content-panel">
          {section === 'users' && (
            <p className="hint admin-scroll-hint" id="admin-scroll-hint">
              {t('scrollUsers')}
            </p>
          )}
          {section === 'roles' ? (
            <RolesEditor changed={refreshAdministration} permissions={permissions} />
          ) : !section ? (
            <Empty title={c('noPermission')} />
          ) : isLoading ? (
            <Loading />
          ) : error && !data ? (
            <>
              <Feedback error={describeError(error)} />
              <LoadError retry={() => mutate()} />
            </>
          ) : !data?.items.length ? (
            <Empty title={t(search && section === 'users' ? 'noSearchResults' : 'empty')} />
          ) : (
            <div
              className={`table-scroll${section === 'users' ? ' admin-users-scroll' : ''}`}
              role="region"
              aria-label={t(section)}
              aria-describedby={section === 'users' ? 'admin-scroll-hint' : undefined}
              tabIndex={0}
            >
              <table
                className={`data-table${section === 'users' ? ' admin-users-table' : ` ${moderationStyles.auditTable}`}`}
              >
                <thead>
                  <tr>
                    {(section === 'users'
                      ? [c('username'), c('status'), t('roles'), t('action')]
                      : [c('date'), t('actor'), t('action'), t('target'), t('auditDetails')]
                    ).map((label) => (
                      <th key={label}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) =>
                    section === 'users'
                      ? (() => {
                          const u = item as AdminUser;
                          return (
                            <tr key={u.id} className="admin-user-row" data-user-id={u.id}>
                              <td>
                                <Link href={`/users/${u.id}`} className="player-cell">
                                  <Avatar name={u.username} url={u.avatar_url} />
                                  {u.username}
                                </Link>
                                <p className="hint admin-player-id">
                                  #{u.id} · {u.country}
                                </p>
                              </td>
                              <td>
                                {u.is_restricted ? (
                                  <Badge variant="destructive">{t('restricted')}</Badge>
                                ) : (
                                  <Badge variant="secondary">{t('active')}</Badge>
                                )}
                              </td>
                              <td>
                                {allowed('roles.manage') && u.can_manage_roles && roles ? (
                                  <UserRoles
                                    player={u}
                                    roles={roles.items}
                                    permissions={permissions}
                                    changed={refreshAdministration}
                                  />
                                ) : (
                                  <div className="admin-user-roles">
                                    <div className="permission-list">
                                      {u.roles.map((role) => (
                                        <span key={role.id}>{role.name}</span>
                                      ))}
                                    </div>
                                    {allowed('roles.manage') && (
                                      <p className="hint admin-access-hint">
                                        {t(u.can_manage_roles ? 'rolesLoading' : 'rolesReadOnly')}
                                      </p>
                                    )}
                                    {u.can_manage_roles &&
                                      rolesError &&
                                      allowed('roles.manage') && (
                                        <>
                                          <Feedback error={describeError(rolesError)} />
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => refreshRoles()}
                                          >
                                            {c('retry')}
                                          </Button>
                                        </>
                                      )}
                                  </div>
                                )}
                              </td>
                              <td>
                                <UserActions
                                  player={u}
                                  permissions={permissions}
                                  changed={refreshAdministration}
                                />
                              </td>
                            </tr>
                          );
                        })()
                      : (() => {
                          const a = item as Audit;
                          return (
                            <tr key={a.id}>
                              <td data-label={c('date')}>
                                {f.dateTime(new Date(a.created_at), {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                })}
                              </td>
                              <td data-label={t('actor')}>
                                {(a as Audit & { actor_username?: string | null }).actor_username ??
                                  '—'}
                                {a.actor_id !== null && <p className="hint">#{a.actor_id}</p>}
                              </td>
                              <td data-label={t('action')}>{a.action}</td>
                              <td data-label={t('target')}>
                                {a.target_type} #{a.target_id}
                              </td>
                              <td data-label={t('auditDetails')}>
                                <AuditDisclosure audit={a} />
                              </td>
                            </tr>
                          );
                        })(),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {section !== 'roles' &&
        section !== 'beatmaps' &&
        section !== 'announcements' &&
        section !== 'scores' &&
        section !== 'chat' &&
        data && (
          <Pagination page={page} total={data.total} pageSize={data.page_size} onChange={setPage} />
        )}
    </>
  );
}
export function AdminPage() {
  const t = useTranslations('admin');
  return (
    <div className="page-container">
      <PageHeading title={t('title')} description={t('subtitle')} />
      <Protected>
        <Suspense fallback={<Loading />}>
          <AdminContents />
        </Suspense>
      </Protected>
    </div>
  );
}
