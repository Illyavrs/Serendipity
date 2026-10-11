'use client';
import { useLocale, useTranslations } from 'next-intl';
import useSWR from 'swr';
import { PageHeading, Loading, LoadError, Empty } from '@/components/common';
import { UserCard, type CardUser } from '@/components/user-card';
import { RoleBadge } from '@/components/role-badge';
import { fetcher } from '@/lib/api';
import './groups.css';

type Member = CardUser;
type Group = {
  id: number;
  name: string;
  description: string;
  description_i18n?: Record<string, string>;
  short_name: string;
  colour: string | null;
  rank: number;
  members: Member[];
};

/** Public directory of the badge-bearing roles so players know who to ask for help. */
export function GroupsPage() {
  const t = useTranslations('groups');
  const locale = useLocale();
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
            // Staff-written text for this locale wins, then the shipped copy for built-in groups.
            const blurb =
              group.description_i18n?.[locale] ||
              (t.has(`roles.${group.name}.description`)
                ? t(`roles.${group.name}.description`)
                : group.description);
            return (
              <section
                key={group.id}
                id={`group-${group.id}`}
                className="groups-section glass"
                aria-label={title}
              >
                <header className="groups-heading">
                  <div className="groups-title-line">
                    <RoleBadge
                      label={group.short_name || title}
                      name={group.name}
                      colour={group.colour}
                    />
                    <h2>{title}</h2>
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
                        <UserCard user={member} />
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
