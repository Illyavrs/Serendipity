'use client';
import { NavigationLink as Link } from '@/components/navigation-motion';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';
import { PageHeading, Loading, LoadError, Empty, Avatar } from '@/components/common';
import { CountryFlag } from '@/components/country-flag';
import { RoleBadge } from '@/components/role-badge';
import { fetcher } from '@/lib/api';
import './groups.css';

type Member = { id: number; username: string; country: string; avatar_url: string | null };
type Group = {
  id: number;
  name: string;
  description: string;
  short_name: string;
  colour: string | null;
  rank: number;
  members: Member[];
};

/** Public directory of the badge-bearing roles so players know who to ask for help. */
export function GroupsPage() {
  const t = useTranslations('groups');
  const { data, error, isLoading, mutate } = useSWR<{ items: Group[] }>('/groups', fetcher);
  return (
    <div className="page-container groups-page">
      <PageHeading title={t('title')} description={t('subtitle')} />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <LoadError retry={() => mutate()} />
      ) : !data?.items.length ? (
        <Empty title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <div className="groups-list">
          {data.items.map((group) => {
            const known = t.has(`roles.${group.name}.title`);
            const title = known ? t(`roles.${group.name}.title`) : group.name;
            const blurb = t.has(`roles.${group.name}.description`)
              ? t(`roles.${group.name}.description`)
              : group.description;
            return (
              <section
                key={group.id}
                className="groups-section glass"
                aria-labelledby={`group-${group.id}`}
              >
                <header className="groups-heading">
                  <div className="groups-title-line">
                    <RoleBadge
                      label={group.short_name || title}
                      name={group.name}
                      colour={group.colour}
                    />
                    <h2 id={`group-${group.id}`}>{title}</h2>
                    <span className="hint">
                      {t('memberCount', { count: group.members.length })}
                    </span>
                  </div>
                  {blurb && <p className="hint">{blurb}</p>}
                </header>
                {group.members.length ? (
                  <ul className="groups-members">
                    {group.members.map((member) => (
                      <li key={member.id}>
                        <Link href={`/users/${member.id}`} className="player-cell">
                          <Avatar name={member.username} url={member.avatar_url} />
                          <span>{member.username}</span>
                        </Link>
                        <CountryFlag country={member.country} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="hint">{t('noMembers')}</p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
