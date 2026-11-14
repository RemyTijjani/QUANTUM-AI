export interface VerifiedLedgerEntry {
  id: string;
  transactionType: string;
  amount: number;
  balanceAfter: number;
  description: string | null;
  createdAt: string | null;
}

export interface VerifiedEconomy {
  verifiedZpBalance: number;
  verifiedLifetimeZp: number;
  pendingKickback: number;
  pendingFragmentZp: number;
  nextFragmentReleaseAt: string | null;
  updatedAt: string | null;
  transactions: VerifiedLedgerEntry[];
}

export class VerifiedEconomyError extends Error {}

const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/player-economy`;

export async function fetchVerifiedEconomy(): Promise<VerifiedEconomy> {
  const { data: sessionData, error: sessionError } =
    await (await import('@/lib/supabase')).supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (sessionError || !token) {
    throw new VerifiedEconomyError('Your session has expired. Reopen the Mini App and try again.');
  }

  let response: Response;
  try {
    response = await fetch(functionUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
    });
  } catch {
    throw new VerifiedEconomyError('Could not reach the verified economy service.');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === 'object' &&
      typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `Verified economy request failed (${response.status}).`;
    throw new VerifiedEconomyError(message);
  }

  if (!body || typeof body !== 'object') {
    throw new VerifiedEconomyError('The verified economy service returned an invalid response.');
  }
  const value = body as Partial<VerifiedEconomy> & { transactions?: unknown };
  if (
    typeof value.verifiedZpBalance !== 'number' ||
    !Number.isFinite(value.verifiedZpBalance) ||
    typeof value.verifiedLifetimeZp !== 'number' ||
    !Number.isFinite(value.verifiedLifetimeZp) ||
    typeof value.pendingKickback !== 'number' ||
    !Number.isFinite(value.pendingKickback) ||
    typeof value.pendingFragmentZp !== 'number' ||
    !Number.isFinite(value.pendingFragmentZp) ||
    !(value.nextFragmentReleaseAt === null || typeof value.nextFragmentReleaseAt === 'string')
  ) {
    throw new VerifiedEconomyError('The verified economy service returned invalid balance data.');
  }

  const rawTransactions = Array.isArray(value.transactions) ? value.transactions : [];
  const transactions: VerifiedLedgerEntry[] = rawTransactions.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new VerifiedEconomyError('The verified economy service returned invalid transaction data.');
    }
    const row = entry as Partial<VerifiedLedgerEntry>;
    if (
      typeof row.id !== 'string' ||
      typeof row.transactionType !== 'string' ||
      typeof row.amount !== 'number' ||
      !Number.isFinite(row.amount) ||
      typeof row.balanceAfter !== 'number' ||
      !Number.isFinite(row.balanceAfter) ||
      !(row.description === null || typeof row.description === 'string') ||
      !(row.createdAt === null || typeof row.createdAt === 'string')
    ) {
      throw new VerifiedEconomyError('The verified economy service returned invalid transaction data.');
    }
    return row as VerifiedLedgerEntry;
  });

  return {
    verifiedZpBalance: value.verifiedZpBalance,
    verifiedLifetimeZp: value.verifiedLifetimeZp,
    pendingKickback: value.pendingKickback,
    pendingFragmentZp: value.pendingFragmentZp,
    nextFragmentReleaseAt: value.nextFragmentReleaseAt,
    updatedAt: value.updatedAt ?? null,
    transactions,
  };
}
