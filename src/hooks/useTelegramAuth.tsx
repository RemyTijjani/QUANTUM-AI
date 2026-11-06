import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { getTelegramInitData, getTelegramStartParam } from '@/lib/telegram';
import { AuthContext } from '@/lib/auth';
import type { AuthState, AuthPlayer } from '@/lib/auth';

const REFERRER_KEY = 'zord-referrer-code';
const AUTH_KEY = 'zord-auth-player';

async function authenticate(): Promise<{ player: AuthPlayer } | { error: string }> {
  const initData = getTelegramInitData();
  if (!initData) {
    return { error: 'This app must be opened from Telegram.' };
  }

  const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-auth`;
  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ initData }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return { error: body.error ?? 'Telegram verification failed.' };
  }

  const data = await response.json();

  const { data: sessionData, error: signInError } = await supabase.auth.signInWithPassword({
    email: data.email,
    password: data.password,
  });

  if (signInError || !sessionData.session) {
    return { error: 'Failed to establish session.' };
  }

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

  return { player };
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
      const referrerCode = getTelegramStartParam();
      if (referrerCode && referrerCode.startsWith('ZORD-')) {
        try {
          window.localStorage.setItem(REFERRER_KEY, referrerCode);
        } catch {
          // ignore
        }
      }

      const result = await authenticate();
      if (cancelled) return;

      if ('error' in result) {
        setAuth({ status: 'error', message: result.error });
      } else {
        setAuth({ status: 'authenticated', player: result.player });
      }
    };

    init();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        (async () => {
          try {
            window.localStorage.removeItem(AUTH_KEY);
          } catch {
            // ignore
          }
          if (!cancelled) setAuth({ status: 'loading' });
          await init();
        })();
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
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
