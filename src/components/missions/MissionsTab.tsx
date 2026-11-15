
import { useEffect, useState } from 'react';
import { CalendarCheck, Check, Link2, Megaphone, Video, ExternalLink, Clock, Search, Target } from 'lucide-react';
import { AD_QUOTA_TARGET } from '@/lib/game/config';
import type { MissionSpec } from '@/lib/game/config';
import { adsWatchedToday, missionStatus } from '@/lib/game/state';
import type { GameState } from '@/lib/game/state';
import { formatClock, formatZp, msUntilNextDay } from '@/lib/format';
import type { Notify } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';
import type { CreatorOpsSubmission } from '@/lib/supabase';
import DailyUplinkClaim from '@/components/missions/DailyUplinkClaim';
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
  const [activeView, setActiveView] = useState<EngagementView>(initialView);
  useEffect(() => {
    setActiveView(initialView);
  }, [initialView]);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'all' | 'daily' | 'social' | 'creator'>('all');
  const searchTerm = search.trim().toLowerCase();
  const visibleMissions = missions.filter((mission) => {
    const matchesSearch = !searchTerm || mission.title.toLowerCase().includes(searchTerm) || mission.description.toLowerCase().includes(searchTerm);
    return matchesSearch && (category === 'all' || mission.kind === category);
  });
  const daily = visibleMissions.filter((m) => m.kind === 'daily');
  const social = visibleMissions.filter((m) => m.kind === 'social');
  const creator = visibleMissions.filter((m) => m.kind === 'creator');
  const readyCount = missions.filter((mission) => missionStatus(state, mission, now) === 'ready').length;
  const claimedCount = missions.filter((mission) => missionStatus(state, mission, now) === 'claimed').length;

  return (
    <div className="space-y-6 pb-2">
      <section className="relative overflow-hidden rounded-2xl border border-neon/25 bg-gradient-to-br from-neon/10 via-[#07110d] to-cyan-500/5 p-5">
        <div className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-neon/10 blur-3xl" />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-neon-300"><Target size={16} /><p className="label">Task-to-Earn</p></div>
            <h2 className="mt-2 font-display text-2xl font-bold tracking-wide text-white">Your Missions</h2>
            <p className="mt-1 max-w-[260px] text-[11px] leading-relaxed text-neon-500">Complete activities, verify your progress and collect eligible rewards.</p>
          </div>
          <div className="shrink-0 rounded-xl border border-neon/20 bg-black/30 px-3 py-2 text-right">
            <p className="label">Daily reset</p>
            <p className="mt-1 font-display text-sm font-bold tabular-nums text-neon-200">{formatClock(msUntilNextDay(now))}</p>
          </div>
        </div>
        <div className="relative mt-5 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-white/10 bg-black/25 p-3"><p className="font-mono text-[9px] uppercase text-neon-600">Available</p><p className="mt-1 font-display text-xl text-white">{missions.length - claimedCount}</p></div>
          <div className="rounded-xl border border-neon/20 bg-neon/5 p-3"><p className="font-mono text-[9px] uppercase text-neon-500">Ready</p><p className="mt-1 font-display text-xl text-neon-200">{readyCount}</p></div>
          <div className="rounded-xl border border-white/10 bg-black/25 p-3"><p className="font-mono text-[9px] uppercase text-neon-600">Claimed</p><p className="mt-1 font-display text-xl text-cyan-200">{claimedCount}</p></div>
        </div>
      </section>

      <Stage6EngagementHub active={activeView} onChange={setActiveView} onZpReward={onRefreshVerifiedEconomy} notify={notify} />

      <div className={activeView === 'missions' ? 'space-y-5' : 'hidden'}>
      <section className="space-y-3">
        <div className="rounded-xl border border-neon/15 bg-black/25 p-3">
          <label className="flex items-center gap-2 rounded-lg border border-neon/20 bg-black/35 px-3 py-2.5">
            <Search size={14} className="shrink-0 text-neon-600" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a mission…" className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-neon-200 outline-none placeholder:text-neon-700" />
            {search && <button type="button" onClick={() => setSearch('')} className="text-[10px] text-neon-400">Clear</button>}
          </label>
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {([{ id: 'all', label: 'All' }, { id: 'daily', label: 'Daily' }, { id: 'social', label: 'Social' }, { id: 'creator', label: 'Creator' }] as const).map((item) => (
              <button key={item.id} type="button" onClick={() => setCategory(item.id)} aria-pressed={category === item.id} className={`rounded-lg border px-2 py-2 font-mono text-[9px] uppercase tracking-wide transition ${category === item.id ? 'border-neon/40 bg-neon/10 text-neon-200' : 'border-white/10 bg-white/[0.02] text-neon-600 hover:text-neon-300'}`}>
                {item.label}<span className="ml-1 opacity-70">{item.id === 'all' ? missions.length : missions.filter((mission) => mission.kind === item.id).length}</span>
              </button>
            ))}
          </div>
        </div>
        {visibleMissions.length === 0 && (
          <div className="rounded-xl border border-dashed border-neon/20 bg-black/20 px-4 py-10 text-center">
            <Search size={22} className="mx-auto text-neon-700" />
            <p className="mt-3 text-sm font-semibold text-neon-200">No missions found</p>
            <p className="mt-1 text-[10px] text-neon-600">Try another search or choose a different category.</p>
            <button type="button" onClick={() => { setSearch(''); setCategory('all'); }} className="mt-3 text-[10px] font-mono uppercase text-neon-300">Reset filters</button>
          </div>
        )}
      </section>
      {daily.length > 0 && <section className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <CalendarCheck size={14} className="text-neon-400" />
          <p className="label">Daily Protocols</p>
        </div>
        {daily.map((mission) => (
          <MissionCard
            key={mission.id}
            mission={mission}
            status={missionStatus(state, mission, now)}
            notify={notify}
            onRefreshVerifiedEconomy={onRefreshVerifiedEconomy}
            progressLabel={
              mission.id === 'ad-quota'
                ? `${Math.min(adsWatchedToday(state, now), AD_QUOTA_TARGET)} / ${AD_QUOTA_TARGET} feeds`
                : undefined
            }
          />
        ))}
      </section>}

      {social.length > 0 && <section className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <Megaphone size={14} className="text-neon-400" />
          <p className="label">Social Raids</p>
        </div>
        {social.map((mission) => (
          <MissionCard
            key={mission.id}
            mission={mission}
            status={missionStatus(state, mission, now)}
            notify={notify}
            onRefreshVerifiedEconomy={onRefreshVerifiedEconomy}
          />
        ))}
      </section>}

      {creator.length > 0 && <section className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <Video size={14} className="text-neon-400" />
          <div className="flex flex-1 items-center justify-between">
            <p className="label">Creator Ops</p>
            <button
              type="button"
              onClick={onOpenAdmin}
              className="font-mono text-[10px] uppercase tracking-wider text-neon-500 transition hover:text-neon-300"
            >
              Admin Review Queue
            </button>
          </div>
        </div>
        {creator.map((mission) => (
          <CreatorOpsCard
            key={mission.id}
            mission={mission}
            state={state}
            notify={notify}
          />
        ))}
      </section>}
      </div>
    </div>
  );
}

interface MissionCardProps {
  mission: MissionSpec;
  status: 'claimed' | 'ready' | 'locked';
  progressLabel?: string;
  notify?: Notify;
  onRefreshVerifiedEconomy?: () => Promise<void>;
}

function MissionCard({ mission, status, progressLabel, notify, onRefreshVerifiedEconomy }: MissionCardProps) {
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const claimTelegramMission = async () => {
    if (!notify || !mission.telegramChatId || claiming) return;
    setClaiming(true);
    const { data, error } = await supabase.functions.invoke('mission-actions', {
      body: { missionId: mission.id },
    });
    setClaiming(false);
    if (error || !data || data.success !== true) {
      notify(data?.error || error?.message || 'Could not verify Telegram membership. Try again.', 'error');
      return;
    }
    setClaimed(true);
    notify(data.alreadyClaimed ? 'This mission reward was already claimed.' : `Telegram membership verified. +${formatZp(Number(data.rewardZp) || mission.reward)} ZP credited.`);
    await onRefreshVerifiedEconomy?.();
  };
  const Icon = mission.kind === 'daily' ? CalendarCheck : Megaphone;
  const legacyClaimed = status === 'claimed';

  return (
    <article className="panel flex items-start gap-3 p-4 transition-colors hover:border-neon/25 sm:gap-4">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${legacyClaimed || claimed ? 'border-cyan-300/30 bg-cyan-300/5 text-cyan-200' : 'border-neon/30 bg-neon/5 text-neon-300'}`}>
        {legacyClaimed || claimed ? <Check size={20} /> : <Icon size={20} />}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-sm font-bold tracking-wide text-white">{mission.title}</h3>
        <p className="mt-1.5 text-[11px] leading-relaxed text-neon-500">{mission.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px]">
          <span className="rounded-md border border-neon/20 bg-neon/5 px-2 py-1 font-mono font-semibold text-neon-300">{mission.telegramChatId ? `+ ${formatZp(mission.reward)} ZP` : `Reward: ${formatZp(mission.reward)} ZP`}</span>
          {progressLabel && <span className="rounded-md border border-cyan-300/20 bg-cyan-300/5 px-2 py-1 font-mono text-cyan-200">{progressLabel}</span>}
        </div>
        {mission.actionUrl && <a href={mission.actionUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] text-cyan-300 underline">Open mission <ExternalLink size={10} /></a>}
        {mission.id === 'daily-uplink' ? (
          <DailyUplinkClaim notify={notify!} onClaimed={onRefreshVerifiedEconomy!} />
        ) : mission.telegramChatId ? (
          <button
            type="button"
            onClick={() => void claimTelegramMission()}
            disabled={claiming || claimed}
            className="mt-2 rounded border border-neon/40 bg-neon/10 px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-neon-300 disabled:opacity-50"
          >
            {claiming ? 'Checking membership...' : claimed ? 'Claim checked' : `Verify & claim +${formatZp(mission.reward)} ZP`}
          </button>
        ) : (
          <p className="mt-2 font-mono text-[9px] text-amber-300">Reward is not claimable yet. Admin must configure trusted verification for this mission.</p>
        )}
      </div>
      <span className={`shrink-0 rounded-md border px-2 py-1 font-mono text-[8px] uppercase tracking-wide ${claimed || legacyClaimed ? 'border-cyan-300/25 bg-cyan-300/5 text-cyan-200' : mission.telegramChatId ? 'border-neon/20 bg-neon/5 text-neon-400' : 'border-amber-300/20 bg-amber-300/5 text-amber-200'}`}>{claimed || legacyClaimed ? 'Completed' : mission.telegramChatId ? 'Verify' : 'Unavailable'}</span>
    </article>
  );
}

function CreatorOpsCard({
  mission,
  state,
  notify,
}: {
  mission: MissionSpec;
  state: GameState;
  notify: Notify;
}) {
  const [link, setLink] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submission, setSubmission] = useState<CreatorOpsSubmission | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchSubmission = async () => {
      const { data, error } = await supabase
        .from('creator_ops_submissions')
        .select('*')
        .eq('mission_id', mission.id)
        .eq('player_referral_code', state.referralCode)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!cancelled) {
        if (error) {
          notify('Could not check your submission status.', 'error');
        } else {
          setSubmission(data as CreatorOpsSubmission | null);
        }
        setLoading(false);
      }
    };

    fetchSubmission();

    return () => {
      cancelled = true;
    };
  }, [mission.id, state.referralCode, notify]);

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
    notify('Link submitted for admin review. ZP credited on approval.');
  };

  const Icon = Video;

  return (
    <div className="panel space-y-3 p-4">
      <div className="flex items-center gap-3">
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
        <div className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2.5 font-mono text-[11px] text-amber-200">
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
        <div className="flex items-center gap-2 rounded-lg border border-neon/40 bg-neon/10 px-3 py-2.5 font-mono text-[11px] text-neon-300">
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
    <div className="flex items-center gap-2">
      <div className="flex flex-1 items-center gap-2 rounded-lg border border-neon/25 bg-black/50 px-3 py-2">
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
        className="btn-primary shrink-0 px-3 py-2 text-[10px]"
      >
        {submitting ? 'Sending' : 'Submit'}
      </button>
    </div>
  );
}
