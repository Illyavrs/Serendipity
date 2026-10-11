import './role-badge.css';
import { NavigationLink as Link } from './navigation-motion';
import { Crown, Music, Shield, ShieldCheck, Tag, type LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';

type RoleBadgeProps = {
  /** Label inside the pill; the full role name is the tooltip. */
  label: string;
  name: string;
  colour: string | null;
  /** When set, the badge links to this group's entry in the user-groups directory. */
  id?: number;
};

const hex = /^#[0-9a-f]{6}$/i;

/** Built-in roles get a recognisable icon; any custom role falls back to a plain tag. */
const icons: Record<string, LucideIcon> = {
  super_user: Crown,
  administrator: ShieldCheck,
  moderator: Shield,
  beatmap_nominator: Music,
};

/** osu-web style group badge: a tinted pill whose text and outline use the role colour. */
export function RoleBadge({ label, name, colour, id }: RoleBadgeProps) {
  const style = hex.test(colour ?? '') ? ({ '--role-colour': colour } as CSSProperties) : undefined;
  const Icon = icons[name] ?? Tag;
  const content = (
    <>
      <Icon aria-hidden="true" className="role-badge-icon" />
      {label}
    </>
  );
  if (id === undefined)
    return (
      <span
        className="role-badge"
        style={style}
        title={name}
        data-coloured={style ? '' : undefined}
      >
        {content}
      </span>
    );
  return (
    <Link
      href={`/groups#group-${id}`}
      className="role-badge role-badge-link"
      style={style}
      title={name}
      data-coloured={style ? '' : undefined}
    >
      {content}
    </Link>
  );
}
