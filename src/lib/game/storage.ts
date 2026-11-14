import { advance, createInitialState } from './state';
import type { GameState } from './state';

function getStorageKey(playerId: string): string {
  return `zord-agent-state-v1:${playerId}`;
}

export function restoreGameState(
  value: unknown,
  now: number,
  referralCode: string | null,
): GameState {
  const fresh = createInitialState(now, referralCode ?? undefined);

  if (!value || typeof value !== 'object') {
    return fresh;
  }

  const parsed = value as Partial<GameState>;

  if (
    typeof parsed.zp !== 'number' ||
    !Number.isFinite(parsed.zp) ||
    typeof parsed.lifetimeZp !== 'number' ||
    !Number.isFinite(parsed.lifetimeZp) ||
    typeof parsed.lastTick !== 'number' ||
    !Number.isFinite(parsed.lastTick)
  ) {
    return fresh;
  }

  const merged: GameState = {
    ...fresh,
    ...parsed,
    // Temporary reward timers are restored only from the authenticated server,
    // never from localStorage or the client-controlled cloud game save.
    temporaryAgentUntil: 0,
    fragmentMiningBoostUntil: 0,
    fragmentMiningBoostMultiplier: 1,

    referralCode:
      referralCode ?? parsed.referralCode ?? fresh.referralCode,

    fragments: {
      ...fresh.fragments,
      ...(parsed.fragments ?? {}),
    },

    fragmentCooldowns: {
      ...fresh.fragmentCooldowns,
      ...(parsed.fragmentCooldowns ?? {}),
    },

    agents: {
      ...fresh.agents,
      ...(parsed.agents ?? {}),
    },

    adsWatched: {
      ...fresh.adsWatched,
      ...(parsed.adsWatched ?? {}),
    },

    wallet: {
      ...fresh.wallet,
      ...(parsed.wallet ?? {}),
    },

    subNodes: Array.isArray(parsed.subNodes)
      ? parsed.subNodes
      : [],

    claimedMilestones: Array.isArray(parsed.claimedMilestones)
      ? parsed.claimedMilestones
      : [],

    missionClaims:
      parsed.missionClaims &&
      typeof parsed.missionClaims === 'object'
        ? parsed.missionClaims
        : {},
  };

  return advance(merged, now);
}

export function loadState(
  now: number,
  referralCode: string | null,
  playerId: string,
): GameState {
  const fresh = createInitialState(now, referralCode ?? undefined);

  if (!playerId) return fresh;

  try {
    const raw = window.localStorage.getItem(getStorageKey(playerId));

    if (!raw) return fresh;

    return restoreGameState(
      JSON.parse(raw),
      now,
      referralCode,
    );
  } catch {
    return fresh;
  }
}

export function saveState(
  state: GameState,
  playerId: string,
): void {
  if (!playerId) return;

  try {
    const {
      temporaryAgentUntil: _temporaryAgentUntil,
      fragmentMiningBoostUntil: _fragmentMiningBoostUntil,
      fragmentMiningBoostMultiplier: _fragmentMiningBoostMultiplier,
      ...persistedState
    } = state;
    void _temporaryAgentUntil;
    void _fragmentMiningBoostUntil;
    void _fragmentMiningBoostMultiplier;
    window.localStorage.setItem(
      getStorageKey(playerId),
      JSON.stringify(persistedState),
    );
  } catch {
    // Local storage may be unavailable or full.
  }
}

/** Remove server-owned reward timers before writing the client game snapshot. */
export function persistableGameState(state: GameState): Omit<GameState, 'temporaryAgentUntil' | 'fragmentMiningBoostUntil' | 'fragmentMiningBoostMultiplier'> {
  const { temporaryAgentUntil: _agent, fragmentMiningBoostUntil: _boost, fragmentMiningBoostMultiplier: _multiplier, ...persisted } = state;
  void _agent;
  void _boost;
  void _multiplier;
  return persisted;
}
