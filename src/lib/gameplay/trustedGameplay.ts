import { supabase } from '@/lib/supabase';
import type { FragmentId } from '@/lib/game/config';

export interface TrustedFragment {
  fragment_id: FragmentId;
  status: 'locked' | 'unlocked' | 'fixed';
  cooldown_until: string | null;
  core_mining_until: string | null;
}

export async function fetchTrustedFragments(): Promise<TrustedFragment[]> {
  const { data, error } = await supabase.functions.invoke('gameplay-actions', { method: 'GET' });
  if (error) throw error;
  return (data?.fragments ?? []) as TrustedFragment[];
}

export interface TrustedUnlockStart {
  sessionId: string | null;
  alreadyUnlocked: boolean;
}

export async function beginTrustedUnlock(fragmentId: FragmentId): Promise<TrustedUnlockStart> {
  const { data, error } = await supabase.functions.invoke('gameplay-actions', {
    body: { action: 'begin_fragment_unlock', fragmentId },
  });
  if (error) throw error;
  if (data?.success && data.alreadyUnlocked === true) {
    return { sessionId: null, alreadyUnlocked: true };
  }
  if (!data?.success || typeof data.sessionId !== 'string') {
    throw new Error(data?.reason === 'cooldown' ? 'This fragment is still cooling down.' : 'Could not start the trusted unlock session.');
  }
  return { sessionId: data.sessionId, alreadyUnlocked: false };
}

export async function completeTrustedUnlock(sessionId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('gameplay-actions', {
    body: { action: 'complete_fragment_unlock', sessionId },
  });
  if (error) throw error;
  if (!data?.success) {
    throw new Error(data?.reason === 'wait_required' ? 'Please wait until the server unlock timer finishes.' : 'The server could not verify this unlock.');
  }
}

export async function fixTrustedFragment(fragmentId: FragmentId): Promise<void> {
  const { data, error } = await supabase.functions.invoke('gameplay-actions', {
    body: { action: 'fix_fragment', fragmentId, requestId: crypto.randomUUID() },
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.reason === 'fragment_not_unlocked' ? 'Unlock this fragment through the server first.' : 'The server could not verify this fragment action.');
}


export interface ActiveTemporaryRewards {
  agentUntil: number;
  fragmentBoostUntil: number;
  fragmentBoostMultiplier: number;
}

/** Load only active, unexpired temporary rewards from the authenticated server. */
export async function fetchActiveTemporaryRewards(): Promise<ActiveTemporaryRewards> {
  const { data, error } = await supabase.functions.invoke('gameplay-actions', {
    body: { action: 'get_reward_entitlements' },
  });
  if (error) throw error;
  if (!data?.success || !Array.isArray(data.rewards)) {
    throw new Error('The trusted reward service returned an invalid response.');
  }

  const now = Date.now();
  let agentUntil = 0;
  let fragmentBoostUntil = 0;
  let fragmentBoostMultiplier = 1;

  for (const reward of data.rewards as Array<Record<string, unknown>>) {
    if (reward.status !== 'active' || typeof reward.expiresAt !== 'string') continue;
    const expiresAt = Date.parse(reward.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) continue;

    if (reward.rewardType === 'daily_streak_agent' && reward.rewardCode === 'free_agent_1_24h') {
      agentUntil = Math.max(agentUntil, expiresAt);
    }
    if (reward.rewardType === 'fragment_mining_boost' && reward.rewardCode === 'fragment_mining_2x_6h') {
      const metadata = reward.metadata && typeof reward.metadata === 'object'
        ? reward.metadata as Record<string, unknown>
        : {};
      if (Number(metadata.multiplier) === 2) {
        fragmentBoostUntil = Math.max(fragmentBoostUntil, expiresAt);
        fragmentBoostMultiplier = 2;
      }
    }
  }

  return { agentUntil, fragmentBoostUntil, fragmentBoostMultiplier };
}
