export type Page<T> = { items: T[]; total: number; page: number; page_size: number };
export type Notification = {
  id: number;
  kind:
    | 'rank_request_approved'
    | 'rank_request_rejected'
    | 'announcement_published'
    | 'private_message'
    | 'broadcast';
  title: string;
  message: string | null;
  href: string | null;
  created_at: string;
  read_at: string | null;
};
export type NotificationPage = Page<Notification> & {
  unread_count: number;
  snapshot_id: string;
  snapshot_size: number;
};
export type NotificationReadResult = {
  updated: number;
  unread_count: number;
};
export type AnnouncementStatus = 'draft' | 'published' | 'archived';
export type Announcement = {
  id: number;
  title: string;
  body: string;
  status: AnnouncementStatus;
  revision: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  author: { id: number; username: string; avatar_url: string | null };
};
export type ScoreVariant = 'vanilla' | 'relax';
export type ScoreBoardOrder = 'standardised_score' | 'pp';
export type ScoreBoard = Page<Score> & {
  mode: number;
  score_variant: ScoreVariant;
  ordered_by: ScoreBoardOrder;
};
export type BestScorePage = Page<Score> & {
  collection: 'best';
  ordered_by: 'pp';
  mode: number;
  score_variant: ScoreVariant;
};
export type User = {
  id: number;
  username: string;
  country: string;
  bio: string;
  avatar_url: string | null;
  banner_url: string | null;
  banner_position_x: number;
  banner_position_y: number;
  accent_color: string;
  /** Mode and score variant this profile opens with when the link names neither. */
  preferred_mode?: number;
  preferred_variant?: ScoreVariant;
  roles: string[];
  groups?: RoleGroup[];
  permissions: string[];
  joined_at: string;
  pp: number;
  play_count: number;
  statistics?: {
    mode: number;
    score_variant: ScoreVariant;
    pp: number;
    rank: number | null;
    country_rank: number | null;
    play_count: number;
    accuracy: number;
    maximum_combo?: number;
    total_hits?: number;
    total_score?: number | null;
    ranked_score?: number | null;
    score_totals_complete?: boolean;
    score_scale?: 'classic_display' | 'unavailable_for_relax';
    grade_counts?: Partial<Record<'ss' | 'ssh' | 's' | 'sh' | 'a' | 'b' | 'c' | 'd' | 'f', number>>;
  };
  email?: string;
  email_verified?: boolean;
  is_restricted?: boolean;
};
export type Preferences = {
  mode: 'dark' | 'light' | 'system';
  accent_color: string;
  background_url: string | null;
  background_mode: 'default' | 'image' | 'color';
  background_color: string;
  background_blur: number;
  background_dim: number;
  panel_blur: number;
  panel_opacity: number;
  glass_level: number;
  border_radius: number;
  locale?: string;
  pm_friends_only?: boolean;
  bancho_rank?: boolean;
};
export type BeatmapDifficulty = {
  id: number;
  native_id?: number;
  native_set_id?: number;
  official_id?: number | null;
  official_set_id?: number | null;
  title: string;
  artist: string;
  creator: string;
  version: string;
  mode: number;
  status: string;
  source: string;
  stars: number;
  length_seconds: number;
};
export type BeatmapPackage = {
  id: string;
  native_set_id: number;
  kind: 'osu' | 'osz';
  legacy: boolean;
  difficulty_count: number;
  beatmap_ids: number[];
  download_url: string;
  source?: 'local' | 'official';
};
export type Beatmap = BeatmapDifficulty & {
  uploaded_by?: number | null;
  native_set_id?: number;
  availability?: BeatmapAvailability;
  official_id: number | null;
  official_set_id?: number | null;
  bpm: number;
  max_combo: number;
  play_count: number;
  md5: string;
  download_url: string;
  download_kind: 'osu' | 'osz';
  package: BeatmapPackage | null;
};
export type BeatmapAvailability = {
  withdrawn: boolean;
  revision: number;
  reason: string | null;
  changed_at: string | null;
};
export type BeatmapUploadResult = {
  items: Beatmap[];
  package: BeatmapPackage;
  idempotent: boolean;
};
export type Score = {
  id: number;
  /** Recorded submission source; absent legacy values must not imply stable. */
  client?: string | null;
  user_id: number;
  username: string;
  beatmap_id: number;
  title: string;
  version: string;
  artist?: string | null;
  beatmapset_id?: number | null;
  native_beatmapset_id?: number | null;
  native_beatmap_id?: number | null;
  beatmap_source?: string | null;
  beatmap_mode?: number | null;
  stars?: number | null;
  grade?: 'SS' | 'SSH' | 'S' | 'SH' | 'A' | 'B' | 'C' | 'D' | 'F' | null;
  hit_counts?: Record<string, number> | null;
  beatmap_max_combo?: number | null;
  mode: number;
  score_variant?: ScoreVariant;
  score: number;
  standardised_score?: number | null;
  standardised_without_mods?: number | null;
  classic_score?: number | null;
  score_scale_status?: 'native_reported' | 'legacy_estimated' | 'legacy_scorev2' | 'unavailable';
  accuracy: number;
  max_combo: number;
  mods: number;
  api_mods?:
    { acronym: string; settings?: Record<string, number | string | boolean | null> }[] | null;
  pp_eligible?: boolean;
  pp: number;
  passed: boolean;
  verification: string;
  moderation_revision: number;
  created_at: string;
  has_replay: boolean;
  replay_complete?: boolean | null;
  position?: number;
  pp_weight?: number;
  weighted_pp?: number;
};
export type Channel = {
  id: number;
  name: string;
  description: string;
  required_permission?: string | null;
};
export type Message = {
  id: number;
  channel_id: number;
  user_id: number;
  username: string;
  avatar_url: string | null;
  content: string;
  created_at: string;
  is_action: boolean;
  client_uuid: string | null;
};
export type Conversation = {
  id: number;
  peer: { id: number; username: string; avatar_url: string | null };
  last_message: Message | null;
  last_read_id: number | null;
  unread_count: number;
  can_send: boolean;
  send_restriction: 'friend_only' | 'no_permission' | 'silenced' | null;
  silenced_until: string | null;
};
export type RecalcFilters = {
  user_id: number | null;
  user_name: string | null;
  variant: 'vanilla' | 'relax' | null;
  mode: number | null;
  from: string | null;
  to: string | null;
  beatmap_id: number | null;
  verification: string[];
  outdated_only: boolean;
  min_pp: number | null;
  max_pp: number | null;
  score_ids: number[] | null;
};
export type RecalcPreview = {
  filters: RecalcFilters;
  total: number;
  outdated: number;
  players: number;
  pp_sum: number;
  by_variant: { vanilla: number; relax: number };
  by_mode: number[];
  current_versions: { vanilla: string; relax: string };
  sample: {
    id: number;
    user_id: number;
    username: string;
    title: string;
    artist: string;
    version: string;
    beatmap_id: number;
    mode: number;
    score_variant: 'vanilla' | 'relax';
    pp: number;
    pp_calculation_version: string | null;
    created_at: string;
  }[];
};
export type RecalcJob = {
  id: number;
  created_by_name: string;
  filters: RecalcFilters;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  total: number;
  processed: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  cancel_requested: boolean;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};
export type RecalcItem = {
  score_id: number;
  outcome: 'updated' | 'skipped' | 'failed';
  previous_pp: number | null;
  new_pp: number | null;
  detail: string | null;
  username: string;
  title: string;
  version: string;
  beatmap_id: number;
};
export type RecalcJobDetail = RecalcJob & {
  changes: RecalcItem[];
  problems: RecalcItem[];
  pp_delta: number;
};
export type RoleGroup = {
  id: number;
  name: string;
  short_name: string;
  colour: string | null;
  icon?: string | null;
};
export type Role = {
  id: number;
  name: string;
  permissions: string[];
  description: string;
  description_i18n?: Record<string, string>;
  short_name: string;
  colour: string | null;
  icon?: string | null;
  display_badge: boolean;
  membership_count: number;
  is_builtin: boolean;
};
export type AdminUser = {
  id: number;
  username: string;
  email?: string;
  country: string;
  avatar_url: string | null;
  is_restricted: boolean;
  joined_at: string;
  roles: { id: number; name: string }[];
  can_manage_roles: boolean;
  can_moderate: boolean;
  can_revoke_sessions: boolean;
};
export type AdminChatUser = {
  id: number;
  username: string;
  country: string;
  avatar_url: string | null;
  chat_silenced_until: string | null;
  chat_silence_revision: number;
  can_silence: boolean;
  is_protected: boolean;
};
export type Leader = {
  id: number;
  username: string;
  country: string;
  avatar_url: string | null;
  pp: number;
  rank: number;
  play_count: number;
  accuracy: number;
};
export type Audit = {
  id: number;
  actor_id: number | null;
  action: string;
  target_type: string;
  target_id: string | null;
  created_at: string;
  details: Record<string, unknown>;
};
export type Status = {
  players_online: number;
  registered_players: number;
  ranked_scores: number;
  beatmap_count: number;
  compatibility: Record<string, unknown>;
};

/** Official metadata is distinct from a retained, playable server difficulty. */
export type OfficialBeatmapDifficulty = {
  official_id: number;
  version: string;
  mode: number;
  stars: number;
  status: string;
  length_seconds: number;
  checksum?: string;
  local_id?: number;
  archive_available?: boolean;
  bpm: number | null;
  ar: number | null;
  cs: number | null;
  od: number | null;
  hp: number | null;
  max_combo: number | null;
};
export type OfficialBeatmapset = {
  official_set_id: number;
  title: string;
  artist: string;
  creator: string;
  status: 'ranked' | 'approved' | 'qualified' | 'loved' | 'pending' | 'wip' | 'graveyard';
  cover_url: string;
  official_url: string;
  download_disabled: boolean;
  /** Server availability for a retained archive or configured full-package acquisition. */
  archive_download_available?: boolean;
  archive_download_url?: string | null;
  difficulties: OfficialBeatmapDifficulty[];
  local: { stored_count: number; archive_available: boolean; withdrawn: boolean };
};
export type OfficialBeatmapSearch = {
  items: OfficialBeatmapset[];
  total: number;
  cursor_string: string | null;
  /** Federated pages present this server's modified sets before upstream sets. */
  ordering?: 'server_modified_first';
  /** The upstream search count cannot claim to be an exact federated union. */
  total_is_exact?: boolean;
};
