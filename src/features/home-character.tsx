'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, type PointerEvent } from 'react';

// The supplied portrait gently acknowledges a hovering pointer. The artwork
// remains decorative: no extra tab stop, click action, timer, or idle loop.
export function HomeCharacter() {
  const portrait = useRef<HTMLDivElement>(null);
  const enabled = useRef(false);
  const frame = useRef<number | null>(null);

  const reset = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const element = portrait.current;
    if (!element) return;
    element.style.removeProperty('--character-x');
    element.style.removeProperty('--character-y');
    element.style.removeProperty('--character-lean');
    element.dataset.following = 'false';
  }, []);

  useEffect(() => {
    const pointer = matchMedia('(hover: hover) and (pointer: fine)');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    function update() {
      enabled.current = pointer.matches && !reduced.matches;
      if (portrait.current) portrait.current.dataset.motionReady = String(enabled.current);
      reset();
    }
    function hide() {
      if (document.hidden) reset();
    }
    update();
    pointer.addEventListener('change', update);
    reduced.addEventListener('change', update);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', hide);
    return () => {
      enabled.current = false;
      pointer.removeEventListener('change', update);
      reduced.removeEventListener('change', update);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', hide);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [reset]);

  function follow(event: PointerEvent<HTMLDivElement>) {
    if (!enabled.current || event.pointerType === 'touch') return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, ((event.clientX - box.left) / box.width - 0.5) * 2));
    const y = Math.max(-1, Math.min(1, ((event.clientY - box.top) / box.height - 0.5) * 2));
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const element = portrait.current;
      if (!element || !enabled.current) return;
      // Pivot near the face so its projecting crown stays inside the existing
      // crop, while the hair and shoulders provide the visible response.
      element.style.setProperty('--character-x', `${(x * 4).toFixed(3)}px`);
      element.style.setProperty('--character-y', `${(y * 2).toFixed(3)}px`);
      element.style.setProperty('--character-lean', `${(x * 0.9).toFixed(3)}deg`);
      element.dataset.following = 'true';
    });
  }

  return (
    <div
      ref={portrait}
      className="home-hero-character"
      aria-hidden="true"
      data-motion-ready="false"
      data-following="false"
      onPointerMove={follow}
      onPointerLeave={reset}
      onPointerCancel={reset}
    >
      <Image
        src="/images/home-character.webp"
        width={700}
        height={1251}
        alt=""
        className="home-character-image"
        sizes="(max-width: 360px) 270px, (max-width: 600px) 300px, (max-width: 800px) 360px, (max-width: 1000px) 400px, 480px"
        loading="eager"
        fetchPriority="high"
        draggable={false}
        unoptimized
      />
    </div>
  );
}
