import { supabase } from './supabase';
import {
  TELEGRAM_BOT_USERNAME,
  TELEGRAM_MINI_APP_SHORT_NAME,
} from './game/config';

const REFERRAL_PARAM_PREFIX = 'ref_';

export function buildReferralLink(referralCode: string): string {
  return `https://t.me/${TELEGRAM_BOT_USERNAME}/${TELEGRAM_MINI_APP_SHORT_NAME}?startapp=${REFERRAL_PARAM_PREFIX}${referralCode}`;
}

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
 */
export function getReferrerCodeFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.hash.slice(1));
    let startParam = params.get('tgWebAppStartParam');

    if (!startParam) {
      const query = new URLSearchParams(window.location.search);
      startParam =
        query.get('startapp') ??
        query.get('tgWebAppStartParam');
    }

    if (!startParam) return null;

    const code = startParam
      .trim()
      .replace(/^ref_/i, '')
      .toUpperCase();

    return code.startsWith('ZORD-') ? code : null;
  } catch {
    return null;
  }
}

const REGISTERED_KEY = 'zord-referral-registered';

/**
 * Registers the current player as a recruit under the referrer.
 */
export async function registerReferral(
  myCode: string,
): Promise<void> {
  const referrerCode = getReferrerCodeFromUrl();

  if (!referrerCode || referrerCode === myCode) return;

  if (window.localStorage.getItem(REGISTERED_KEY)) return;

  const recruitName = generateRecruitName();

  const { data: referrer } = await supabase
    .from('player_referrals')
    .select('id')
    .eq('referral_code', referrerCode)
    .maybeSingle();

  const { error } = await supabase
    .from('referral_sub_nodes')
    .insert({
      referrer_code: referrerCode,
      referrer_id: referrer?.id ?? null,
      recruit_code: myCode,
      recruit_name: recruitName,
      synced: false,
    });

  if (!error) {
    window.localStorage.setItem(REGISTERED_KEY, '1');
  } else {
    console.error('Referral registration failed:', error);
  }
}

/**
 * Fetches ALL referrals for this referrer, including records already
 * marked as synced. This allows the game to recover referrals if its
 * local game save is missing or has been recreated.
 *
 * Duplicate recruits are filtered by gameReducer.
 */
export async function fetchUnsyncedReferrals(
  myCode: string,
): Promise<ReferralRecord[]> {
  const { data, error } = await supabase
    .from('referral_sub_nodes')
    .select(
      'id, referrer_code, recruit_code, recruit_name, synced, created_at',
    )
    .eq('referrer_code', myCode);

  if (error) {
    console.error('Could not fetch referrals:', error);
    return [];
  }

  return (data ?? []) as ReferralRecord[];
}

/**
 * Kept for compatibility with any other existing code.
 * The game polling flow no longer needs to mark referrals as synced.
 */
export async function markReferralsSynced(
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;

  const { error } = await supabase
    .from('referral_sub_nodes')
    .update({ synced: true })
    .in('id', ids);

  if (error) {
    console.error('Could not mark referrals as synced:', error);
  }
}

const NAME_PREFIXES = [
  'SHARD',
  'LOOP',
  'NULL',
  'DATA',
  'RIFT',
  'ZERO',
  'ECHO',
  'HEX',
  'CIPHER',
  'VOID',
];

const NAME_SUFFIXES = [
  'NOVA',
  'KITE',
  'ORCHID',
  'MOTH',
  'BISHOP',
  'LATCH',
  'PYLON',
  'LANTERN',
  'RAVEN',
  'WRAITH',
];

function generateRecruitName(): string {
  const prefix =
    NAME_PREFIXES[
      Math.floor(Math.random() * NAME_PREFIXES.length)
    ];

  const suffix =
    NAME_SUFFIXES[
      Math.floor(Math.random() * NAME_SUFFIXES.length)
    ];

  return `${prefix}_${suffix}`;
}
