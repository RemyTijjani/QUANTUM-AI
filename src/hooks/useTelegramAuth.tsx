
import { useEffect, useState, useContext } from 'react';
import { supabase } from '@/lib/supabase';
import {
  getTelegramInitData,
  getTelegramStartParam,
} from '@/lib/telegram';
import { AuthContext } from '@/lib/auth';
import { claimLocalSession } from '@/lib/localSession';
import type { AuthState, AuthPlayer } from '@/lib/auth';

const REFERRER_KEY = 'zord-referrer-code';
const AUTH_KEY = 'zord-auth-player';
const LAST_TG_ID_KEY = 'zord_last_telegram_id';
const AUTH_TIMEOUT_MS = 20000;
const GUEST_OWNER_ID = 'guest';

async function authenticateWithBackend(
  initData: string,
  referrerCode?: string | null,
): Promise<AuthPlayer> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase environment variables are missing.');
  }

  const functionUrl = `${supabaseUrl}/functions/v1/telegram-auth`;
  const controller = new AbortController();

  const timer = window.setTimeout(
    () => controller.abort(),
    AUTH_TIMEOUT_MS,
  );

  let response: Response;

  try {
    response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify({ initData, referrerCode }),
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error || `Telegram authentication failed (${response.status}).`,
    );
  }

  const hasTokenHash =
    typeof data.tokenHash === 'string' && data.tokenHash.length > 0;
  const hasReferralCode =
    typeof data.referralCode === 'string' && data.referralCode.trim().length > 0;

  if (!hasTokenHash || !hasReferralCode) {
    // Log only response shape/presence, never tokens, referral codes or Telegram data.
    console.error('Telegram auth response is incomplete:', {
      responseKeys: Object.keys(data),
      hasTokenHash,
      hasReferralCode,
      hasTelegramId: data.telegramId !== undefined && data.telegramId !== null,
    });

    const missingFields = [
      !hasTokenHash ? 'session token' : null,
      !hasReferralCode ? 'referral code' : null,
    ].filter(Boolean).join(' and ');

    throw new Error(
      `Telegram authentication response is missing the ${missingFields}. Please retry.`,
    );
  }

  const { data: sessionData, error: signInError } =
    await supabase.auth.verifyOtp({
      token_hash: data.tokenHash,
      type: 'magiclink',
    });

  if (signInError || !sessionData.session || !sessionData.user) {
    throw new Error(
      signInError?.message || 'Failed to establish Supabase session.',
    );
  }

  const player: AuthPlayer = {
    playerId: sessionData.user.id,
    telegramId: data.telegramId,
    username: data.username ?? null,
    firstName: data.firstName ?? null,
    referralCode: data.referralCode,
  };

  try {
    window.localStorage.setItem(
      AUTH_KEY,
      JSON.stringify(player),
    );
  } catch {
    // Local cache is optional.
  }

  return player;
}

async function authenticate(): Promise<
  { player: AuthPlayer } | { error: string }
> {
  const initData = getTelegramInitData();

  if (!initData) {
    return {
      error: 'Open ZORD through the official Telegram Mini App.',
    };
  }

  let referrerCode: string | null = null;

  const rawStartParam = getTelegramStartParam();

  if (rawStartParam) {
    const normalized = rawStartParam
      .trim()
      .replace(/^ref_/i, '')
      .toUpperCase();

    if (normalized.startsWith('ZORD-')) {
      referrerCode = normalized;

      try {
        window.localStorage.setItem(
          REFERRER_KEY,
          referrerCode,
        );
      } catch {
        // Ignore storage errors.
      }
    }
  }

  if (!referrerCode) {
    referrerCode = getStoredReferrerCode();
  }

  try {
    const player = await authenticateWithBackend(
      initData,
      referrerCode,
    );

    return { player };
  } catch (err) {
    console.error('Telegram authentication failed:', err);

    return {
      error:
        err instanceof Error
          ? err.message
          : 'Could not register your account with ZORD servers.',
    };
  }
}

function loadStoredPlayer(): AuthPlayer | null {
  try {
    const raw = window.localStorage.getItem(AUTH_KEY);

    if (!raw) return null;

    return JSON.parse(raw) as AuthPlayer;
  } catch {
    return null;
  }
}

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [auth, setAuth] = useState<AuthState>({
    status: 'loading',
  });

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      // A normal browser must not clear or claim a Telegram player's local session.
      // Stop before any local-session ownership changes when Telegram initData is absent.
      if (!getTelegramInitData()) {
        setAuth({
          status: 'error',
          message: 'Telegram login is not available in this browser session.',
        });
        return;
      }

      const currentStartParam = getTelegramStartParam();
      const currentTgId = (() => {
        const initData = getTelegramInitData();

        if (!initData) return GUEST_OWNER_ID;

        try {
          const params = new URLSearchParams(initData);
          const user = JSON.parse(params.get('user') || '{}');

          return user.id ? String(user.id) : GUEST_OWNER_ID;
        } catch {
          return GUEST_OWNER_ID;
        }
      })();

      try {
        const lastTgId = window.localStorage.getItem(
          LAST_TG_ID_KEY,
        );

        if (lastTgId && lastTgId !== currentTgId) {
          window.localStorage.removeItem(AUTH_KEY);
          window.localStorage.removeItem(REFERRER_KEY);
        }

        window.localStorage.setItem(
          LAST_TG_ID_KEY,
          currentTgId,
        );

        // Preserve an incoming referral code.
        if (currentStartParam) {
          const normalized = currentStartParam
            .trim()
            .replace(/^ref_/i, '')
            .toUpperCase();

          if (normalized.startsWith('ZORD-')) {
            window.localStorage.setItem(
              REFERRER_KEY,
              normalized,
            );
          }
        }
      } catch {
        // Ignore local storage errors.
      }

      try {
        await claimLocalSession(currentTgId);

        if (cancelled) return;

        const result = await authenticate();

        if (cancelled) return;

        if ('error' in result) {
          setAuth({
            status: 'error',
            message: result.error,
          } as AuthState);

          return;
        }

        setAuth({
          status: 'authenticated',
          player: result.player,
        } as AuthState);
      } catch (err) {
        console.error('Authentication initialization failed:', err);

        if (!cancelled) {
          setAuth({
            status: 'error',
            message:
              err instanceof Error
                ? err.message
                : 'Authentication failed.',
          } as AuthState);
        }
      }
    };

    void init();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AuthContext.Provider value={{ auth }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    throw new Error(
      'useAuth must be used within AuthProvider',
    );
  }

  return ctx;
}

// eslint-disable-next-line react-refresh/only-export-components
export function getStoredReferrerCode(): string | null {
  try {
    return window.localStorage.getItem(REFERRER_KEY);
  } catch {
    return null;
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function getStoredPlayer(): AuthPlayer | null {
  return loadStoredPlayer();
}
