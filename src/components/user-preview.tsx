'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { fetchPublicUserCard } from '@/lib/public-user-cards';
import { UserCard, type CardUser } from './user-card';
import styles from './user-preview.module.css';

type Point = { x: number; y: number };
type Target = Point & { anchor: HTMLAnchorElement; id: number; keyboard: boolean };
type Preview = Point & { user: CardUser; open: boolean };

/** Only explicitly marked identity links qualify; navigation links and popup links do not. */
function identity(target: EventTarget | null): { anchor: HTMLAnchorElement; id: number } | null {
  if (!(target instanceof Element) || target.closest('[data-user-preview-card]')) return null;
  const anchor = target.closest<HTMLAnchorElement>('a[data-user-preview][href]');
  if (!anchor) return null;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  const match = /^\/users\/([1-9]\d*)\/?$/.exec(url.pathname);
  const id = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(id) && id > 0 ? { anchor, id } : null;
}

/** Shared, lazy preview for username and avatar links. The card stays still once opened. */
export function UserPreview() {
  const pathname = usePathname();
  const dialogId = useId();
  const [preview, setPreview] = useState<Preview | null>(null);
  const target = useRef<Target | null>(null);
  const popup = useRef<HTMLDivElement | null>(null);
  const token = useRef(0);
  const shown = useRef(false);
  const delay = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const grace = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fade = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef(0);
  const suppressed = useRef<HTMLAnchorElement | null>(null);
  const triggerAttributes = useRef<{
    anchor: HTMLAnchorElement;
    values: (string | null)[];
  } | null>(null);

  const placePopup = useCallback(
    (element: HTMLDivElement | null) => {
      popup.current = element;
      if (!element || !preview) return;
      const position = () => {
        const { width, height } = element.getBoundingClientRect();
        const edge = 12;
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight;
        const nextX =
          preview.x + width + edge * 2 <= viewportWidth
            ? preview.x + edge
            : preview.x - width - edge;
        const nextY =
          preview.y + height + edge * 2 <= viewportHeight
            ? preview.y + edge
            : preview.y - height - edge;
        element.style.left = `${Math.max(edge, Math.min(nextX, viewportWidth - width - edge))}px`;
        element.style.top = `${Math.max(edge, Math.min(nextY, viewportHeight - height - edge))}px`;
      };
      position();
      const observer = new ResizeObserver(position);
      observer.observe(element);
      return () => observer.disconnect();
    },
    [preview],
  );

  useEffect(() => {
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    function invalidateRequest() {
      token.current++;
    }
    function restoreTriggerAttributes() {
      const saved = triggerAttributes.current;
      if (!saved) return;
      ['aria-controls', 'aria-expanded', 'aria-haspopup'].forEach((name, index) => {
        const value = saved.values[index];
        if (value === null) saved.anchor.removeAttribute(name);
        else saved.anchor.setAttribute(name, value);
      });
      triggerAttributes.current = null;
    }
    function cancelTimers() {
      clearTimeout(delay.current);
      clearTimeout(grace.current);
      clearTimeout(fade.current);
      cancelAnimationFrame(frame.current);
    }
    function dismiss(immediately = false) {
      invalidateRequest();
      cancelTimers();
      restoreTriggerAttributes();
      shown.current = false;
      target.current = null;
      if (immediately) setPreview(null);
      else {
        setPreview((current) => (current ? { ...current, open: false } : null));
        fade.current = setTimeout(() => setPreview(null), 150);
      }
    }
    // Route changes also cover browser Back/Forward, where no anchor click occurs.
    queueMicrotask(() => dismiss(true));
    function ownedMenuOpen() {
      return Boolean(
        popup.current?.querySelector('[data-slot="dropdown-menu-trigger"][data-state="open"]'),
      );
    }
    function inPopupScope(element: EventTarget | null) {
      return (
        element instanceof Element &&
        (popup.current?.contains(element) ||
          (ownedMenuOpen() && element.closest('[data-slot="dropdown-menu-content"]')))
      );
    }
    function begin(anchor: HTMLAnchorElement, id: number, point: Point, keyboard: boolean) {
      if (!finePointer.matches || suppressed.current === anchor) return;
      if (target.current?.anchor === anchor) {
        target.current.keyboard ||= keyboard;
        clearTimeout(grace.current);
        return;
      }
      dismiss(true);
      suppressed.current = null;
      const requestToken = token.current;
      target.current = { anchor, id, ...point, keyboard };
      delay.current = setTimeout(() => {
        void fetchPublicUserCard(id).then((user) => {
          const current = target.current;
          if (
            !user ||
            user.id !== id ||
            token.current !== requestToken ||
            current?.anchor !== anchor ||
            !anchor.isConnected
          )
            return;
          shown.current = true;
          triggerAttributes.current = {
            anchor,
            values: ['aria-controls', 'aria-expanded', 'aria-haspopup'].map((name) =>
              anchor.getAttribute(name),
            ),
          };
          anchor.setAttribute('aria-controls', dialogId);
          anchor.setAttribute('aria-expanded', 'true');
          anchor.setAttribute('aria-haspopup', 'dialog');
          setPreview({ user, x: current.x, y: current.y, open: false });
          frame.current = requestAnimationFrame(() => {
            if (token.current === requestToken)
              setPreview((value) => (value?.user.id === id ? { ...value, open: true } : value));
          });
        });
      }, 180);
    }
    function leave() {
      clearTimeout(grace.current);
      grace.current = setTimeout(() => dismiss(), 130);
    }
    function over(event: PointerEvent) {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      if (inPopupScope(event.target)) {
        clearTimeout(grace.current);
        return;
      }
      if (ownedMenuOpen()) return;
      const next = identity(event.target);
      if (next) begin(next.anchor, next.id, { x: event.clientX, y: event.clientY }, false);
    }
    function out(event: PointerEvent) {
      const next = identity(event.relatedTarget);
      if (next?.anchor === target.current?.anchor || inPopupScope(event.relatedTarget)) return;
      if (event.target === suppressed.current || !next) suppressed.current = null;
      const current = target.current;
      if (
        !current ||
        (identity(event.target)?.anchor !== current.anchor && !inPopupScope(event.target)) ||
        (current.keyboard &&
          (document.activeElement === current.anchor || inPopupScope(document.activeElement)))
      )
        return;
      if (ownedMenuOpen()) return;
      leave();
    }
    function move(event: PointerEvent) {
      const current = target.current;
      if (!shown.current && current?.anchor.contains(event.target as Node)) {
        current.x = event.clientX;
        current.y = event.clientY;
      }
    }
    function focus(event: FocusEvent) {
      if (inPopupScope(event.target)) {
        clearTimeout(grace.current);
        return;
      }
      const next = identity(event.target);
      if (!next) return;
      const bounds = next.anchor.getBoundingClientRect();
      begin(next.anchor, next.id, { x: bounds.right, y: bounds.bottom }, true);
    }
    function blur(event: FocusEvent) {
      if (
        inPopupScope(event.relatedTarget) ||
        identity(event.relatedTarget)?.anchor === target.current?.anchor
      )
        return;
      leave();
    }
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape' && target.current) {
        const anchor = target.current.anchor;
        const restore = popup.current?.contains(document.activeElement);
        suppressed.current = anchor;
        dismiss();
        if (restore) anchor.focus({ preventScroll: true });
      } else if (
        event.key === 'ArrowDown' &&
        shown.current &&
        document.activeElement === target.current?.anchor
      ) {
        const first = popup.current?.querySelector<HTMLElement>('a[href], button:not([disabled])');
        if (first) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    function down(event: PointerEvent) {
      if (event.pointerType === 'touch') return dismiss(true);
      if (inPopupScope(event.target) || target.current?.anchor.contains(event.target as Node))
        return;
      dismiss();
    }
    function click(event: MouseEvent) {
      if (event.target instanceof Element && event.target.closest('a[href]')) dismiss(true);
    }
    const externalDismiss = (event: Event) => {
      if (event.type === 'scroll' && inPopupScope(event.target)) return;
      dismiss(true);
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('click', click, true);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', blur);
    document.addEventListener('keydown', key);
    document.addEventListener('scroll', externalDismiss, true);
    window.addEventListener('resize', externalDismiss);
    window.addEventListener('blur', externalDismiss);
    finePointer.addEventListener('change', externalDismiss);
    const observer = new MutationObserver(() => {
      if (target.current && !target.current.anchor.isConnected) dismiss(true);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      invalidateRequest();
      cancelTimers();
      restoreTriggerAttributes();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', blur);
      document.removeEventListener('keydown', key);
      document.removeEventListener('scroll', externalDismiss, true);
      window.removeEventListener('resize', externalDismiss);
      window.removeEventListener('blur', externalDismiss);
      finePointer.removeEventListener('change', externalDismiss);
      observer.disconnect();
    };
  }, [pathname, dialogId]);

  if (!preview) return null;
  return createPortal(
    <div
      ref={placePopup}
      id={dialogId}
      role="dialog"
      aria-label={preview.user.username}
      aria-modal="false"
      aria-hidden={!preview.open}
      className={styles.popup}
      data-user-preview-card
      data-material="floating"
      data-open={preview.open}
    >
      <UserCard user={preview.user} />
    </div>,
    document.body,
  );
}
