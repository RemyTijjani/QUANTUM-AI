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

export async function fetchMissions(): Promise<MissionSpec[]> {
  if (import.meta.env.DEV) {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return [];
  }

  const { data, error } = await supabase
    .from('mission_tasks')
    .select('id, kind, title, description, reward, platform, action_url')
    .order('created_at', { ascending: true });

  if (error || !Array.isArray(data)) {
    throw new Error('Could not load missions.');
  }

  return (data as MissionTaskRow[]).map((row) => {
    if (!MISSION_KINDS.includes(row.kind)) throw new Error('Received an unexpected mission.');
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      description: row.description,
      reward: row.reward,
      platform: row.platform ?? undefined,
      actionUrl: row.action_url ?? undefined,
    };
  });
}
