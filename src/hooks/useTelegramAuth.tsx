import { useEffect, useState, useContext } from 'react';
import { supabase } from '@/lib/supabase';
import { getTelegramInitData, getTelegramStartParam, getTelegramUser } from '@/lib/telegram';
import type { TelegramUser } from '@/lib/telegram';
import { AuthContext } from '@/lib/auth';
import { claimLocalSession } from '@/lib/localSession';
import type { AuthState, AuthPlayer } from '@/lib/auth';

const REFERRER_KEY = 'zord-referrer-code';
const AUTH_KEY = 'zord-auth-player';
const AUTH_TIMEOUT_MS = 5000;
const GUEST_OWNER_ID = 'guest';

const DEV_MOCK_PLAYER: AuthPlayer = {
  playerId: 'dev-999999',
  telegramId: 999999,
  username: 'dev_operative',
  firstName: 'Dev',
  referralCode: 'ZORD-DEV000',
};

const GUEST_PLAYER: AuthPlayer = {
  playerId: 'guest',
  telegramId: 0,
  username: null,
  firstName: null,
  referralCode: null,
};

async function authenticateWithBackend(initData: string): Promise<AuthPlayer> {
  const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-auth`;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ initData }),
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
  }

  if (!response.ok) throw new Error('Telegram verification failed.');

  const data = await response.json();

  const { data: sessionData, error: signInError } = await supabase.auth.signInWithPassword({
    email: data.email,
    password: data.password,
  });

  if (signInError || !sessionData.session) throw new Error('Failed to establish session.');

  const player: AuthPlayer = {
    playerId: sessionData.user.id,
    telegramId: data.telegramId,
    username: data.username ?? null,
    firstName: data.firstName ?? null,
    referralCode: data.referralCode,
  };

  try {
    window.localStorage.setItem(AUTH_KEY, JSON.stringify(player));
  } catch {
    // ignore
  }

  return player;
}

function playerFromTelegramUser(user: TelegramUser): AuthPlayer {
  return {
    playerId: `telegram-${user.id}`,
    telegramId: user.id,
    username: user.username ?? null,
    firstName: user.first_name ?? null,
    referralCode: null,
  };
}

async function authenticate(): Promise<{ player: AuthPlayer } | { error: string }> {
  const initData = getTelegramInitData();
  if (!initData) {
    if (import.meta.env.DEV) return { player: DEV_MOCK_PLAYER };
    return { player: GUEST_PLAYER };
  }

  try {
    return { player: await authenticateWithBackend(initData) };
  } catch (err) {
    console.warn('Backend Telegram sign-in unavailable, using Telegram identity.', err);
    const telegramUser = getTelegramUser();
    if (telegramUser) return { player: playerFromTelegramUser(telegramUser) };
    return { error: 'Could not verify your Telegram account.' };
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const telegramUser = getTelegramUser();
      await claimLocalSession(telegramUser ? String(telegramUser.id) : GUEST_OWNER_ID);
      if (cancelled) return;

      const referrerCode = getTelegramStartParam();
      if (referrerCode && referrerCode.startsWith('ZORD-')) {
        try {
          window.localStorage.setItem(REFERRER_KEY, referrerCode);
        } catch {
          // ignore
        }
      }

      let result: Awaited<ReturnType<typeof authenticate>>;
      try {
        result = await authenticate();
      } catch {
        result = { error: 'Could not reach ZORD servers. Check your connection and reopen the app.' };
      }
      if (cancelled) return;

      if ('error' in result) {
        setAuth({ status: 'error', message: result.error });
      } else {
        setAuth({ status: 'authenticated', player: result.player });
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, []);

  return <AuthContext.Provider value={{ auth }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function getStoredReferrerCode(): string | null {
  try {
    return window.localStorage.getItem(REFERRER_KEY);
  } catch {
    return null;
  }
}

export function getStoredPlayer(): AuthPlayer | null {
  return loadStoredPlayer();
}
