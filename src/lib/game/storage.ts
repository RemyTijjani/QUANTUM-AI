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
    window.localStorage.setItem(
      getStorageKey(playerId),
      JSON.stringify(state),
    );
  } catch {
    // Local storage may be unavailable or full.
  }
}
