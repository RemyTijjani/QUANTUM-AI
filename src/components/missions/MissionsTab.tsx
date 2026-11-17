
import { useEffect, useState } from 'react';
import { CalendarCheck, Check, Link2, Megaphone, Video, ExternalLink, Clock, Target } from 'lucide-react';
import type { MissionSpec } from '@/lib/game/config';
import { missionStatus } from '@/lib/game/state';
import type { GameState } from '@/lib/game/state';
import { formatClock, formatZp, msUntilNextDay } from '@/lib/format';
import type { Notify } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';
import type { CreatorOpsSubmission } from '@/lib/supabase';
import DailyUplinkClaim from '@/components/missions/DailyUplinkClaim';
import { buildReferralLink } from '@/lib/referral';
import Stage6EngagementHub from '@/components/missions/Stage6EngagementHub';
import type { EngagementView } from '@/components/missions/Stage6EngagementHub';

interface MissionsTabProps {
  state: GameState;
  notify: Notify;
  missions: MissionSpec[];
  onOpenAdmin: () => void;
  onRefreshVerifiedEconomy: () => Promise<void>;
  initialView?: EngagementView;
}

export default function MissionsTab({ state, notify, missions, onOpenAdmin, onRefreshVerifiedEconomy, initialView = 'missions' }: MissionsTabProps) {
  const now = Date.now();
  const [taskSummary, setTaskSummary] = useState<{ available: number; ready: number; claimed: number; statuses: Record<string, 'claimed' | 'ready' | 'locked' | 'pending'> } | null>(null);
  const [taskSummaryError, setTaskSummaryError] = useState(false);
  const refreshTaskSummary = async () => {
    const { data, error } = await supabase.functions.invoke('mission-actions', {
      body: { action: 'get_task_statuses' },
    });
    if (error || !data || data.success !== true || typeof data !== 'object') {
      setTaskSummaryError(true);
      return;
    }
    const result = data as { available?: unknown; ready?: unknown; claimed?: unknown; statuses?: unknown };
    if (typeof result.available !== 'number' || typeof result.ready !== 'number' || typeof result.claimed !== 'number' || !result.statuses || typeof result.statuses !== 'object') {
      setTaskSummaryError(true);
      return;
    }
    setTaskSummary({ available: result.available, ready: result.ready, claimed: result.claimed, statuses: result.statuses as Record<string, 'claimed' | 'ready' | 'locked' | 'pending'> });
    setTaskSummaryError(false);
  };
  useEffect(() => {
    void refreshTaskSummary();
    const interval = window.setInterval(() => void refreshTaskSummary(), 30000);
    window.addEventListener('focus', refreshTaskSummary);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshTaskSummary);
    };
  }, [missions]);
  const refreshAfterTaskAction = async () => {
    await onRefreshVerifiedEconomy();
    await refreshTaskSummary();
  };
  const [activeView, setActiveView] = useState<EngagementView>(initialView);
  useEffect(() => {
    setActiveView(initialView);
  }, [initialView]);

  const trackedMissions = missions.filter((m) => m.id !== 'ad-quota');
  const daily = trackedMissions.filter((m) => m.kind === 'daily');
  const social = missions.filter((m) => m.kind === 'social');
  const creator = missions.filter((m) => m.kind === 'creator');
  const statusForMission = (mission: MissionSpec) => taskSummary?.statuses[mission.id] ?? missionStatus(state, mission, now);

  return (
    <div className="min-w-0 space-y-5 pb-3 sm:space-y-6 sm:pb-2">
      <section className="relative min-w-0 overflow-hidden rounded-2xl border border-neon/25 bg-gradient-to-br from-neon/10 via-[#07110d] to-cyan-500/5 p-4 sm:p-5">
        <div className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-neon/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-neon-300"><Target size={16} /><p className="label">Task-to-Earn</p></div>
            <h2 className="mt-2 font-display text-2xl font-bold tracking-wide text-white">Your Missions</h2>
            <p className="mt-1 max-w-[260px] text-[11px] leading-relaxed text-neon-500">Complete activities, verify your progress and collect eligible rewards.</p>
          </div>
          <div className="shrink-0 rounded-xl border border-neon/20 bg-black/30 px-3 py-2 text-left min-[380px]:text-right">
            <p className="label">Daily reset</p>
            <p className="mt-1 font-display text-sm font-bold tabular-nums text-neon-200">{formatClock(msUntilNextDay(now))}</p>
          </div>
        </div>
        <div className="relative mt-4 grid grid-cols-3 gap-2 sm:mt-5 sm:gap-3">
          <div className="min-w-0 rounded-xl border border-white/10 bg-black/25 p-2.5 sm:p-3"><p className="font-mono text-[9px] uppercase text-neon-600">Available</p><p className="mt-1 font-display text-xl text-white">{taskSummary ? taskSummary.available : '—'}</p></div>
          <div className="min-w-0 rounded-xl border border-neon/20 bg-neon/5 p-2.5 sm:p-3"><p className="font-mono text-[9px] uppercase text-neon-500">Ready</p><p className="mt-1 font-display text-xl text-neon-200">{taskSummary ? taskSummary.ready : '—'}</p></div>
          <div className="min-w-0 rounded-xl border border-white/10 bg-black/25 p-2.5 sm:p-3"><p className="font-mono text-[9px] uppercase text-neon-600">Claimed</p><p className="mt-1 font-display text-xl text-cyan-200">{taskSummary ? taskSummary.claimed : '—'}</p></div>
        </div>
        {taskSummaryError && <p className="relative mt-2 text-[10px] text-amber-300">Live task counts could not be refreshed. Please try again shortly.</p>}
      </section>

      <Stage6EngagementHub active={activeView} onChange={setActiveView} onZpReward={onRefreshVerifiedEconomy} notify={notify} />

      <div className={activeView === 'missions' ? 'space-y-6' : 'hidden'}>
      <section className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <CalendarCheck size={14} className="text-neon-400" />
          <p className="label">Daily Protocols</p>
        </div>
        {daily.map((mission) => (
          <MissionCard
            key={mission.id}
            mission={mission}
            status={statusForMission(mission)}
            notify={notify}
            onRefreshVerifiedEconomy={refreshAfterTaskAction}
          referralCode={state.referralCode}
          />
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <Megaphone size={14} className="text-neon-400" />
          <p className="label">Social Raids</p>
        </div>
        {social.map((mission) => (
          <MissionCard
            key={mission.id}
            mission={mission}
            status={statusForMission(mission)}
            notify={notify}
            onRefreshVerifiedEconomy={refreshAfterTaskAction}
          referralCode={state.referralCode}
          />
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <Video size={14} className="text-neon-400" />
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
            <p className="label">Creator Ops</p>
            <button
              type="button"
              onClick={onOpenAdmin}
              className="min-h-9 rounded-md px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-neon-500 transition hover:text-neon-300 sm:text-[10px]"
            >
              Admin Review Queue
            </button>
          </div>
        </div>
        {creator.map((mission) => (
          <CreatorOpsCard
            key={mission.id}
            mission={mission}
            notify={notify}
            onStatusChanged={refreshTaskSummary}
          />
        ))}
      </section>
      </div>
    </div>
  );
}

interface MissionCardProps {
  mission: MissionSpec;
  status: 'claimed' | 'ready' | 'locked' | 'pending';
  progressLabel?: string;
  notify?: Notify;
  onRefreshVerifiedEconomy?: () => Promise<void>;
  referralCode?: string;
}

function MissionCard({ mission, status, progressLabel, notify, onRefreshVerifiedEconomy, referralCode }: MissionCardProps) {
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const claimTelegramMission = async () => {
    if (!notify || !mission.telegramChatId || claiming) return;
    setClaiming(true);
    try {
      const { data, error } = await supabase.functions.invoke('mission-actions', {
        body: { missionId: mission.id },
      });
      if (error || !data || data.success !== true) {
        notify(data?.error || error?.message || 'Could not verify Telegram membership. Try again.', 'error');
        return;
      }
      setClaimed(true);
      notify(data.alreadyClaimed ? 'This mission reward was already claimed.' : `Telegram membership verified. +${formatZp(Number(data.rewardZp) || mission.reward)} ZP credited.`);
      try {
        await onRefreshVerifiedEconomy?.();
      } catch {
        notify('Reward was recorded, but your balance could not refresh. Reopen the Vault or refresh later.', 'error');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not verify Telegram membership. Try again.', 'error');
    } finally {
      setClaiming(false);
    }
  };
  const claimAgentUptime = async () => {
    if (!notify || claiming || claimed || legacyClaimed) return;
    setClaiming(true);
    try {
      const { data, error } = await supabase.functions.invoke('mission-actions', {
        body: { missionId: mission.id },
      });
      if (error || !data || data.success !== true) {
        notify(data?.error || error?.message || 'Agent uptime could not be verified. Try again.', 'error');
        return;
      }
      setClaimed(true);
      notify(data.alreadyClaimed ? 'Your Agent Uptime reward was already claimed today.' : `12 hours verified. +${formatZp(Number(data.rewardZap) || mission.reward)} ZAP credited.`);
      try {
        await onRefreshVerifiedEconomy?.();
      } catch {
        notify('The ZAP reward was recorded, but the balance display could not refresh. Reopen the Vault or refresh later.', 'error');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Agent uptime could not be verified. Try again.', 'error');
    } finally {
      setClaiming(false);
    }
  };
  const copyReferralLink = async () => {
    if (!notify || !referralCode) {
      notify?.('Your referral link is not ready yet. Reopen the app and try again.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(buildReferralLink(referralCode));
      notify('Referral link copied. Share it with a new operative.');
    } catch {
      notify('Could not copy the referral link. Please try again.', 'error');
    }
  };
  const Icon = mission.kind === 'daily' ? CalendarCheck : Megaphone;
  const legacyClaimed = status === 'claimed';
  const pendingReview = status === 'pending';
  const rewardCurrency = mission.rewardCurrency ?? 'ZP';
  const unavailableReason = mission.id === 'ad-quota'
    ? 'Secure ad-view verification and reward claiming are not connected yet. Your progress is shown, but rewards remain locked.'
    : mission.id === 'agent-uptime'
      ? 'A paid agent must remain continuously active for 12 hours. The server checks the rental before issuing 10 ZAP.'
      : mission.id === 'follow-signal'
        ? 'Submit your X account. An Admin will manually check whether it follows @zord_agent before approving the 250 ZP reward.'
        : mission.actionUrl?.includes('t.me/')
          ? 'Telegram membership verification is not configured. An Admin must add the Telegram chat ID and make the ZORD bot an administrator.'
          : 'A trusted verification method has not been configured for this mission. Its reward remains locked.';

  return (
    <article className="panel flex min-w-0 flex-wrap items-start gap-3 p-3 sm:p-4 sm:gap-4">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${legacyClaimed || claimed ? 'border-cyan-300/30 bg-cyan-300/5 text-cyan-200' : pendingReview ? 'border-amber-300/30 bg-amber-300/5 text-amber-200' : 'border-neon/30 bg-neon/5 text-neon-300'}`}>
        {legacyClaimed || claimed ? <Check size={20} /> : pendingReview ? <Clock size={20} /> : <Icon size={20} />}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="break-words font-display text-sm font-bold tracking-wide text-white">{mission.title}</h3>
        <p className="mt-1.5 text-[11px] leading-relaxed text-neon-500">{mission.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px]">
          <span className="rounded-md border border-neon/20 bg-neon/5 px-2 py-1 font-mono font-semibold text-neon-300">Reward: {formatZp(mission.reward)} {rewardCurrency}</span>
          {progressLabel && <span className="rounded-md border border-cyan-300/20 bg-cyan-300/5 px-2 py-1 font-mono text-cyan-200">{progressLabel}</span>}
        </div>
        {mission.actionUrl && <a href={mission.actionUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] text-cyan-300 underline">Open mission <ExternalLink size={10} /></a>}
        {mission.id === 'follow-signal' ? (
          <XFollowSubmissionCard notify={notify!} onStatusChanged={onRefreshVerifiedEconomy} />
        ) : mission.id === 'daily-uplink' ? (
          <DailyUplinkClaim notify={notify!} onClaimed={onRefreshVerifiedEconomy!} />
        ) : mission.id === 'share-uplink' ? (
          <div className="mt-2 space-y-2">
            <button
              type="button"
              onClick={() => void copyReferralLink()}
              disabled={!referralCode}
              className="min-h-11 rounded border border-neon/40 bg-neon/10 px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-neon-300 disabled:opacity-50"
            >
              Copy referral link
            </button>
            <p className="font-mono text-[9px] leading-relaxed text-amber-300">Share your link with a new player. The 300 ZP reward is not claimable until referral completion verification is enabled.</p>
          </div>
        ) : mission.telegramChatId ? (
          <button
            type="button"
            onClick={() => void claimTelegramMission()}
            disabled={claiming || claimed || legacyClaimed}
            className="mt-2 min-h-11 rounded border border-neon/40 bg-neon/10 px-3 py-2 font-mono text-[9px] uppercase tracking-wide text-neon-300 disabled:opacity-50 sm:text-[10px]"
          >
            {claiming ? 'Checking membership...' : claimed || legacyClaimed ? 'Already claimed' : `Verify & claim +${formatZp(mission.reward)} ZP`}
          </button>
        ) : mission.id === 'agent-uptime' ? (
          <button
            type="button"
            onClick={() => void claimAgentUptime()}
            disabled={claiming || claimed || legacyClaimed || status !== 'ready'}
            className="mt-2 rounded border border-neon/40 bg-neon/10 px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-neon-300 disabled:opacity-50"
          >
            {claiming ? 'Verifying 12-hour uptime...' : claimed || legacyClaimed ? 'Already claimed today' : status !== 'ready' ? 'Keep paid agent active for 12 hours' : 'Verify uptime & claim 10 ZAP'}
          </button>
        ) : (
          <p className="mt-2 font-mono text-[9px] leading-relaxed text-amber-300">{unavailableReason}</p>
        )}
      </div>
      <span className={`ml-auto shrink-0 rounded-md border px-2 py-1 font-mono text-[8px] uppercase tracking-wide ${claimed || legacyClaimed ? 'border-cyan-300/25 bg-cyan-300/5 text-cyan-200' : pendingReview ? 'border-amber-300/20 bg-amber-300/5 text-amber-200' : mission.id === 'daily-uplink' || mission.id === 'follow-signal' || mission.id === 'share-uplink' || mission.telegramChatId || (mission.id === 'agent-uptime' && status === 'ready') ? 'border-neon/20 bg-neon/5 text-neon-400' : 'border-amber-300/20 bg-amber-300/5 text-amber-200'}`}>{claimed || legacyClaimed ? 'Completed' : pendingReview ? 'Pending review' : mission.id === 'daily-uplink' ? 'Claim' : mission.id === 'follow-signal' ? 'Submit' : mission.id === 'agent-uptime' ? status === 'ready' ? 'Verify' : 'Locked' : mission.id === 'share-uplink' ? 'Invite' : mission.telegramChatId ? 'Verify' : 'Setup needed'}</span>
    </article>
  );
}

function CreatorOpsCard({
  mission,
  notify,
  onStatusChanged,
}: {
  mission: MissionSpec;
  notify: Notify;
  onStatusChanged: () => Promise<void>;
}) {
  const [link, setLink] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submission, setSubmission] = useState<CreatorOpsSubmission | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let hasLoaded = false;

    const fetchSubmission = async () => {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        if (!cancelled) {
          if (!hasLoaded) notify('Sign in again to check your Creator Ops submission.', 'error');
          setLoading(false);
          hasLoaded = true;
        }
        return;
      }

      const { data, error } = await supabase
        .from('creator_ops_submissions')
        .select('*')
        .eq('player_id', authData.user.id)
        .eq('mission_id', mission.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!cancelled) {
        if (error) {
          if (!hasLoaded) notify('Could not check your submission status.', 'error');
        } else {
          setSubmission(data as CreatorOpsSubmission | null);
        }
        setLoading(false);
        hasLoaded = true;
      }
    };

    void fetchSubmission();
    const interval = window.setInterval(() => void fetchSubmission(), 30000);
    window.addEventListener('focus', fetchSubmission);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', fetchSubmission);
    };
  }, [mission.id, notify]);

  const status = submission?.status;

  const submit = async () => {
    const trimmed = link.trim();

    if (!trimmed) {
      notify('Enter a valid link first', 'error');
      return;
    }

    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        notify('Link must use http:// or https://', 'error');
        return;
      }
    } catch {
      notify('Enter a valid link first', 'error');
      return;
    }

    setSubmitting(true);

    const { data, error } = await supabase
      .rpc('submit_creator_ops_submission', {
        p_mission_id: mission.id,
        p_link_url: trimmed,
      })
      .single();

    setSubmitting(false);

    if (error || !data) {
      notify(error?.message || 'Submission failed. Try again.', 'error');
      return;
    }

    setSubmission(data as CreatorOpsSubmission);
    setLink('');
    await onStatusChanged();
    notify('Link submitted for admin review. ZP credited on approval.');
  };

  const Icon = Video;

  return (
    <div className="panel min-w-0 space-y-3 p-3 sm:p-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-neon/30 text-neon-400">
          <Icon size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-xs font-bold uppercase tracking-wide text-neon-300">{mission.title}</h3>
          <p className="mt-1 font-mono text-[11px] leading-relaxed text-neon-500">{mission.description}</p>
          <div className="mt-2 font-mono text-[11px] tabular-nums">
            <span className="text-neon-400">+{formatZp(mission.reward)} ZP on approval</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-2 font-mono text-[11px] text-neon-600">
          <Clock size={12} className="mr-1.5 animate-spin" /> Checking status...
        </div>
      ) : status === 'pending' ? (
        <div className="flex min-w-0 items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2.5 font-mono text-[10px] text-amber-200 sm:text-[11px]">
          <Clock size={14} className="shrink-0" />
          <span className="flex-1 truncate">Submitted — pending admin review</span>
          <a
            href={submission?.link_url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-amber-300 transition hover:text-amber-100"
          >
            <ExternalLink size={13} />
          </a>
        </div>
      ) : status === 'approved' ? (
        <div className="flex min-w-0 items-center gap-2 rounded-lg border border-neon/40 bg-neon/10 px-3 py-2.5 font-mono text-[10px] text-neon-300 sm:text-[11px]">
          <Check size={14} className="shrink-0" />
          <span className="flex-1">Approved — +{formatZp(submission?.reward_zp ?? mission.reward)} ZP credited</span>
        </div>
      ) : status === 'rejected' ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2.5 font-mono text-[11px] text-red-300">
            <span className="flex-1">Rejected — submit a new link to retry</span>
          </div>
          <LinkInput link={link} setLink={setLink} onSubmit={submit} submitting={submitting} />
        </div>
      ) : (
        <LinkInput link={link} setLink={setLink} onSubmit={submit} submitting={submitting} />
      )}
    </div>
  );
}

function LinkInput({
  link,
  setLink,
  onSubmit,
  submitting,
}: {
  link: string;
  setLink: (v: string) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 min-[420px]:flex-row">
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-neon/25 bg-black/50 px-3 py-2">
        <Link2 size={14} className="shrink-0 text-neon-500" />
        <input
          type="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://..."
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-neon-300 outline-none placeholder:text-neon-700"
        />
      </div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting || !link.trim()}
        className="btn-primary min-h-11 w-full shrink-0 px-3 py-2 text-[10px] min-[420px]:w-auto"
      >
        {submitting ? 'Sending' : 'Submit'}
      </button>
    </div>
  );
}


function XFollowSubmissionCard({ notify, onStatusChanged }: { notify: Notify; onStatusChanged?: () => Promise<void> | void }) {
  const [account, setAccount] = useState('');
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | null>(null);
  const [submittedAccount, setSubmittedAccount] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let hasLoaded = false;
    const load = async () => {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (cancelled) return;
      if (authError || !authData.user) {
        if (!hasLoaded) notify('Sign in again to check your X Follow submission.', 'error');
        setLoading(false);
        hasLoaded = true;
        return;
      }
      const { data, error } = await supabase.from('x_follow_submissions').select('x_username, status').eq('player_id', authData.user.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (cancelled) return;
      if (error) {
        if (!hasLoaded) notify('Could not load your X Follow submission status.', 'error');
      } else if (data) {
        setStatus(data.status as 'pending' | 'approved' | 'rejected');
        setSubmittedAccount(data.x_username);
      }
      setLoading(false);
      hasLoaded = true;
    };
    void load();
    const interval = window.setInterval(() => void load(), 30000);
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', load);
    };
  }, [notify]);
  const submit = async () => {
    if (!account.trim() || submitting) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('submit_x_follow_submission', { p_x_account: account.trim() });
      if (error || !data || data.success !== true) { notify(error?.message || data?.error || 'Could not submit your X account. Try again.', 'error'); return; }
      setStatus('pending'); setSubmittedAccount(String(data.xUsername || account.trim()).replace(/^@/, '')); setAccount('');
      await onStatusChanged?.();
      notify('Your X account was submitted. An Admin will check the follow and review it.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not submit your X account.', 'error'); }
    finally { setSubmitting(false); }
  };
  if (loading) return <p className="mt-2 font-mono text-[10px] text-neon-600">Checking your X Follow submission…</p>;
  if (status === 'approved') return <div className="mt-3 flex items-center gap-2 rounded-lg border border-neon/40 bg-neon/10 px-3 py-2.5 font-mono text-[11px] text-neon-300"><Check size={14} className="shrink-0" /><span>Approved — +250 ZP has been credited.</span></div>;
  if (status === 'pending') return <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2.5 font-mono text-[11px] text-amber-200"><div className="flex items-center gap-2"><Clock size={14} /> Pending Admin review</div><a href={`https://x.com/${encodeURIComponent(submittedAccount || '')}`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-cyan-300 underline">@{submittedAccount} <ExternalLink size={11} /></a></div>;
  return (
    <div className="mt-3 space-y-2">
      {status === 'rejected' && <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 font-mono text-[10px] text-red-300">Your previous account was not approved. Follow @zord_agent, then submit the correct X account again.</p>}
      <div className="flex flex-col gap-2 min-[420px]:flex-row">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-neon/25 bg-black/50 px-3 py-2"><span className="font-mono text-xs text-neon-500">@</span><input type="text" value={account} onChange={(event) => setAccount(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }} maxLength={200} placeholder="Your X username or profile link" aria-label="Your X username or profile link" className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-neon-300 outline-none placeholder:text-neon-700" /></div>
        <button type="button" onClick={() => void submit()} disabled={submitting || !account.trim()} className="btn-primary w-full shrink-0 px-3 py-2 text-[10px] min-[420px]:w-auto">{submitting ? 'Submitting…' : 'Submit X account'}</button>
      </div>
      <p className="font-mono text-[9px] leading-relaxed text-neon-600">Enter your X username (for example, @yourname) or your X profile link. Admin approval awards 250 ZP once.</p>
    </div>
  );
}
