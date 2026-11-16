import { supabase } from '@/lib/supabase';

export interface ReferralKickbackActivity {
  id: string;
  eventType: string;
  amount: number;
  createdAt: string;
  referralLevel: number | null;
  status: string | null;
}

export interface ReferralKickbackSummary {
  pendingZp: number;
  claimableZp: number;
  claimableWholeZp: number;
  lifetimeEarnedZp: number;
  lifetimeClaimedZp: number;
  recentActivity: ReferralKickbackActivity[];
}

export interface ReferralKickbackClaimResult {
  success: boolean;
  alreadyClaimed?: boolean;
  reason?: string;
  claimId?: string;
  claimedZp?: number;
  zpBalance?: number;
}

const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/player-economy`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function authenticatedRequest(method: 'GET' | 'POST', body?: object): Promise<unknown> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new Error('Your session has expired. Reopen the Mini App and try again.');

  let response: Response;
  try {
    response = await fetch(functionUrl, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
    });
  } catch {
    throw new Error('Could not reach the referral rewards service.');
  }

  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(result) && typeof result.error === 'string'
      ? result.error
      : `Referral rewards request failed (${response.status}).`;
    throw new Error(message);
  }
  return result;
}

export async function fetchReferralKickbacks(): Promise<ReferralKickbackSummary> {
  const result = await authenticatedRequest('GET');
  if (!isRecord(result) || !isRecord(result.referralKickbacks)) {
    throw new Error('The referral rewards service returned an invalid response.');
  }

  const raw = result.referralKickbacks;
  const numericFields = [
    'pendingZp',
    'claimableZp',
    'claimableWholeZp',
    'lifetimeEarnedZp',
    'lifetimeClaimedZp',
  ] as const;

  for (const field of numericFields) {
    if (typeof raw[field] !== 'number' || !Number.isFinite(raw[field])) {
      throw new Error('The referral rewards service returned invalid reward totals.');
    }
  }

  const recentActivity: ReferralKickbackActivity[] = Array.isArray(raw.recentActivity)
    ? raw.recentActivity.flatMap((item): ReferralKickbackActivity[] => {
      if (!isRecord(item) ||
          typeof item.id !== 'string' ||
          typeof item.eventType !== 'string' ||
          typeof item.amount !== 'number' ||
          !Number.isFinite(item.amount) ||
          typeof item.createdAt !== 'string') return [];
      return [{
        id: item.id,
        eventType: item.eventType,
        amount: item.amount,
        createdAt: item.createdAt,
        referralLevel: typeof item.referralLevel === 'number' ? item.referralLevel : null,
        status: typeof item.status === 'string' ? item.status : null,
      }];
    })
    : [];

  return {
    pendingZp: raw.pendingZp as number,
    claimableZp: raw.claimableZp as number,
    claimableWholeZp: raw.claimableWholeZp as number,
    lifetimeEarnedZp: raw.lifetimeEarnedZp as number,
    lifetimeClaimedZp: raw.lifetimeClaimedZp as number,
    recentActivity,
  };
}

export async function claimReferralKickbacks(): Promise<ReferralKickbackClaimResult> {
  const result = await authenticatedRequest('POST', {
    action: 'claim_referral_kickbacks',
    idempotencyKey: crypto.randomUUID(),
  });
  if (!isRecord(result) || typeof result.success !== 'boolean') {
    throw new Error('The referral claim service returned an invalid response.');
  }
  return result as unknown as ReferralKickbackClaimResult;
}
