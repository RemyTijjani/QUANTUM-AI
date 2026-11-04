import { useEffect, useMemo, useReducer } from 'react';
import { gameReducer } from '@/lib/game/state';
import type { Command, GameState } from '@/lib/game/state';
import { loadState, saveState } from '@/lib/game/storage';
import type { AgentId, FragmentId } from '@/lib/game/config';

function createActions(send: (command: Command) => void) {
  return {
    unlockFragment: (id: FragmentId) => send({ type: 'unlockFragment', id }),
    fixFragment: (id: FragmentId) => send({ type: 'fixFragment', id }),
    mysteryFragment: (id: FragmentId) => send({ type: 'mysteryFragment', id }),
    buyBooster: () => send({ type: 'buyBooster' }),
    rentAgent: (id: AgentId) => send({ type: 'rentAgent', id }),
    connectWallet: () => send({ type: 'connectWallet' }),
    disconnectWallet: () => send({ type: 'disconnectWallet' }),
    claimKickback: () => send({ type: 'claimKickback' }),
    claimMilestone: (threshold: number) => send({ type: 'claimMilestone', threshold }),
    recruitSubNode: (id: string, name: string) => send({ type: 'recruitSubNode', id, name }),
    claimMission: (id: string) => send({ type: 'claimMission', id }),
    creditIq: (amount: number) => send({ type: 'creditIq', amount }),
    reset: () => send({ type: 'reset' }),
  };
}

export type GameActions = ReturnType<typeof createActions>;

export function useGame(): { state: GameState; actions: GameActions } {
  const [state, dispatch] = useReducer(gameReducer, undefined, () => loadState(Date.now()));

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    const id = window.setInterval(() => dispatch({ type: 'tick', now: Date.now() }), 1000);
    return () => window.clearInterval(id);
  }, []);

  const actions = useMemo(
    () => createActions((command) => dispatch({ ...command, now: Date.now() })),
    [],
  );

  return { state, actions };
}
