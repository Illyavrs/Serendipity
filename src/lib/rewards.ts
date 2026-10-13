import { api } from './api';
import type { Page } from './types';

export type RewardKind = 'title' | 'avatar_frame';
export type RewardStyle = 'line' | 'double' | 'corners';
export type Reward = {
  id: number;
  name: string;
  description: string;
  kind: RewardKind;
  price: number;
  color: string | null;
  style: RewardStyle | null;
  active: boolean;
  revision: number;
};
export type AdminReward = Reward & {
  owned_count: number;
  created_at: string;
  updated_at: string;
};
export type RewardMissionKey = 'play_5' | 'maps_3' | 'variety_2';
export type RewardMission = {
  key: RewardMissionKey;
  goal: number;
  progress: number;
  reward: number;
  claimed: boolean;
};
export type OwnedReward = Reward & { acquired_at: string; paid: number };
export type RewardState = {
  balance: number;
  week_start: string;
  resets_at: string;
  missions: RewardMission[];
  inventory: OwnedReward[];
  equipment: { title: Reward | null; avatar_frame: Reward | null };
};
export type RewardMutation = { state: RewardState; idempotent: boolean };
export type RewardInput = Pick<
  Reward,
  'name' | 'description' | 'kind' | 'price' | 'color' | 'style' | 'active'
>;
export type RewardEquipmentInput = { title_id: number | null; avatar_frame_id: number | null };

export const rewardsPath = (page = 1, pageSize = 12) =>
  `/rewards?page=${page}&page_size=${pageSize}`;
export const adminRewardsPath = (page = 1, pageSize = 12) =>
  `/admin/rewards?page=${page}&page_size=${pageSize}`;
export const getRewardState = () => api<RewardState>('/me/rewards');
export const getRewards = (page = 1, pageSize = 12) =>
  api<Page<Reward>>(rewardsPath(page, pageSize));
export const claimRewardMission = (key: RewardMissionKey, weekStart: string) =>
  api<RewardMutation>(`/me/rewards/missions/${key}/claim`, {
    method: 'POST',
    body: JSON.stringify({ week_start: weekStart }),
  });
export const purchaseReward = (reward: Pick<Reward, 'id' | 'revision'>) =>
  api<RewardMutation>('/me/rewards/purchases', {
    method: 'POST',
    body: JSON.stringify({ reward_id: reward.id, revision: reward.revision }),
  });
export const updateRewardEquipment = (equipment: RewardEquipmentInput) =>
  api<RewardMutation>('/me/rewards/equipment', {
    method: 'PATCH',
    // Both slots are explicit, including a null slot being removed.
    body: JSON.stringify(equipment),
  });
export const getAdminRewards = (page = 1, pageSize = 12) =>
  api<Page<AdminReward>>(adminRewardsPath(page, pageSize));
export const createReward = (input: RewardInput) =>
  api<AdminReward>('/admin/rewards', { method: 'POST', body: JSON.stringify(input) });
export const updateReward = (id: number, input: RewardInput, revision: number) =>
  api<AdminReward>(`/admin/rewards/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...input, revision }),
  });
export const deleteReward = (id: number, revision: number) =>
  api<{ ok: true }>(`/admin/rewards/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ revision }),
  });
