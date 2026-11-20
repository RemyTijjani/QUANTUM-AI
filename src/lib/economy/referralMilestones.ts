import { supabase } from '@/lib/supabase';

export interface ReferralMilestone {
  threshold: number;
  rewardZap: number;
  reached: boolean;
  claimedAt: string | null;
}

export interface ReferralMilestoneSummary {
  referralCount: number;
  milestones: ReferralMilestone[];
}

const endpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/referral-milestones`;

async function request(method: 'GET' | 'POST', body?: object): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new Error('Your session has expired. Reopen the Mini App and try again.');

  const response = await fetch(endpoint, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = result && typeof result === 'object' && typeof (result as { error?: unknown }).error === 'string'
      ? (result as { error: string }).error
      : 'Referral milestone request failed.';
    throw new Error(message);
  }
  if (!result || typeof result !== 'object') throw new Error('Invalid referral milestone response.');
  return result as Record<string, unknown>;
}

function normalizeSummary(raw: Record<string, unknown>): ReferralMilestoneSummary {
  if (typeof raw.referralCount !== 'number' || !Array.isArray(raw.milestones)) {
    throw new Error('The referral milestone service returned invalid data.');
  }
  const milestones = raw.milestones.flatMap((item): ReferralMilestone[] => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Record<string, unknown>;
    if (typeof value.threshold !== 'number' || typeof value.rewardZap !== 'number' || typeof value.reached !== 'boolean') return [];
    return [{
      threshold: value.threshold,
      rewardZap: value.rewardZap,
      reached: value.reached,
      claimedAt: typeof value.claimedAt === 'string' ? value.claimedAt : null,
    }];
  });
  if (milestones.length !== 3) throw new Error('The referral milestone service returned incomplete data.');
  return { referralCount: raw.referralCount, milestones };
}

export async function fetchReferralMilestones(): Promise<ReferralMilestoneSummary> {
  const raw = await request('GET');
  if (raw.success !== true) throw new Error('Could not load referral milestones.');
  return normalizeSummary(raw);
}

export async function claimReferralMilestone(threshold: number): Promise<ReferralMilestoneSummary> {
  const raw = await request('POST', { action: 'claim_milestone', threshold });
  if (raw.success !== true) throw new Error('Could not claim this referral milestone.');
  return normalizeSummary(await request('GET'));
}
