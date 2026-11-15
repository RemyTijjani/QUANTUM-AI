import { supabase } from '@/lib/supabase';

export interface ZapLedgerEntry {
  id: string;
  entryType: string;
  amount: number;
  balanceAfter: number;
  source: string;
  description: string | null;
  createdAt: string;
}

export interface ZapWallet {
  balance: number;
  lifetimeEarned: number;
  rankingEarned: number;
  lifetimeSpent: number;
  updatedAt: string | null;
  transactions: ZapLedgerEntry[];
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

const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zap-wallet`;

async function request<T>(method: 'GET' | 'POST', body?: Record<string, string>): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) {
    throw new Error('Your session has expired. Reopen the Mini App and try again.');
  }

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
  const result = await request<{ success: boolean; wallet: ZapWallet }>('GET');
  if (!result.success || !result.wallet || typeof result.wallet.balance !== 'number') {
    throw new Error('Could not load your ZAP wallet.');
  }
  return result.wallet;
}

export async function convertZpToZap(
  amountZp: string,
  idempotencyKey: string,
): Promise<{ conversion: ZapConversionResult; wallet: ZapWallet }> {
  const result = await request<{
    success: boolean;
    conversion: ZapConversionResult;
    wallet: ZapWallet;
  }>('POST', { amountZp, idempotencyKey });

  if (!result.success || !result.conversion || !result.wallet) {
    throw new Error('The conversion service returned an invalid result.');
  }
  return { conversion: result.conversion, wallet: result.wallet };
}
