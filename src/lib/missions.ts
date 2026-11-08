import { supabase } from '@/lib/supabase';
import type { MissionKind, MissionSpec } from '@/lib/game/config';

interface MissionTaskRow {
  id: string;
  kind: MissionKind;
  title: string;
  description: string;
  reward: number;
  platform: 'tiktok' | 'youtube' | null;
  action_url: string | null;
}

const MISSION_KINDS: MissionKind[] = ['daily', 'social', 'creator'];

export const FALLBACK_MISSIONS: MissionSpec[] = [
  { id: 'daily-uplink', kind: 'daily', title: 'Daily Uplink', description: 'Check in with ZORD OS for today.', reward: 100 },
  { id: 'ad-quota', kind: 'daily', title: 'Ad Feed Quota', description: 'Watch 3 interstitial feeds today.', reward: 150 },
  { id: 'agent-uptime', kind: 'daily', title: 'Agent Uptime', description: 'Keep a ZORD agent running.', reward: 200 },
  {
    id: 'join-intel',
    kind: 'social',
    title: 'Join the ZORD Intel Channel',
    description: 'Get field reports from the grid.',
    reward: 250,
    actionUrl: 'https://t.me/zord_intel',
  },
  {
    id: 'follow-signal',
    kind: 'social',
    title: 'Follow the Signal Feed',
    description: 'Catch every fragment drop as it breaks.',
    reward: 250,
    actionUrl: 'https://x.com/zord_agent',
  },
  { id: 'share-uplink', kind: 'social', title: 'Broadcast Your Uplink', description: 'Send your referral link to another operative.', reward: 300 },
  {
    id: 'creator-tiktok',
    kind: 'creator',
    title: 'TikTok Content Drop',
    description: 'Submit a TikTok link featuring ZORD Autonomous Agent.',
    reward: 500,
    platform: 'tiktok',
  },
  {
    id: 'creator-youtube',
    kind: 'creator',
    title: 'YouTube Content Drop',
    description: 'Submit a YouTube link featuring ZORD Autonomous Agent.',
    reward: 500,
    platform: 'youtube',
  },
];

export async function fetchMissions(): Promise<MissionSpec[]> {
  try {
    const { data, error } = await supabase
      .from('mission_tasks')
      .select('id, kind, title, description, reward, platform, action_url')
      .order('created_at', { ascending: true });

    if (error || !Array.isArray(data) || data.length === 0) return FALLBACK_MISSIONS;

    const rows = data as MissionTaskRow[];
    if (rows.some((row) => !MISSION_KINDS.includes(row.kind))) return FALLBACK_MISSIONS;

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      description: row.description,
      reward: row.reward,
      platform: row.platform ?? undefined,
      actionUrl: row.action_url ?? undefined,
    }));
  } catch (err) {
    console.warn('Mission list unavailable, showing built-in missions.', err);
    return FALLBACK_MISSIONS;
  }
}
