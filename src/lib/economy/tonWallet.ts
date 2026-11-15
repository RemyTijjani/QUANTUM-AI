import { supabase } from '@/lib/supabase';

export interface TonWalletData {
  wallet: {
    id: string;
    wallet_address: string;
    network: string;
    verification_status: 'pending' | 'verified' | 'revoked';
    verified_at: string | null;
  } | null;
  balance: {
    availableNano: string;
    reservedNano: string;
    updatedAt: string | null;
  };
  transactions: Array<{
    id: string;
    entry_type: string;
    direction: string;
    amount_nano: string;
    available_after_nano: string;
    reference_type: string;
    created_at: string;
  }>;
  withdrawals: Array<{
    id: string;
    amount_nano: string;
    status: string;
    wallet_address: string;
    transaction_hash: string | null;
    admin_note: string | null;
    created_at: string;
    updated_at: string;
    paid_at: string | null;
  }>;
}

const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ton-wallet`;

async function request<T>(method: 'GET' | 'POST', body?: Record<string, string | object>): Promise<T> {
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
    });
  } catch {
    throw new Error('Could not reach the TON wallet service.');
  }

  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = result && typeof result === 'object' &&
      typeof (result as { error?: unknown }).error === 'string'
      ? (result as { error: string }).error
      : `TON wallet request failed (${response.status}).`;
    throw new Error(message);
  }
  if (!result || typeof result !== 'object') throw new Error('The TON wallet service returned an invalid response.');
  return result as T;
}

export async function fetchTonWallet(): Promise<TonWalletData> {
  const result = await request<{ success: boolean } & TonWalletData>('GET');
  if (!result.success || !result.balance) throw new Error('Could not load your TON wallet.');
  return result;
}

export async function createTonProofChallenge(): Promise<string> {
  const result = await request<{ success: boolean; payload: string }>('POST', { action: 'challenge' });
  if (!result.success || typeof result.payload !== 'string') throw new Error('Could not prepare wallet verification.');
  return result.payload;
}

export async function verifyTonWalletProof(input: {
  address: string;
  network: string;
  public_key?: string;
  proof: {
    timestamp: number | string;
    domain: { lengthBytes: number; value: string };
    signature: string;
    payload: string;
    state_init: string;
  };
}): Promise<TonWalletData['wallet']> {
  const result = await request<{ success: boolean; wallet: TonWalletData['wallet'] }>('POST', {
    action: 'verify',
    ...input,
  });
  if (!result.success || !result.wallet) throw new Error('Wallet ownership could not be verified.');
  return result.wallet;
}

export async function requestTonWithdrawal(amountNano: string, idempotencyKey: string): Promise<TonWalletData> {
  const result = await request<{ success: boolean } & TonWalletData>('POST', {
    action: 'withdraw',
    amountNano,
    idempotencyKey,
  });
  if (!result.success || !result.balance) throw new Error('Could not create the withdrawal request.');
  return result;
}

export function nanoTonToTon(value: string | number): string {
  const amount = BigInt(String(value || 0));
  const whole = amount / 1_000_000_000n;
  const fraction = (amount % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function tonToNanoTon(value: string): string {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,9})?$/.test(normalized)) throw new Error('Enter a valid TON amount (up to 9 decimal places).');
  const [whole, fraction = ''] = normalized.split('.');
  return (BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0') || '0')).toString();
}
