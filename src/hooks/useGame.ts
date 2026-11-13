import { useEffect, useMemo, useRef, useState } from 'react';

import { createInitialState, gameReducer } from '@/lib/game/state';
import type { Command, GameState } from '@/lib/game/state';

import {
  loadState,
  restoreGameState,
  saveState,
} from '@/lib/game/storage';

import type {
  AgentId,
  FragmentId,
  MissionSpec,
} from '@/lib/game/config';

import { fetchUnsyncedReferrals } from '@/lib/referral';
import { supabase } from '@/lib/supabase';

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

export function useGame(
  referralCode: string | null,
  playerId: string,
  isDemo = false,
): {
  state: GameState;
  actions: GameActions;
  isLoading: boolean;
  loadError: string | null;
  syncError: string | null;
  retryLoad: () => void;
} {
  const [state, setState] = useState<GameState>(() => {
    if (!isDemo) return loadState(Date.now(), referralCode, playerId);
    const now = Date.now();
    const initial = createInitialState(now, 'ZORD-DEMO');
    return {
      ...initial,
      zp: 4250,
      lifetimeZp: 18250,
      fragments: { top: 'fixed', bottom: 'unlocked', left: 'locked', right: 'locked' },
      fragmentCooldowns: { ...initial.fragmentCooldowns, top: now + 6 * 60 * 60 * 1000 },
      agents: { alpha: now + 2 * 86400000, overclock: 0 },
      wallet: { connected: true, faucetClaimed: true, tonBalance: 5.5 },
      subNodes: [
        { id: 'ZORD-ALLY-01', name: 'Demo Operative 01', joinedAt: now - 5 * 86400000, generated: 840 },
        { id: 'ZORD-ALLY-02', name: 'Demo Operative 02', joinedAt: now - 2 * 86400000, generated: 320 },
      ],
    };
  });

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const stateRef = useRef(state);
  const versionRef = useRef(0);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const skipNextDirtyRef = useRef(false);

  // Always keep the latest game state available to the cloud saver.
  stateRef.current = state;

  const retryLoad = () => {
    setLoadAttempt((attempt) => attempt + 1);
  };

  // Load the player's game from Supabase.
  // If no cloud save exists, migrate their existing local save.
  useEffect(() => {
    let cancelled = false;

    async function loadCloudState() {
      setIsLoading(true);
      if (isDemo) {
        const now = Date.now();
        const initial = createInitialState(now, 'ZORD-DEMO');
        setState({
          ...initial,
          zp: 4250,
          lifetimeZp: 18250,
          fragments: { top: 'fixed', bottom: 'unlocked', left: 'locked', right: 'locked' },
          fragmentCooldowns: { ...initial.fragmentCooldowns, top: now + 6 * 60 * 60 * 1000 },
          agents: { alpha: now + 2 * 86400000, overclock: 0 },
          wallet: { connected: true, faucetClaimed: true, tonBalance: 5.5 },
          subNodes: [
            { id: 'ZORD-ALLY-01', name: 'Demo Operative 01', joinedAt: now - 5 * 86400000, generated: 840 },
            { id: 'ZORD-ALLY-02', name: 'Demo Operative 02', joinedAt: now - 2 * 86400000, generated: 320 },
          ],
        });
        setIsLoading(false);
        return;
      }
      setLoadError(null);
      setSyncError(null);

      versionRef.current = 0;
      dirtyRef.current = false;
      savingRef.current = false;

      try {
        const { data, error } = await supabase
          .from('player_game_states')
          .select('game_state, version')
          .eq('player_id', playerId)
          .maybeSingle();

        if (error) {
          throw error;
        }

        if (cancelled) return;

        // A cloud save already exists.
        if (data) {
          const restored = restoreGameState(
            data.game_state,
            Date.now(),
            referralCode,
          );

          versionRef.current = Number(data.version);

          skipNextDirtyRef.current = true;
          setState(restored);

          return;
        }

        // No cloud save exists yet.
        // Use the player's existing device save for the first upload.
        const localState = loadState(
          Date.now(),
          referralCode,
          playerId,
        );

        const { data: newVersion, error: saveError } =
          await supabase.rpc('save_player_game_state', {
            p_state: localState,
            p_expected_version: 0,
          });

        if (cancelled) return;

        if (!saveError) {
          versionRef.current = Number(newVersion);

          skipNextDirtyRef.current = true;
          setState(localState);

          return;
        }

        // Another device may have created the first cloud save
        // at the same time. Load that existing save instead.
        if (
          saveError.message?.includes(
            'GAME_STATE_VERSION_CONFLICT',
          )
        ) {
          const { data: latest, error: latestError } =
            await supabase
              .from('player_game_states')
              .select('game_state, version')
              .eq('player_id', playerId)
              .maybeSingle();

          if (cancelled) return;

          if (latestError) {
            throw latestError;
          }

          if (!latest) {
            throw new Error(
              'The cloud save could not be found after a version conflict.',
            );
          }

          versionRef.current = Number(latest.version);

          skipNextDirtyRef.current = true;
          setState(
            restoreGameState(
              latest.game_state,
              Date.now(),
              referralCode,
            ),
          );

          return;
        }

        throw saveError;
      } catch (error) {
        if (cancelled) return;

        console.error('Cloud game loading failed:', error);

        setLoadError(
          error instanceof Error
            ? error.message
            : 'Could not load your cloud game.',
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadCloudState();

    return () => {
      cancelled = true;
    };
  }, [playerId, referralCode, loadAttempt, isDemo]);

  // Save locally immediately whenever the game changes.
  // Mark the game as needing a cloud save.
  useEffect(() => {
    if (isLoading || loadError || isDemo) return;

    saveState(state, playerId);

    if (skipNextDirtyRef.current) {
      skipNextDirtyRef.current = false;
      return;
    }

    dirtyRef.current = true;
  }, [state, playerId, isLoading, loadError, isDemo]);

  // Upload changed game state to Supabase every 5 seconds.
  // This interval does not restart when the game ticks every second.
  useEffect(() => {
    if (isLoading || loadError || isDemo) return;

    let cancelled = false;

    async function syncToCloud() {
      if (cancelled || savingRef.current || !dirtyRef.current) {
        return;
      }

      savingRef.current = true;

      const snapshot = stateRef.current;
      dirtyRef.current = false;

      try {
        const { data, error } = await supabase.rpc(
          'save_player_game_state',
          {
            p_state: snapshot,
            p_expected_version: versionRef.current,
          },
        );

        if (cancelled) return;

        if (error) {
          // A different device saved a newer version.
          if (
            error.message?.includes(
              'GAME_STATE_VERSION_CONFLICT',
            )
          ) {
            const { data: latest, error: latestError } =
              await supabase
                .from('player_game_states')
                .select('game_state, version')
                .eq('player_id', playerId)
                .maybeSingle();

            if (cancelled) return;

            if (latestError) {
              throw latestError;
            }

            if (!latest) {
              throw new Error(
                'Could not retrieve the latest cloud save.',
              );
            }

            versionRef.current = Number(latest.version);

            // Use the newer cloud version rather than overwriting it.
            skipNextDirtyRef.current = true;

            setState(
              restoreGameState(
                latest.game_state,
                Date.now(),
                referralCode,
              ),
            );

            setSyncError(
              'Your game was updated on another device. The latest cloud save has been loaded.',
            );

            return;
          }

          throw error;
        }

        versionRef.current = Number(data);

        // If the game changed while the upload was running,
        // another upload will still be needed.
        if (stateRef.current !== snapshot) {
          dirtyRef.current = true;
        }

        setSyncError(null);
      } catch (error) {
        if (cancelled) return;

        console.error('Cloud game sync failed:', error);

        dirtyRef.current = true;

        setSyncError(
          error instanceof Error
            ? error.message
            : 'Could not sync your game to the cloud.',
        );
      } finally {
        savingRef.current = false;
      }
    }

    const interval = window.setInterval(() => {
      void syncToCloud();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [playerId, referralCode, isLoading, loadError, isDemo]);

  // Game timer.
  useEffect(() => {
    const interval = window.setInterval(() => {
      setState((previous) =>
        gameReducer(previous, {
          type: 'tick',
          now: Date.now(),
        }),
      );
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  // Game actions.
  const actions = useMemo(
    () =>
      createActions((command) => {
        setState((previous) =>
          gameReducer(previous, {
            ...command,
            now: Date.now(),
          }),
        );
      }),
    [],
  );

  // Keep the player's referral code updated.
  useEffect(() => {
    if (isDemo || !referralCode || isLoading || loadError) return;

    setState((previous) =>
      gameReducer(previous, {
        type: 'setReferralCode',
        referralCode,
        now: Date.now(),
      }),
    );
  }, [referralCode, isLoading, loadError, isDemo]);

  // Keep referral recruits synchronized.
  useEffect(() => {
    if (isDemo || !referralCode || isLoading || loadError) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const records = await fetchUnsyncedReferrals(referralCode);

        if (cancelled || records.length === 0) return;

        for (const record of records) {
          if (cancelled) return;

          setState((previous) =>
            gameReducer(previous, {
              type: 'recruitSubNode',
              id: record.recruit_code,
              name: record.recruit_name,
              now: Date.now(),
            }),
          );
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
  }, [referralCode, isLoading, loadError, isDemo]);

  return {
    state,
    actions,
    isLoading,
    loadError,
    syncError,
    retryLoad,
  };
}
