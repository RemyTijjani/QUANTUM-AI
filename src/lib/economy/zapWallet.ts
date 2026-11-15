import { supabase } from '@/lib/supabase';

export interface ZapLedgerEntry {
  id: string;
  entryType: string;
  amount: string;
  balanceAfter: string;
  source: string;
  description: string | null;
  createdAt: string;
}

export interface ZapWallet {
  balance: string;
  lifetimeEarned: string;
  rankingEarned: number;
  lifetimeSpent: string;
  updatedAt: string | null;
  transactions: ZapLedgerEntry[];
}

export interface ZapLeaderboardEntry {
  rank: number;
  name: string;
  rankingEarned: number;
  isYou: boolean;
}

export interface ZapLeaderboard {
  entries: ZapLeaderboardEntry[];
  me: ZapLeaderboardEntry;
  limit: number;
}

export interface ZapAchievement {
  level: number;
  requiredNetZap: number;
  isUnlocked: boolean;
  isMinted: boolean;
  unlockedAt: string | null;
  mintedAt: string | null;
  nftCollectionAddress: string | null;
  nftItemAddress: string | null;
  nftTokenId: string | null;
}

export interface ZapAchievements {
  netZap: number;
  currentLevel: number;
  nextLevelAt: number;
  achievements: ZapAchievement[];
}

export interface ZapConversionResult {
  success: boolean;
  alreadyApplied: boolean;
  zpDebited: number;
  zapCredited: number;
  zpBalance: number;
  zapBalance: number;
  conversionReference: string;
}

export interface ZapTransferRecipient {
  username: string | null;
  firstName: string | null;
  displayName: string;
}

export interface ZapTransferResult {
  transferId: string;
  amount: string;
  alreadyApplied: boolean;
  createdAt: string;
}



function exactIntegerString(value: unknown): string | null {
  if (typeof value === 'string' && /^\\d+$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

function normalizeZapWallet(value: unknown): ZapWallet | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const balance = exactIntegerString(source.balance);
  const lifetimeEarned = exactIntegerString(source.lifetimeEarned);
  const lifetimeSpent = exactIntegerString(source.lifetimeSpent);
  if (balance === null || lifetimeEarned === null || lifetimeSpent === null || !Array.isArray(source.transactions)) {
    return null;
  }

  const transactions: ZapLedgerEntry[] = [];
  for (const item of source.transactions) {
    if (!item || typeof item !== 'object') return null;
    const entry = item as Record<string, unknown>;
    const amount = exactIntegerString(entry.amount);
    const balanceAfter = exactIntegerString(entry.balanceAfter);
    if (amount === null || balanceAfter === null ||
        typeof entry.id !== 'string' || typeof entry.entryType !== 'string' ||
        typeof entry.source !== 'string' || typeof entry.createdAt !== 'string') {
      return null;
    }
    transactions.push({
      id: entry.id,
      entryType: entry.entryType,
      amount,
      balanceAfter,
      source: entry.source,
      description: typeof entry.description === 'string' ? entry.description : null,
      createdAt: entry.createdAt,
    });
  }

  return {
    balance,
    lifetimeEarned,
    lifetimeSpent,
    rankingEarned: typeof source.rankingEarned === 'number' && Number.isFinite(source.rankingEarned)
      ? source.rankingEarned
      : 0,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null,
    transactions,
  };
}

const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zap-wallet`;

async function request<T>(method: 'GET' | 'POST', body?: Record<string, string>, query = ''): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) {
    throw new Error('Your session has expired. Reopen the Mini App and try again.');
  }

  let response: Response;
  try {
    response = await fetch(`${functionUrl}${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error('Could not reach the ZAP wallet service.');
  }

  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = result && typeof result === 'object' &&
      typeof (result as { error?: unknown }).error === 'string'
      ? (result as { error: string }).error
      : `ZAP wallet request failed (${response.status}).`;
    throw new Error(message);
  }

  if (!result || typeof result !== 'object') {
    throw new Error('The ZAP wallet service returned an invalid response.');
  }
  return result as T;
}

export async function fetchZapWallet(): Promise<ZapWallet> {
  const result = await request<{ success: boolean; wallet: unknown }>('GET');
  const wallet = normalizeZapWallet(result.wallet);
  if (!result.success || !wallet) {
    throw new Error('Could not load your ZAP wallet.');
  }
  return wallet;
}

export async function fetchZapLeaderboard(): Promise<ZapLeaderboard> {
  const result = await request<{ success: boolean; leaderboard: ZapLeaderboard }>('GET', undefined, '?action=leaderboard');
  if (!result.success || !result.leaderboard || !Array.isArray(result.leaderboard.entries) || !result.leaderboard.me) {
    throw new Error('Could not load the ZAP leaderboard.');
  }
  return result.leaderboard;
}

export async function fetchZapAchievements(): Promise<ZapAchievements> {
  const result = await request<{ success: boolean; achievements: ZapAchievements }>(
    'GET',
    undefined,
    '?action=achievements',
  );
  if (!result.success || !result.achievements || !Array.isArray(result.achievements.achievements)) {
    throw new Error('Could not load your ZAP achievements.');
  }
  return result.achievements;
}

export async function convertZpToZap(
  amountZp: string,
  idempotencyKey: string,
): Promise<{ conversion: ZapConversionResult; wallet: ZapWallet }> {
  const result = await request<{
    success: boolean;
    conversion: ZapConversionResult;
    wallet: unknown;
  }>('POST', { amountZp, idempotencyKey });
  const wallet = normalizeZapWallet(result.wallet);

  if (!result.success || !result.conversion || !wallet) {
    throw new Error('The conversion service returned an invalid result.');
  }
  return { conversion: result.conversion, wallet };
}

export async function lookupZapTransferRecipient(identifier: string): Promise<ZapTransferRecipient> {
  const result = await request<{
    success: boolean;
    recipient: ZapTransferRecipient;
  }>('GET', undefined, `?action=recipient&identifier=${encodeURIComponent(identifier.trim())}`);

  if (!result.success || !result.recipient || typeof result.recipient.displayName !== 'string') {
    throw new Error('Could not find that ZORD player.');
  }
  return result.recipient;
}

export async function transferZap(
  recipientIdentifier: string,
  amountZap: string,
  idempotencyKey: string,
): Promise<{ transfer: ZapTransferResult; recipient: ZapTransferRecipient; wallet: ZapWallet }> {
  const result = await request<{
    success: boolean;
    transfer: Omit<ZapTransferResult, 'amount'> & { amount: unknown };
    recipient: ZapTransferRecipient;
    wallet: unknown;
  }>('POST', {
    action: 'transfer',
    recipientIdentifier: recipientIdentifier.trim(),
    amountZap,
    idempotencyKey,
  });
  const wallet = normalizeZapWallet(result.wallet);
  const amount = exactIntegerString(result.transfer?.amount);

  if (!result.success || !result.transfer || amount === null || !result.recipient || !wallet) {
    throw new Error('The ZAP transfer service returned an invalid result.');
  }
  return {
    transfer: { ...result.transfer, amount },
    recipient: result.recipient,
    wallet,
  };
}
