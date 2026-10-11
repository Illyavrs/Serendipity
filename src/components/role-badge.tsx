import './role-badge.css';
import { NavigationLink as Link } from './navigation-motion';
import {
  Award,
  Brush,
  Bug,
  Code,
  Crown,
  Flag,
  Flame,
  Gem,
  Headphones,
  Heart,
  Leaf,
  Megaphone,
  Music,
  Rocket,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  Swords,
  Tag,
  Trophy,
  UserCheck,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties } from 'react';

type RoleBadgeProps = {
  /** Label inside the pill; the full role name is the tooltip. */
  label: string;
  name: string;
  colour: string | null;
  /** When set, the badge links to this group's entry in the user-groups directory. */
  id?: number;
  /** Icon key from `roleIcons`; absent falls back to the default for the role name. */
  icon?: string | null;
};

const hex = /^#[0-9a-f]{6}$/i;

/** Keys staff can choose when editing a group; the server validates against the same list. */
export const roleIcons: Record<string, LucideIcon> = {
  crown: Crown,
  'shield-check': ShieldCheck,
  shield: Shield,
  music: Music,
  tag: Tag,
  star: Star,
  heart: Heart,
  flame: Flame,
  gem: Gem,
  zap: Zap,
  sparkles: Sparkles,
  trophy: Trophy,
  wrench: Wrench,
  headphones: Headphones,
  brush: Brush,
  code: Code,
  flag: Flag,
  bug: Bug,
  megaphone: Megaphone,
  'user-check': UserCheck,
  award: Award,
  swords: Swords,
  rocket: Rocket,
  leaf: Leaf,
};

/** Built-in roles get a recognisable icon; any custom role falls back to a plain tag. */
const icons: Record<string, LucideIcon> = {
  super_user: Crown,
  administrator: ShieldCheck,
  moderator: Shield,
  beatmap_nominator: Music,
};

/** osu-web style group badge: a tinted pill whose text and outline use the role colour. */
export function RoleBadge({ label, name, colour, id, icon }: RoleBadgeProps) {
  const style = hex.test(colour ?? '') ? ({ '--role-colour': colour } as CSSProperties) : undefined;
  const Icon = (icon ? roleIcons[icon] : undefined) ?? icons[name] ?? Tag;
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
