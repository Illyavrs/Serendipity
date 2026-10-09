import type { DiscoverySet } from '@/features/map-discovery';
import type { OfficialBeatmapDifficulty, OfficialBeatmapset, Page } from './types';

/** A finite server catalogue, independent of osu!'s upstream search cursor and total. */
export type EffectiveOfficialBeatmapset = Omit<OfficialBeatmapset, 'difficulties' | 'status'> & {
  status: string;
  official_status: string;
  metadata_only: boolean;
  difficulties: (OfficialBeatmapDifficulty & { official_status: string })[];
};

export type ServerCatalogueSet =
  | { kind: 'stored'; stored: DiscoverySet }
  | { kind: 'official_metadata'; official: EffectiveOfficialBeatmapset };

export type ServerCataloguePage = Page<ServerCatalogueSet>;

export function serverCatalogueSetKey(set: ServerCatalogueSet) {
  return set.kind === 'stored' ? set.stored.native_set_id : set.official.official_set_id;
}
