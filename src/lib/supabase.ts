import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export interface CreatorOpsSubmission {
  id: string;
  mission_id: string;
  player_referral_code: string;
  link_url: string;
  platform: 'tiktok' | 'youtube';
  status: 'pending' | 'approved' | 'rejected';
  reward_zp: number;
  reviewed_at: string | null;
  created_at: string;
}

export interface XFollowSubmission {
  id: string; player_id: string; x_username: string;
  status: 'pending' | 'approved' | 'rejected'; reward_zp: number; created_at: string;
  players?: { referral_code: string | null; username: string | null; first_name: string | null };
}
