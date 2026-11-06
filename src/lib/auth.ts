import { createContext, useContext } from 'react';
import type { TelegramUser } from '@/lib/telegram';

export interface AuthPlayer {
  playerId: string;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  referralCode: string;
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'authenticated'; player: AuthPlayer };

interface AuthContextValue {
  auth: AuthState;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function extractPlayer(data: unknown): AuthPlayer {
  const d = data as Record<string, unknown>;
  return {
    playerId: d.playerId as string,
    telegramId: d.telegramId as number,
    username: (d.username as string | null) ?? null,
    firstName: (d.firstName as string | null) ?? null,
    referralCode: d.referralCode as string,
  };
}
