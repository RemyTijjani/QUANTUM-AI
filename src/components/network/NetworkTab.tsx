import { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, Coins, Copy, Gift, History, Share2, Users } from 'lucide-react';
import { buildReferralLink } from '@/lib/referral';
import { openTelegramLink } from '@/lib/telegram';
import { supabase } from '@/lib/supabase';
import { claimReferralKickbacks, fetchReferralKickbacks } from '@/lib/economy/referralKickbacks';
import type { ReferralKickbackSummary } from '@/lib/economy/referralKickbacks';
import { formatZp } from '@/lib/format';
import type { GameState } from '@/lib/game/state';
import type { Notify } from '@/hooks/useToast';
import MilestonesList from '@/components/network/MilestonesList';

interface NetworkTabProps {
  state: GameState;
  notify: Notify;
  onRefreshVerifiedEconomy?: () => Promise<void>;
}

interface VerifiedReferral {
  id: string;
  recruit_code: string;
  recruit_name: string;
  created_at: string;
}

const SHARE_TEXT = 'Mine ZP with me in ZORD Autonomous Agent — Total Group Dominion';

export default function NetworkTab({ state, notify, onRefreshVerifiedEconomy }: NetworkTabProps) {
  const link = buildReferralLink(state.referralCode);
  const [referrals, setReferrals] = useState<VerifiedReferral[]>([]);
  const [loadingReferrals, setLoadingReferrals] = useState(true);
  const [referralError, setReferralError] = useState(false);
  const [kickbacks, setKickbacks] = useState<ReferralKickbackSummary | null>(null);
  const [loadingKickbacks, setLoadingKickbacks] = useState(true);
  const [kickbackError, setKickbackError] = useState(false);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadReferrals = async () => {
      setLoadingReferrals(true);
      const { data, error } = await supabase
        .from('referral_sub_nodes')
        .select('id, recruit_code, recruit_name, created_at')
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        setReferralError(true);
        setReferrals([]);
      } else {
        setReferralError(false);
        setReferrals((data ?? []) as VerifiedReferral[]);
      }
      setLoadingReferrals(false);
    };
    void loadReferrals();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadKickbacks = async () => {
      setLoadingKickbacks(true);
      try {
        const summary = await fetchReferralKickbacks();
        if (cancelled) return;
        setKickbacks(summary);
        setKickbackError(false);
      } catch {
        if (cancelled) return;
        setKickbackError(true);
      } finally {
        if (!cancelled) setLoadingKickbacks(false);
      }
    };
    void loadKickbacks();
    return () => { cancelled = true; };
  }, []);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      notify('Uplink link copied to clipboard');
    } catch {
      notify('Clipboard is blocked here. Select the link and copy it manually.', 'error');
    }
  };

  const shareLink = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(SHARE_TEXT)}`;
    openTelegramLink(url);
  };

  const refreshKickbacks = async () => {
    const summary = await fetchReferralKickbacks();
    setKickbacks(summary);
    setKickbackError(false);
  };

  const handleClaim = async () => {
    if (claiming || !kickbacks || kickbacks.claimableWholeZp < 1) return;
    setClaiming(true);
    try {
      const result = await claimReferralKickbacks();
      if (!result.success) {
        await refreshKickbacks();
        notify(
          result.reason === 'no_whole_zp_available'
            ? 'There is no whole ZP available to claim yet.'
            : 'No referral kickback is currently available to claim.',
          'error',
        );
        return;
      }
      await refreshKickbacks();
      try {
        await onRefreshVerifiedEconomy?.();
      } catch {
        notify('Your referral kickback was claimed, but the ZP balance could not refresh. Reopen the Vault or refresh later.', 'error');
      }
      notify(`${formatZp(result.claimedZp ?? 0)} ZP referral kickback claimed successfully`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not claim referral kickbacks.', 'error');
      try {
        await refreshKickbacks();
        await onRefreshVerifiedEconomy?.();
      } catch {
        setKickbackError(true);
      }
    } finally {
      setClaiming(false);
    }
  };

  const claimableWholeZp = kickbacks?.claimableWholeZp ?? 0;
  const sourceLabel = (source: string | null) => {
    if (source === 'fragment_accrual' || source === 'legacy_fragment') return 'Fragment mining';
    if (source === 'agent_rental') return 'Paid agent mining';
    if (source === 'temporary_agent') return 'Free Alpha Miner';
    return null;
  };

  return (
    <div className="min-w-0 space-y-5 pb-3 sm:space-y-6 sm:pb-2">
      <section className="panel min-w-0 space-y-4 p-4 sm:p-5">
        <div>
          <p className="label">Referral uplink</p>
          <h2 className="title mt-1">Recruit operatives</h2>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-neon-500">
            Share your referral link to invite new operatives. Only confirmed registrations are counted.
          </p>
        </div>

        <input
          readOnly
          value={link}
          aria-label="Referral link"
          onFocus={(event) => event.currentTarget.select()}
          className="w-full min-w-0 select-text break-all rounded-lg border border-neon/30 bg-black/50 px-3 py-3 font-mono text-[10px] leading-relaxed text-neon-300 outline-none focus:border-neon/70 sm:text-[11px]"
        />

        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
          <button type="button" onClick={copyLink} className="btn-ghost min-h-11 justify-center gap-2">
            <Copy size={14} /> Copy
          </button>
          <button type="button" onClick={shareLink} className="btn-cyan min-h-11 justify-center gap-2">
            <Share2 size={14} /> Share
          </button>
        </div>

        <div className="min-w-0 space-y-3 rounded-lg border border-neon/20 bg-black/20 p-3 sm:p-4">
          <div className="flex items-center gap-2">
            <Gift size={15} className="text-neon-300" />
            <p className="label">Referral kickbacks</p>
          </div>

          {loadingKickbacks ? (
            <p className="font-mono text-[10px] text-neon-500">Loading verified referral rewards...</p>
          ) : kickbackError || !kickbacks ? (
            <p className="font-mono text-[10px] leading-relaxed text-amber-300">
              Referral reward totals could not be loaded. Reopen this section or try again shortly.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                <div className="min-w-0 rounded-lg border border-neon/15 bg-black/30 p-2.5 sm:p-3">
                  <div className="flex items-center gap-1.5 text-neon-500">
                    <Clock3 size={12} />
                    <span className="font-mono text-[9px] uppercase tracking-wider">Pending</span>
                  </div>
                  <p className="mt-1 font-display text-lg font-bold text-neon-300">{formatZp(kickbacks.pendingZp)} <span className="text-[10px]">ZP</span></p>
                </div>
                <div className="min-w-0 rounded-lg border border-neon/25 bg-neon/5 p-2.5 sm:p-3">
                  <div className="flex items-center gap-1.5 text-neon-400">
                    <Coins size={12} />
                    <span className="font-mono text-[9px] uppercase tracking-wider">Claimable</span>
                  </div>
                  <p className="mt-1 font-display text-lg font-bold text-neon-200">{formatZp(kickbacks.claimableZp)} <span className="text-[10px]">ZP</span></p>
                </div>
                <div className="rounded-lg border border-neon/15 bg-black/30 p-3">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-neon-500">Lifetime earned</span>
                  <p className="mt-1 font-display text-base font-bold text-neon-300">{formatZp(kickbacks.lifetimeEarnedZp)} <span className="text-[10px]">ZP</span></p>
                </div>
                <div className="rounded-lg border border-neon/15 bg-black/30 p-3">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-neon-500">Already claimed</span>
                  <p className="mt-1 font-display text-base font-bold text-neon-300">{formatZp(kickbacks.lifetimeClaimedZp)} <span className="text-[10px]">ZP</span></p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleClaim}
                disabled={claiming || claimableWholeZp < 1}
                className="btn-cyan flex min-h-11 w-full items-center justify-center gap-2 px-3 text-center disabled:cursor-not-allowed disabled:opacity-45"
              >
                {claiming ? (
                  <>Claiming referral ZP...</>
                ) : (
                  <><CheckCircle2 size={14} /> Claim {formatZp(claimableWholeZp)} ZP</>
                )}
              </button>
              <p className="font-mono text-[9px] leading-relaxed text-neon-500">
                Only allocated whole ZP can be claimed. Eligible kickbacks first pass a 24-hour verification hold and are then allocated from the monthly referral budget.
              </p>
            </>
          )}
        </div>
      </section>

      {kickbacks && kickbacks.recentActivity.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <History size={14} className="text-neon-400" />
            <div>
              <p className="label">Referral reward history</p>
              <h2 className="title mt-1">Recent activity</h2>
            </div>
          </div>
          <div className="panel divide-y divide-neon/10">
            {kickbacks.recentActivity.map((activity) => (
              <div key={activity.id} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-3 sm:px-4">
                <div className="min-w-0">
                  <p className="font-display text-xs font-bold text-neon-300">
                    {activity.eventType.replace(/_/g, ' ')}
                    {activity.referralLevel ? ` · Level ${activity.referralLevel}` : ''}
                    {sourceLabel(activity.sourceEventType) ? ` · ${sourceLabel(activity.sourceEventType)}` : ''}
                  </p>
                  <p className="mt-1 font-mono text-[9px] text-neon-600">
                    {new Date(activity.createdAt).toLocaleString()}
                    {activity.status ? ` · ${activity.status}` : ''}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-xs tabular-nums text-neon-300">{formatZp(activity.amount)} ZP</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="px-1">
          <p className="label">Network milestones</p>
          <h2 className="title mt-1">Milestone progress</h2>
        </div>
        <MilestonesList subNodeCount={referrals.length} />
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between px-1">
          <div>
            <p className="label">Confirmed referrals</p>
            <h2 className="title mt-1 flex items-center gap-2">
              <Users size={16} /> {loadingReferrals ? 'Loading...' : referrals.length} recruits
            </h2>
          </div>
        </div>

        <div className="panel min-w-0 overflow-hidden">
          {loadingReferrals ? (
            <p className="px-5 py-8 text-center font-mono text-xs text-neon-500">Loading confirmed referral records...</p>
          ) : referralError ? (
            <p className="px-5 py-8 text-center font-mono text-xs text-amber-300">Could not load verified referrals. Refresh and try again.</p>
          ) : referrals.length === 0 ? (
            <p className="px-5 py-8 text-center font-mono text-xs leading-relaxed text-neon-500">No confirmed recruits yet. Share your referral link to invite operatives.</p>
          ) : (
            <ul className="divide-y divide-neon/10">
              {referrals.map((referral) => (
                <li key={referral.id} className="flex min-w-0 items-center justify-between gap-3 px-3 py-3 sm:px-4">
                  <div className="min-w-0">
                    <p className="truncate font-display text-xs font-bold tracking-wide text-neon-300">{referral.recruit_name || 'ZORD operative'}</p>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-neon-600">Joined {new Date(referral.created_at).toLocaleDateString()}</p>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-neon-500">Confirmed</span>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-neon/15 px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-neon-500">
              {loadingReferrals ? 'Referral count pending' : `${referrals.length} verified registrations`}
            </p>
          </div>
          <p className="border-t border-neon/15 px-4 py-3 font-mono text-[9px] leading-relaxed text-neon-500">
            Only server-registered referrals are counted. Reward eligibility and claims are calculated by the secure referral service.
          </p>
        </div>
      </section>
    </div>
  );
}
