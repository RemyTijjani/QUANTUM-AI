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
