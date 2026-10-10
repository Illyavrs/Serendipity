'use client';

import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, Clock, Star } from 'lucide-react';
import { NavigationLink as Link } from '@/components/navigation-motion';
import type { EffectiveOfficialBeatmapset } from '@/lib/effective-map-catalogue';
import { MapCardPreview } from './map-card-preview';
import { MapAudioPreview } from './map-audio-preview';
import { MapStatus } from './map-status';
import { MapArtwork, mapDuration, mapStarRange } from './map-discovery';
import { beatmapsetPath, beatmapDifficultyHash } from '@/lib/beatmap-routes';

const modes = ['osu!', 'taiko', 'catch', 'mania'];

/** Official metadata has a canonical set route and never a fabricated local map ID. */
export function ServerOfficialSetCard({
  set,
  matchingStatus,
}: {
  set: EffectiveOfficialBeatmapset;
  returnTo: string;
  matchingStatus?: string;
}) {
  const t = useTranslations('mapDiscovery');
  const official = useTranslations('publicOfficialMaps');
  const stars = set.difficulties.map((map) => map.stars);
  const lengths = set.difficulties.map((map) => map.length_seconds);
  const modeNames = [...new Set(set.difficulties.map((map) => modes[map.mode]))].join(' / ');
  const effectiveStatuses = [...new Set(set.difficulties.map((map) => map.status))];
  const selectedStatus =
    matchingStatus && effectiveStatuses.includes(matchingStatus) ? matchingStatus : null;
  const mixed = effectiveStatuses.length > 1;
  const mappedBy = t('mappedBy', { creator: set.creator });
  const lengthMin = Math.min(...lengths);
  const lengthMax = Math.max(...lengths);
  return (
    <article
      className="discovery-set glass"
      data-catalogue-kind="official-metadata"
      style={{ '--catalogue-cover': `url("${set.cover_url}")` } as CSSProperties}
    >
      <Link
        href={`${beatmapsetPath(set.official_set_id)}${set.difficulties[0] ? beatmapDifficultyHash(set.difficulties[0].mode, set.difficulties[0].official_id) : ''}`}
        className="discovery-set-main"
      >
        <MapArtwork source="official" nativeSetId={set.official_set_id} />
        <div className="discovery-set-copy">
          <h2 title={set.title}>{set.title}</h2>
          <span className="discovery-artist" title={set.artist}>
            {set.artist}
          </span>
          <p title={mappedBy}>{mappedBy}</p>
          <div className="discovery-set-meta">
            <span className="discovery-stars">
              <Star aria-hidden="true" />
              {mapStarRange(Math.min(...stars), Math.max(...stars))}
            </span>
            <span>
              <Clock aria-hidden="true" />
              {lengthMin === lengthMax
                ? mapDuration(lengthMin)
                : `${mapDuration(lengthMin)}–${mapDuration(lengthMax)}`}
            </span>
            <span className="discovery-modes" title={modeNames}>
              {modeNames}
            </span>
          </div>
        </div>
        <ArrowRight className="discovery-open" aria-hidden="true" />
      </Link>
      <MapAudioPreview setId={set.official_set_id} title={set.title} />
      <div className="discovery-difficulties">
        <div className={`discovery-set-statuses${mixed ? ' discovery-set-statuses-mixed' : ''}`}>
          <MapStatus
            value={selectedStatus ?? set.status}
            context={selectedStatus ? 'difficulty' : 'set'}
          />
          {mixed && (
            <span className="discovery-source" title={official('mixedStatusesHint')}>
              {official('mixedStatuses')}
            </span>
          )}
          {set.metadata_only && (
            <span className="discovery-source" title={t('serverMetadataOnlyHint')}>
              {t('serverMetadataOnly')}
            </span>
          )}
        </div>
        <MapCardPreview official={set} />
      </div>
    </article>
  );
}
