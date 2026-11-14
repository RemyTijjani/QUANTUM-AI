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

/**
 * Referral attribution is recorded by telegram-auth after it verifies
 * Telegram's signed initData and start_param. The client must not create
 * referral_sub_nodes rows or choose referrer_id/recruit_id values.
 *
 * Kept as a no-op for compatibility with existing callers.
 */
export async function registerReferral(
  _myCode: string,
): Promise<void> {
  // Trusted registration happens inside the telegram-auth Edge Function.
}

/**
 * Fetch referrals scoped by the database policy to the authenticated player.
 * This is display/progress data only; it does not authorize or issue rewards.
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
 * Retained for compatibility. Referral rows are no longer mutated by clients;
 * local game state filters duplicates without changing the server record.
 */
export async function markReferralsSynced(
  _ids: string[],
): Promise<void> {
  // No client-side UPDATE on referral_sub_nodes.
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
