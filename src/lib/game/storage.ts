import { advance, createInitialState } from './state';
import type { GameState } from './state';

function getStorageKey(playerId: string): string {
  return `zord-agent-state-v1:${playerId}`;
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

    const parsed = JSON.parse(raw) as Partial<GameState>;

    if (
      typeof parsed.zp !== 'number' ||
      typeof parsed.lifetimeZp !== 'number' ||
      typeof parsed.lastTick !== 'number'
    ) {
      return fresh;
    }

    const merged: GameState = {
      ...fresh,
      ...parsed,
      referralCode:
        referralCode ?? parsed.referralCode ?? fresh.referralCode,
      fragments: { ...fresh.fragments, ...parsed.fragments },
      fragmentCooldowns: {
        ...fresh.fragmentCooldowns,
        ...parsed.fragmentCooldowns,
      },
      agents: { ...fresh.agents, ...parsed.agents },
      adsWatched: { ...fresh.adsWatched, ...parsed.adsWatched },
      wallet: { ...fresh.wallet, ...parsed.wallet },
      subNodes: parsed.subNodes ?? [],
      claimedMilestones: parsed.claimedMilestones ?? [],
      missionClaims: parsed.missionClaims ?? {},
    };

    return advance(merged, now);
  } catch {
    return fresh;
  }
}

export function saveState(state: GameState, playerId: string): void {
  if (!playerId) return;

  try {
    window.localStorage.setItem(
      getStorageKey(playerId),
      JSON.stringify(state),
    );
  } catch {
    // Storage can be unavailable or full.
  }
}
