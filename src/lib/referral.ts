import { supabase } from './supabase';

export interface ReferralRecord {
  id: string;
  referrer_code: string;
  recruit_code: string;
  recruit_name: string;
  synced: boolean;
  created_at: string;
}

/**
 * Extracts the referrer's referral code from the Telegram startapp parameter.
 * Telegram passes it as `tgWebAppStartParam` in the URL hash or query string.
 */
export function getReferrerCodeFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.hash.slice(1));
    let startParam = params.get('tgWebAppStartParam');

    if (!startParam) {
      const query = new URLSearchParams(window.location.search);
      startParam = query.get('startapp') ?? query.get('tgWebAppStartParam') ?? undefined;
    }

    if (!startParam) return null;
    const code = startParam.trim().toUpperCase();
    return code.startsWith('ZORD-') ? code : null;
  } catch {
    return null;
  }
}

const REGISTERED_KEY = 'zord-referral-registered';

/**
 * Registers the current player as a recruit under the referrer, if:
 * - there is a referrer code in the URL
 * - it differs from the player's own code (no self-referral)
 * - this device hasn't already registered a referral
 *
 * Now resolves the referrer's player ID from the database and links the
 * referral record to both the referrer and the authenticated recruit.
 */
export async function registerReferral(myCode: string): Promise<void> {
  const referrerCode = getReferrerCodeFromUrl();
  if (!referrerCode || referrerCode === myCode) return;

  if (window.localStorage.getItem(REGISTERED_KEY)) return;

  const recruitName = generateRecruitName();

  const { data: referrer } = await supabase
    .from('player_referrals')
    .select('id')
    .eq('referral_code', referrerCode)
    .maybeSingle();

  const { error } = await supabase.from('referral_sub_nodes').insert({
    referrer_code: referrerCode,
    referrer_id: referrer?.id ?? null,
    recruit_code: myCode,
    recruit_name: recruitName,
    synced: false,
  });

  if (!error) {
    window.localStorage.setItem(REGISTERED_KEY, '1');
  }
}

/**
 * Polls for new unsynced referrals where the current player is the referrer.
 * Returns the unprocessed referral records (not yet synced).
 */
export async function fetchUnsyncedReferrals(myCode: string): Promise<ReferralRecord[]> {
  const { data, error } = await supabase
    .from('referral_sub_nodes')
    .select('id, referrer_code, recruit_code, recruit_name, synced, created_at')
    .eq('referrer_code', myCode)
    .eq('synced', false);

  if (error || !data) return [];
  return data as ReferralRecord[];
}

/**
 * Marks referral records as synced after the referrer has pulled them into local state.
 */
export async function markReferralsSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await supabase.from('referral_sub_nodes').update({ synced: true }).in('id', ids);
}

const NAME_PREFIXES = ['SHARD', 'LOOP', 'NULL', 'DATA', 'RIFT', 'ZERO', 'ECHO', 'HEX', 'CIPHER', 'VOID'];
const NAME_SUFFIXES = ['NOVA', 'KITE', 'ORCHID', 'MOTH', 'BISHOP', 'LATCH', 'PYLON', 'LANTERN', 'RAVEN', 'WRAITH'];

function generateRecruitName(): string {
  const prefix = NAME_PREFIXES[Math.floor(Math.random() * NAME_PREFIXES.length)];
  const suffix = NAME_SUFFIXES[Math.floor(Math.random() * NAME_SUFFIXES.length)];
  return `${prefix}_${suffix}`;
}
