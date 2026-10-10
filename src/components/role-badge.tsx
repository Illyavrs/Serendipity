import './role-badge.css';
import type { CSSProperties } from 'react';

type RoleBadgeProps = {
  /** Label inside the pill; the full role name is the tooltip. */
  label: string;
  name: string;
  colour: string | null;
};

const hex = /^#[0-9a-f]{6}$/i;

/** osu-web style group badge: a tinted pill whose text and outline use the role colour. */
export function RoleBadge({ label, name, colour }: RoleBadgeProps) {
  const style = hex.test(colour ?? '') ? ({ '--role-colour': colour } as CSSProperties) : undefined;
  return (
    <span className="role-badge" style={style} title={name} data-coloured={style ? '' : undefined}>
      {label}
    </span>
  );
}
