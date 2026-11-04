import { advance, createInitialState } from './state';
import type { GameState } from './state';

const STORAGE_KEY = 'zord-agent-state-v1';

export function loadState(now: number): GameState {
  const fresh = createInitialState(now);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fresh;
    const parsed = JSON.parse(raw) as Partial<GameState>;
    if (typeof parsed.iq !== 'number' || typeof parsed.lifetimeIq !== 'number' || typeof parsed.lastTick !== 'number') {
      return fresh;
    }
    const merged: GameState = {
      ...fresh,
      ...parsed,
      fragments: { ...fresh.fragments, ...parsed.fragments },
      fragmentCooldowns: { ...fresh.fragmentCooldowns, ...parsed.fragmentCooldowns },
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

export function saveState(state: GameState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable or full; the session still works without persistence.
  }
}
