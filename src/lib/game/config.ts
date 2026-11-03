export const TIER_SIZE = 2500;

export const RANKS = [
  'Initiate',
  'Runner',
  'Ghost',
  'Cipher',
  'Architect',
  'Overseer',
  'Phantom',
  'Singularity',
] as const;

export const FRAGMENT_IDS = ['top', 'bottom', 'left', 'right'] as const;
export type FragmentId = (typeof FRAGMENT_IDS)[number];

export const FRAGMENT_NAMES: Record<FragmentId, string> = {
  top: 'Shield',
  bottom: 'Capacitor',
  left: 'Processor',
  right: 'Atom',
};

export const FRAGMENT_UNLOCK_REWARD = 50;
export const CORE_BASE_RATE = 0.01;
export const FRAGMENT_IQ_PER_SEC = 0.02;
export const FRAGMENT_COOLDOWN_HOURS = 3;
export const FRAGMENT_COOLDOWN_MS = FRAGMENT_COOLDOWN_HOURS * 60 * 60 * 1000;
export const CORE_SESSION_HOURS = 4;
export const AD_MIN_SECONDS = 3;
export const AD_MAX_SECONDS = 5;

export const AGENT_IDS = ['alpha', 'overclock'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export interface AgentSpec {
  name: string;
  summary: string;
  iqPerSec: number;
  priceTon: number;
  durationDays: number;
  kickbackMultiplier: number;
}

export const AGENTS: Record<AgentId, AgentSpec> = {
  alpha: {
    name: 'Alpha Miner Agent',
    summary: 'Autonomous offline mining rig that keeps extracting IQ while you are away.',
    iqPerSec: 10,
    priceTon: 1.5,
    durationDays: 7,
    kickbackMultiplier: 1,
  },
  overclock: {
    name: 'Overclocked Core Agent',
    summary: 'Max-clock hash core that triples the network kickback on every sub-node.',
    iqPerSec: 35,
    priceTon: 4.5,
    durationDays: 30,
    kickbackMultiplier: 3,
  },
};

export const MYSTERY_FRAGMENT_COST = 300;
export const BOOSTER_COST = 200;
export const BOOSTER_REWARD = 500;

export const SUB_NODE_RATE = 2;
export const KICKBACK_RATE = 0.1;

export const MILESTONES = [
  { threshold: 3, reward: 500 },
  { threshold: 10, reward: 2000 },
  { threshold: 25, reward: 5000 },
] as const;

export type MissionKind = 'daily' | 'social';

export interface MissionSpec {
  id: string;
  kind: MissionKind;
  title: string;
  description: string;
  reward: number;
}

export const AD_QUOTA_TARGET = 3;

export const MISSIONS: MissionSpec[] = [
  {
    id: 'daily-uplink',
    kind: 'daily',
    title: 'Daily Uplink',
    description: 'Check in with ROKO OS for today.',
    reward: 100,
  },
  {
    id: 'ad-quota',
    kind: 'daily',
    title: 'Ad Feed Quota',
    description: `Watch ${AD_QUOTA_TARGET} interstitial feeds today.`,
    reward: 150,
  },
  {
    id: 'agent-uptime',
    kind: 'daily',
    title: 'Agent Uptime',
    description: 'Keep a hash-agent rental running.',
    reward: 200,
  },
  {
    id: 'join-intel',
    kind: 'social',
    title: 'Join the Roko Intel Channel',
    description: 'Get field reports from the grid.',
    reward: 250,
  },
  {
    id: 'follow-signal',
    kind: 'social',
    title: 'Follow the Signal Feed',
    description: 'Catch every fragment drop as it breaks.',
    reward: 250,
  },
  {
    id: 'share-uplink',
    kind: 'social',
    title: 'Broadcast Your Uplink',
    description: 'Send your referral link to another operative.',
    reward: 300,
  },
];

export const RIVALS = [
  { name: 'NEON_WRAITH', iq: 184200 },
  { name: 'GHOST//KERNEL', iq: 142950 },
  { name: 'VOID_SPLICER', iq: 97410 },
  { name: 'PIXEL_MONK', iq: 61230 },
  { name: 'CIPHER_OWL', iq: 38775 },
  { name: 'BYTE_HERALD', iq: 21090 },
  { name: 'SIGNAL_RAVEN', iq: 9640 },
];

export const RECRUIT_POOL = [
  'SHARD_NOVA',
  'LOOP_KITE',
  'NULL_ORCHID',
  'DATA_MOTH',
  'RIFT_BISHOP',
  'ZERO_LATCH',
  'ECHO_PYLON',
  'HEX_LANTERN',
];

export const TON_FAUCET_AMOUNT = 10;
export const VAULT_ADDRESS = 'EQC1Z9kR4mW2pX7vN8qT3yL6hB5dJ0sF7x9W';
export const TELEGRAM_BOT_USERNAME = 'roko_os_bot';
