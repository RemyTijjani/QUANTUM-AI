import {
  AD_QUOTA_TARGET,
  AGENT_IDS,
  AGENTS,
  BOOSTER_COST,
  BOOSTER_REWARD,
  CORE_BASE_RATE,
  FRAGMENT_COOLDOWN_MS,
  FRAGMENT_IQ_PER_SEC,
  CORE_SESSION_HOURS,
  FRAGMENT_IDS,
  FRAGMENT_UNLOCK_REWARD,
  KICKBACK_RATE,
  MILESTONES,
  MISSIONS,
  MYSTERY_FRAGMENT_COST,
  RANKS,
  SUB_NODE_RATE,
  TIER_SIZE,
  TON_FAUCET_AMOUNT,
} from './config';
import type { AgentId, FragmentId, MissionSpec } from './config';
import { dayKey } from '@/lib/format';

const DAY_MS = 24 * 60 * 60 * 1000;
const CORE_SESSION_MS = CORE_SESSION_HOURS * 60 * 60 * 1000;

export type FragmentStatus = 'locked' | 'unlocked' | 'fixed';

export interface SubNode {
  id: string;
  name: string;
  joinedAt: number;
  generated: number;
}

export interface WalletState {
  connected: boolean;
  faucetClaimed: boolean;
  tonBalance: number;
}

export interface GameState {
  iq: number;
  lifetimeIq: number;
  fragments: Record<FragmentId, FragmentStatus>;
  fragmentCooldowns: Record<FragmentId, number>;
  agents: Record<AgentId, number>;
  kickbackPending: number;
  subNodes: SubNode[];
  claimedMilestones: number[];
  missionClaims: Record<string, string>;
  adsWatched: { day: string; count: number };
  wallet: WalletState;
  referralCode: string;
  coreMiningUntil: number;
  lastTick: number;
}

export type Command =
  | { type: 'tick' }
  | { type: 'reset' }
  | { type: 'unlockFragment'; id: FragmentId }
  | { type: 'fixFragment'; id: FragmentId }
  | { type: 'mysteryFragment'; id: FragmentId }
  | { type: 'buyBooster' }
  | { type: 'rentAgent'; id: AgentId }
  | { type: 'connectWallet' }
  | { type: 'disconnectWallet' }
  | { type: 'claimKickback' }
  | { type: 'claimMilestone'; threshold: number }
  | { type: 'recruitSubNode'; id: string; name: string }
  | { type: 'claimMission'; id: string };

export type GameAction = Command & { now: number };

const makeReferralCode = () => `ROKO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

export function createInitialState(now: number): GameState {
  return {
    iq: 0,
    lifetimeIq: 0,
    fragments: { top: 'locked', bottom: 'locked', left: 'locked', right: 'locked' },
    fragmentCooldowns: { top: 0, bottom: 0, left: 0, right: 0 },
    agents: { alpha: 0, overclock: 0 },
    kickbackPending: 0,
    subNodes: [],
    claimedMilestones: [],
    missionClaims: {},
    adsWatched: { day: dayKey(now), count: 0 },
    wallet: { connected: false, faucetClaimed: false, tonBalance: 0 },
    referralCode: makeReferralCode(),
    coreMiningUntil: 0,
    lastTick: now,
  };
}

export const fixedCount = (s: GameState) => FRAGMENT_IDS.filter((id) => s.fragments[id] === 'fixed').length;

export const activeAgents = (s: GameState, now: number) => AGENT_IDS.filter((id) => s.agents[id] > now);

export const isAgentActive = (s: GameState, id: AgentId, now: number) => s.agents[id] > now;

export const fragmentCooldownRemaining = (s: GameState, id: FragmentId, now: number) =>
  Math.max(0, s.fragmentCooldowns[id] - now);

export function passiveRate(s: GameState, now: number) {
  const coreRate = now < s.coreMiningUntil ? CORE_BASE_RATE : 0;
  const fragmentRate = fixedCount(s) * FRAGMENT_IQ_PER_SEC;
  const agentRate = activeAgents(s, now).reduce((sum, id) => sum + AGENTS[id].iqPerSec, 0);
  return coreRate + fragmentRate + agentRate;
}

function kickbackMultiplier(s: GameState, now: number) {
  return activeAgents(s, now).reduce((multiplier, id) => Math.max(multiplier, AGENTS[id].kickbackMultiplier), 1);
}

export const adsWatchedToday = (s: GameState, now: number) =>
  s.adsWatched.day === dayKey(now) ? s.adsWatched.count : 0;

export function tierInfo(lifetimeIq: number) {
  const tier = Math.floor(lifetimeIq / TIER_SIZE) + 1;
  const intoTier = lifetimeIq % TIER_SIZE;
  return {
    tier,
    rank: RANKS[Math.min(tier - 1, RANKS.length - 1)],
    progress: intoTier / TIER_SIZE,
    intoTier,
    toNext: TIER_SIZE - intoTier,
  };
}

const missionKey = (mission: MissionSpec, now: number) => (mission.kind === 'daily' ? dayKey(now) : 'done');

function isMissionReady(s: GameState, mission: MissionSpec, now: number) {
  switch (mission.id) {
    case 'ad-quota':
      return adsWatchedToday(s, now) >= AD_QUOTA_TARGET;
    case 'agent-uptime':
      return activeAgents(s, now).length > 0;
    default:
      return true;
  }
}

export function missionStatus(s: GameState, mission: MissionSpec, now: number): 'claimed' | 'ready' | 'locked' {
  if (s.missionClaims[mission.id] === missionKey(mission, now)) return 'claimed';
  return isMissionReady(s, mission, now) ? 'ready' : 'locked';
}

const roundTon = (value: number) => Math.round(value * 100) / 100;

const credit = (s: GameState, amount: number): GameState => ({
  ...s,
  iq: s.iq + amount,
  lifetimeIq: s.lifetimeIq + amount,
});

function accrue(s: GameState, seconds: number): GameState {
  if (seconds <= 0) return s;
  const passive = passiveRate(s, s.lastTick) * seconds;
  const hasSubNodes = s.subNodes.length > 0;
  const kickback = hasSubNodes
    ? s.subNodes.length * SUB_NODE_RATE * seconds * KICKBACK_RATE * kickbackMultiplier(s, s.lastTick)
    : 0;
  return {
    ...s,
    iq: s.iq + passive,
    lifetimeIq: s.lifetimeIq + passive,
    kickbackPending: s.kickbackPending + kickback,
    subNodes: hasSubNodes
      ? s.subNodes.map((node) => ({ ...node, generated: node.generated + SUB_NODE_RATE * seconds }))
      : s.subNodes,
  };
}

// Splits the elapsed time at agent and core session expiries so each segment uses the state that was active during it.
export function advance(s: GameState, now: number): GameState {
  if (now <= s.lastTick) return s;
  const expiries = [...AGENT_IDS.map((id) => s.agents[id]), s.coreMiningUntil].filter(
    (end) => end > s.lastTick && end < now,
  );
  const boundaries = [...expiries, now].sort((a, b) => a - b);
  let next = s;
  for (const end of boundaries) {
    next = { ...accrue(next, (end - next.lastTick) / 1000), lastTick: end };

  }
  return {
    ...next,
    fragments: FRAGMENT_IDS.reduce(
      (fragments, id) => ({
        ...fragments,
        [id]: fragments[id] === 'fixed' && next.fragmentCooldowns[id] <= now ? 'locked' : fragments[id],
      }),
      next.fragments,
    ),
  };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  const { now } = action;
  if (action.type === 'reset') return createInitialState(now);

  const s = advance(state, now);

  switch (action.type) {
    case 'tick':
      return s;

    case 'unlockFragment': {
      if (s.fragments[action.id] !== 'locked') return s;
      return credit(
        {
          ...s,
          fragments: { ...s.fragments, [action.id]: 'unlocked' },
          fragmentCooldowns: { ...s.fragmentCooldowns, [action.id]: 0 },
          adsWatched: { day: dayKey(now), count: adsWatchedToday(s, now) + 1 },
        },
        FRAGMENT_UNLOCK_REWARD,
      );
    }

    case 'fixFragment':
      if (s.fragments[action.id] !== 'unlocked' || fragmentCooldownRemaining(s, action.id, now) > 0) return s;
      return {
        ...s,
        fragments: { ...s.fragments, [action.id]: 'fixed' },
        fragmentCooldowns: { ...s.fragmentCooldowns, [action.id]: now + FRAGMENT_COOLDOWN_MS },
        coreMiningUntil: now + CORE_SESSION_MS,
      };

    case 'mysteryFragment':
      if (
        s.fragments[action.id] === 'fixed' ||
        fragmentCooldownRemaining(s, action.id, now) > 0 ||
        s.iq < MYSTERY_FRAGMENT_COST
      ) return s;
      return {
        ...s,
        iq: s.iq - MYSTERY_FRAGMENT_COST,
        fragments: { ...s.fragments, [action.id]: 'fixed' },
        fragmentCooldowns: { ...s.fragmentCooldowns, [action.id]: now + FRAGMENT_COOLDOWN_MS },
        coreMiningUntil: now + CORE_SESSION_MS,
      };

    case 'buyBooster':
      if (s.iq < BOOSTER_COST) return s;
      return credit({ ...s, iq: s.iq - BOOSTER_COST }, BOOSTER_REWARD);

    case 'rentAgent': {
      const spec = AGENTS[action.id];
      if (!s.wallet.connected || s.wallet.tonBalance < spec.priceTon) return s;
      const start = Math.max(now, s.agents[action.id]);
      return {
        ...s,
        wallet: { ...s.wallet, tonBalance: roundTon(s.wallet.tonBalance - spec.priceTon) },
        agents: { ...s.agents, [action.id]: start + spec.durationDays * DAY_MS },
      };
    }

    case 'connectWallet':
      if (s.wallet.connected) return s;
      return {
        ...s,
        wallet: {
          connected: true,
          faucetClaimed: true,
          tonBalance: s.wallet.faucetClaimed ? s.wallet.tonBalance : s.wallet.tonBalance + TON_FAUCET_AMOUNT,
        },
      };

    case 'disconnectWallet':
      return { ...s, wallet: { ...s.wallet, connected: false } };

    case 'claimKickback':
      if (s.kickbackPending <= 0) return s;
      return credit({ ...s, kickbackPending: 0 }, s.kickbackPending);

    case 'claimMilestone': {
      const milestone = MILESTONES.find((m) => m.threshold === action.threshold);
      if (!milestone || s.claimedMilestones.includes(milestone.threshold)) return s;
      if (s.subNodes.length < milestone.threshold) return s;
      return credit(
        { ...s, claimedMilestones: [...s.claimedMilestones, milestone.threshold] },
        milestone.reward,
      );
    }

    case 'recruitSubNode':
      return {
        ...s,
        subNodes: [...s.subNodes, { id: action.id, name: action.name, joinedAt: now, generated: 0 }],
      };

    case 'claimMission': {
      const mission = MISSIONS.find((m) => m.id === action.id);
      if (!mission || missionStatus(s, mission, now) !== 'ready') return s;
      return credit(
        { ...s, missionClaims: { ...s.missionClaims, [mission.id]: missionKey(mission, now) } },
        mission.reward,
      );
    }
  }
}
