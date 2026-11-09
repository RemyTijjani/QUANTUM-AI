import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { supabase } from '@/lib/supabase';

import { gameReducer } from '@/lib/game/state';
import type { Command, GameState } from '@/lib/game/state';

import {
  loadState,
  saveState,
  restoreGameState,
} from '@/lib/game/storage';

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

    buyBooster: () =>
      send({ type: 'buyBooster' }),

    rentAgent: (id: AgentId) =>
      send({ type: 'rentAgent', id }),

    connectWallet: () =>
      send({ type: 'connectWallet' }),

    disconnectWallet: () =>
      send({ type: 'disconnectWallet' }),

    claimKickback: () =>
      send({ type: 'claimKickback' }),

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

interface CloudSave {
  game_state: unknown;
  version: number;
}

export function useGame(
  referralCode: string | null,
  playerId: string,
): {
  state: GameState;
  actions: GameActions;
  isLoading: boolean;
  loadError: string | null;
  syncError: string | null;
  retryLoad: () => void;
} {
  const [state, setState] = useState<GameState>(() =>
    loadState(Date.now(), referralCode, playerId),
  );

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const versionRef = useRef(0);
  const savingRef = useRef(false);

  const dispatch = useCallback((command: Command) => {
    setState((current) =>
      gameReducer(current, {
        ...command,
        now: Date.now(),
      }),
    );
  }, []);

  const retryLoad = useCallback(() => {
    setLoadAttempt((current) => current + 1);
  }, []);

  // Load the cloud save before allowing the game to operate.
  useEffect(() => {
    let cancelled = false;

    async function loadCloudState() {
      setIsLoading(true);
      setLoadError(null);
      setSyncError(null);

      try {
        const { data, error } = await supabase
          .from('player_game_states')
          .select('game_state, version')
          .eq('player_id', playerId)
          .maybeSingle();

        if (error) throw error;
        if (cancelled) return;

        // A cloud save already exists.
        if (data) {
          const cloudSave = data as CloudSave;

          const restored = restoreGameState(
            cloudSave.game_state,
            Date.now(),
            referralCode,
          );

          versionRef.current = Number(cloudSave.version);

          setState(restored);
          setIsLoading(false);

          return;
        }

        // No cloud save exists.
        // Migrate this player's existing local progress.
        const localState = loadState(
          Date.now(),
          referralCode,
          playerId,
        );

        if (cancelled) return;

        const { data: newVersion, error: saveError } =
          await supabase.rpc('save_player_game_state', {
            p_state: localState,
            p_expected_version: 0,
          });

        if (cancelled) return;

        if (!saveError) {
          versionRef.current = Number(newVersion);
          setState(localState);
          setIsLoading(false);
          return;
        }

        // Another device may have created the first save
        // at the same time. Load that save instead.
        const { data: latest, error: latestError } =
          await supabase
            .from('player_game_states')
            .select('game_state, version')
            .eq('player_id', playerId)
            .maybeSingle();

        if (latestError) throw latestError;

        if (latest) {
          const cloudSave = latest as CloudSave;

          versionRef.current = Number(cloudSave.version);

          setState(
            restoreGameState(
              cloudSave.game_state,
              Date.now(),
              referralCode,
            ),
          );

          setIsLoading(false);
          return;
        }

        throw saveError;
      } catch (error) {
        console.error('Cloud game loading failed:', error);

        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Could not load your cloud game save.',
          );

          setIsLoading(false);
        }
      }
    }

    void loadCloudState();

    return () => {
      cancelled = true;
    };
  }, [playerId, loadAttempt]);

  // Keep a local backup and save changes to the cloud.
  // The delay prevents a network request every second.
  useEffect(() => {
    if (isLoading || loadError) return;

    saveState(state, playerId);

    const timeout = window.setTimeout(async () => {
      if (savingRef.current) return;

      savingRef.current = true;

      try {
        const { data, error } = await supabase.rpc(
          'save_player_game_state',
          {
            p_state: state,
            p_expected_version: versionRef.current,
          },
        );

        if (error) {
          if (
            error.message.includes('GAME_STATE_VERSION_CONFLICT')
          ) {
            // Another device saved a newer version.
            // Load that version rather than overwriting it.
            const { data: latest, error: latestError } =
              await supabase
                .from('player_game_states')
                .select('game_state, version')
                .eq('player_id', playerId)
                .maybeSingle();

            if (latestError) throw latestError;

            if (latest) {
              const cloudSave = latest as CloudSave;

              versionRef.current = Number(cloudSave.version);

              setState(
                restoreGameState(
                  cloudSave.game_state,
                  Date.now(),
                  referralCode,
                ),
              );

              setSyncError(
                'Your game was updated on another device. The latest cloud save has been loaded.',
              );

              return;
            }
          }

          throw error;
        }

        versionRef.current = Number(data);
        setSyncError(null);
      } catch (error) {
        console.error('Cloud game saving failed:', error);

        setSyncError(
          error instanceof Error
            ? error.message
            : 'Could not synchronize your game progress.',
        );
      } finally {
        savingRef.current = false;
      }
    }, 3000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [state, playerId, referralCode, isLoading, loadError]);

  // Update game time every second.
  useEffect(() => {
    const id = window.setInterval(() => {
      dispatch({ type: 'tick' });
    }, 1000);

    return () => window.clearInterval(id);
  }, [dispatch]);

  const actions = useMemo(
    () => createActions(dispatch),
    [dispatch],
  );

  // Keep the current referral code in the game state.
  useEffect(() => {
    if (!referralCode || isLoading || loadError) return;

    dispatch({
      type: 'setReferralCode',
      referralCode,
    });
  }, [referralCode, isLoading, loadError, dispatch]);

  // Fetch all referrals, including previously synced records.
  useEffect(() => {
    if (!referralCode || isLoading || loadError) return;

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
  }, [referralCode, isLoading, loadError, dispatch]);

  return {
    state,
    actions,
    isLoading,
    loadError,
    syncError,
    retryLoad,
  };
}
