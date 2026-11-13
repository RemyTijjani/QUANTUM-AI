export interface VerifiedEconomy {
  verifiedZpBalance: number;
  verifiedLifetimeZp: number;
  pendingKickback: number;
  updatedAt: string | null;
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
  const value = body as Partial<VerifiedEconomy>;
  if (
    typeof value.verifiedZpBalance !== 'number' ||
    !Number.isFinite(value.verifiedZpBalance) ||
    typeof value.verifiedLifetimeZp !== 'number' ||
    !Number.isFinite(value.verifiedLifetimeZp) ||
    typeof value.pendingKickback !== 'number' ||
    !Number.isFinite(value.pendingKickback)
  ) {
    throw new VerifiedEconomyError('The verified economy service returned invalid balance data.');
  }
  return value as VerifiedEconomy;
}
