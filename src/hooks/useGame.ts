import { useCallback, useEffect, useMemo, useState } from 'react';

import { gameReducer } from '@/lib/game/state';
import type { GameState } from '@/lib/game/state';

import { loadState, saveState } from '@/lib/game/storage';
import type { FragmentId } from '@/lib/game/config';
import { FRAGMENT_IDS } from '@/lib/game/config';

import {
  beginTrustedUnlock,
  completeTrustedUnlock,
  checkTrustedUnlockStatus,
  completeFreeFragmentUnlock,
  fetchTrustedFragments,
  fixTrustedFragment,
  fetchActiveTemporaryRewards,
} from '@/lib/gameplay/trustedGameplay';

export function useGame(
  referralCode: string | null,
  playerId: string,
): {
  state: GameState;
  isLoading: boolean;
  clockNow: number;
  trustedGameplay: {
    beginUnlock: (id: FragmentId) => Promise<{ sessionId: string | null; ymid: string | null; alreadyUnlocked: boolean; provider: 'monetag' | 'onclicka' | 'adsgram' | 'free' }>;
    completeUnlock: (sessionId: string, provider?: 'monetag' | 'onclicka' | 'adsgram') => Promise<boolean>;
    checkUnlockStatus: (sessionId: string) => Promise<{ completed: boolean; pending: boolean }>;
    completeFreeFragmentUnlock: (sessionId: string) => Promise<boolean>;
    fixFragment: (id: FragmentId) => Promise<void>;
  };
} {
  const [state, setState] = useState<GameState>(() =>
    loadState(Date.now(), referralCode, playerId),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [clockNow, setClockNow] = useState(() => Date.now());
  // Legacy game state stays on this device. Verified balances, Fragment
  // progress, rewards, and rentals are loaded from their dedicated services.
  // The client no longer reads or writes player_game_states in Supabase.
  useEffect(() => {
    setIsLoading(true);
    setState(loadState(Date.now(), referralCode, playerId));
    setIsLoading(false);
  }, [playerId, referralCode]);

  useEffect(() => {
    if (isLoading) return;
    saveState(state, playerId);
  }, [state, playerId, isLoading]);

  const applyTrustedFragments = useCallback(async () => {
    const fragments = await fetchTrustedFragments();
    setState((previous) => {
      const next: GameState = {
        ...previous,
        fragments: Object.fromEntries(
          FRAGMENT_IDS.map((id) => [id, 'locked']),
        ) as GameState['fragments'],
        fragmentCooldowns: Object.fromEntries(
          FRAGMENT_IDS.map((id) => [id, 0]),
        ) as GameState['fragmentCooldowns'],
        fragmentMiningUntil: Object.fromEntries(
          FRAGMENT_IDS.map((id) => [id, 0]),
        ) as GameState['fragmentMiningUntil'],
        coreMiningUntil: 0,
      };

      for (const fragment of fragments) {
        next.fragments[fragment.fragment_id] = fragment.status;
        next.fragmentCooldowns[fragment.fragment_id] = fragment.cooldown_until
          ? Date.parse(fragment.cooldown_until)
          : 0;
        next.fragmentMiningUntil[fragment.fragment_id] = fragment.core_mining_until
          ? Date.parse(fragment.core_mining_until)
          : 0;
        next.coreMiningUntil = Math.max(
          next.coreMiningUntil,
          next.fragmentMiningUntil[fragment.fragment_id],
        );
      }
      return next;
    });
  }, []);

  const trustedGameplay = useMemo(() => ({
    beginUnlock: async (id: FragmentId) => {
      const result = await beginTrustedUnlock(id);
      if (result.alreadyUnlocked) await applyTrustedFragments();
      return result;
    },
    completeUnlock: async (sessionId: string, provider: 'monetag' | 'onclicka' | 'adsgram' = 'monetag') => {
      const completed = await completeTrustedUnlock(sessionId, provider);
      if (completed) await applyTrustedFragments();
      return completed;
    },
    checkUnlockStatus: async (sessionId: string) => {
      const status = await checkTrustedUnlockStatus(sessionId);
      if (status.completed) await applyTrustedFragments();
      return status;
    },
    completeFreeFragmentUnlock: async (sessionId: string) => {
      const completed = await completeFreeFragmentUnlock(sessionId);
      if (completed) await applyTrustedFragments();
      return completed;
    },
    fixFragment: async (id: FragmentId) => {
      await fixTrustedFragment(id);
      await applyTrustedFragments();
    },
  }), [applyTrustedFragments]);

  // Trusted Fragment rows replace every legacy client-saved Fragment value.
  // An empty result or failed request must never leave stale local progress active.
  useEffect(() => {
    if (isLoading) return;
    let cancelled = false;

    void fetchTrustedFragments().then((fragments) => {
      if (cancelled) return;
      setState((previous) => {
        const next: GameState = {
          ...previous,
          fragments: Object.fromEntries(
            FRAGMENT_IDS.map((id) => [id, 'locked']),
          ) as GameState['fragments'],
          fragmentCooldowns: Object.fromEntries(
            FRAGMENT_IDS.map((id) => [id, 0]),
          ) as GameState['fragmentCooldowns'],
          fragmentMiningUntil: Object.fromEntries(
            FRAGMENT_IDS.map((id) => [id, 0]),
          ) as GameState['fragmentMiningUntil'],
          coreMiningUntil: 0,
        };

        for (const fragment of fragments) {
          next.fragments[fragment.fragment_id] = fragment.status;
          next.fragmentCooldowns[fragment.fragment_id] = fragment.cooldown_until
            ? Date.parse(fragment.cooldown_until)
            : 0;
          next.fragmentMiningUntil[fragment.fragment_id] = fragment.core_mining_until
            ? Date.parse(fragment.core_mining_until)
            : 0;
          next.coreMiningUntil = Math.max(
            next.coreMiningUntil,
            next.fragmentMiningUntil[fragment.fragment_id],
          );
        }
        return next;
      });
    }).catch((error) => {
      console.error('Trusted fragment state load failed:', error);
      if (!cancelled) {
        setState((previous) => ({
          ...previous,
          fragments: Object.fromEntries(
            FRAGMENT_IDS.map((id) => [id, 'locked']),
          ) as GameState['fragments'],
          fragmentCooldowns: Object.fromEntries(
            FRAGMENT_IDS.map((id) => [id, 0]),
          ) as GameState['fragmentCooldowns'],
          fragmentMiningUntil: Object.fromEntries(
            FRAGMENT_IDS.map((id) => [id, 0]),
          ) as GameState['fragmentMiningUntil'],
          coreMiningUntil: 0,
        }));
      }
    });

    return () => { cancelled = true; };
  }, [playerId, isLoading]);

  // Refresh trusted Fragment timers after admin pause/resume and server-side changes.
  useEffect(() => {
    if (isLoading) return;
    const interval = window.setInterval(() => {
      void applyTrustedFragments().catch((error) => {
        console.error('Trusted Fragment refresh failed:', error);
      });
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [playerId, isLoading, applyTrustedFragments]);

  // Temporary mining rewards are also server-sourced and fail closed.
  useEffect(() => {
    if (isLoading) return;
    let cancelled = false;

    const syncTemporaryRewards = async () => {
      try {
        const rewards = await fetchActiveTemporaryRewards();
        if (cancelled) return;
        setState((previous) => gameReducer(previous, {
          type: 'setTemporaryRewards',
          ...rewards,
          now: Date.now(),
        }));
      } catch (error) {
        console.error('Temporary reward sync failed:', error);
        if (!cancelled) {
          setState((previous) => gameReducer(previous, {
            type: 'setTemporaryRewards',
            agentUntil: 0,
            fragmentBoostUntil: 0,
            fragmentBoostMultiplier: 1,
            now: Date.now(),
          }));
        }
      }
    };

    void syncTemporaryRewards();
    const interval = window.setInterval(() => void syncTemporaryRewards(), 15000);
    window.addEventListener('focus', syncTemporaryRewards);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', syncTemporaryRewards);
    };
  }, [playerId, isLoading]);

  // Refresh countdowns without running the legacy client-side ZP accrual reducer.
  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!referralCode || isLoading) return;
    setState((previous) => gameReducer(previous, {
      type: 'setReferralCode',
      referralCode,
      now: Date.now(),
    }));
  }, [referralCode, isLoading]);

  return {
    state,
    isLoading,
    clockNow,
    trustedGameplay,
  };
}
