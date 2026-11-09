import { useEffect, useMemo, useReducer } from 'react';
import { gameReducer } from '@/lib/game/state';
import type { Command, GameState } from '@/lib/game/state';
import { loadState, saveState } from '@/lib/game/storage';
import type {
  AgentId,
  FragmentId,
  MissionSpec,
} from '@/lib/game/config';
import { fetchUnsyncedReferrals } from '@/lib/referral';

function createActions(send: (command: Command) => void) {
  return {
    unlockFragment: (id: FragmentId) =>
      send({ type: 'unlockFragment', id }),

    fixFragment: (id: FragmentId) =>
      send({ type: 'fixFragment', id }),

    mysteryFragment: (id: FragmentId) =>
      send({ type: 'mysteryFragment', id }),

    buyBooster: () => send({ type: 'buyBooster' }),

    rentAgent: (id: AgentId) =>
      send({ type: 'rentAgent', id }),

    connectWallet: () => send({ type: 'connectWallet' }),

    disconnectWallet: () => send({ type: 'disconnectWallet' }),

    claimKickback: () => send({ type: 'claimKickback' }),

    claimMilestone: (threshold: number) =>
      send({ type: 'claimMilestone', threshold }),

    recruitSubNode: (id: string, name: string) =>
      send({ type: 'recruitSubNode', id, name }),

    claimMission: (mission: MissionSpec) =>
      send({ type: 'claimMission', mission }),

    creditZp: (amount: number) =>
      send({ type: 'creditZp', amount }),

    reset: (referralCode: string) =>
      send({ type: 'resetWithCode', referralCode }),
  };
}

export type GameActions = ReturnType<typeof createActions>;

export function useGame(
  referralCode: string | null,
  playerId: string,
): { state: GameState; actions: GameActions } {
  const [state, dispatch] = useReducer(
    gameReducer,
    { referralCode, playerId },
    ({ referralCode: code, playerId: id }) =>
      loadState(Date.now(), code, id),
  );

  // Save this player's game state under their unique storage key.
  useEffect(() => {
    saveState(state, playerId);
  }, [state, playerId]);

  // Update game time every second.
  useEffect(() => {
    const id = window.setInterval(() => {
      dispatch({ type: 'tick', now: Date.now() });
    }, 1000);

    return () => window.clearInterval(id);
  }, []);

  const actions = useMemo(
    () =>
      createActions((command) =>
        dispatch({ ...command, now: Date.now() }),
      ),
    [],
  );

  // Keep the current referral code in the game state.
  useEffect(() => {
    if (!referralCode) return;

    dispatch({
      type: 'setReferralCode',
      referralCode,
      now: Date.now(),
    });
  }, [referralCode]);

  // Fetch all referrals, including previously synced records.
  useEffect(() => {
    if (!referralCode) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const records =
          await fetchUnsyncedReferrals(referralCode);

        if (cancelled || records.length === 0) return;

        for (const record of records) {
          if (cancelled) return;

          dispatch({
            type: 'recruitSubNode',
            id: record.recruit_code,
            name: record.recruit_name,
            now: Date.now(),
          });
        }
      } catch (error) {
        console.error('Referral polling failed:', error);
      }
    };

    void poll();

    const interval = window.setInterval(() => {
      void poll();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [referralCode]);

  return { state, actions };
}
