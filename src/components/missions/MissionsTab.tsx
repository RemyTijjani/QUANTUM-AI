
import { useEffect, useState } from 'react';
import { CalendarCheck, Check, Link2, Megaphone, Video, ExternalLink, Clock } from 'lucide-react';
import { AD_QUOTA_TARGET } from '@/lib/game/config';
import type { MissionSpec } from '@/lib/game/config';
import { adsWatchedToday, missionStatus } from '@/lib/game/state';
import type { GameState } from '@/lib/game/state';
import { formatClock, formatZp, msUntilNextDay } from '@/lib/format';
import type { Notify } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';
import type { CreatorOpsSubmission } from '@/lib/supabase';

interface MissionsTabProps {
  state: GameState;
  notify: Notify;
  missions: MissionSpec[];
  onOpenAdmin: () => void;
}

export default function MissionsTab({ state, notify, missions, onOpenAdmin }: MissionsTabProps) {
  const now = Date.now();

  const daily = missions.filter((m) => m.kind === 'daily');
  const social = missions.filter((m) => m.kind === 'social');
  const creator = missions.filter((m) => m.kind === 'creator');

  return (
    <div className="space-y-6 pb-2">
      <section className="panel flex items-center justify-between gap-4 p-5">
        <div>
          <p className="label">Task-to-Earn protocol</p>
          <h2 className="title mt-1">Mission control</h2>
        </div>
        <div className="text-right">
          <p className="label">Resets in</p>
          <p className="mt-1 font-display text-sm font-bold tabular-nums text-neon-300">
            {formatClock(msUntilNextDay(now))}
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <CalendarCheck size={14} className="text-neon-400" />
          <p className="label">Daily Protocols</p>
        </div>
        {daily.map((mission) => (
          <MissionCard
            key={mission.id}
            mission={mission}
            status={missionStatus(state, mission, now)}
            progressLabel={
              mission.id === 'ad-quota'
                ? `${Math.min(adsWatchedToday(state, now), AD_QUOTA_TARGET)} / ${AD_QUOTA_TARGET} feeds`
                : undefined
            }
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
            status={missionStatus(state, mission, now)}
          />
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2 px-1"><Clock size={14} className="text-cyan-300" /><p className="label">Special Operations</p></div>
        <div className="panel border border-cyan-500/20 bg-cyan-500/5 p-4">
          <h3 className="font-display text-xs font-bold uppercase text-cyan-300">Expeditions & intelligence briefings</h3>
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-neon-500">Special missions, expeditions and intelligence briefings will appear here when published by the operations team. No placeholder mission or reward is being counted.</p>
          <p className="mt-2 font-mono text-[9px] uppercase tracking-wider text-neon-700">Awaiting published operations</p>
        </div>
      </section>

      <section className="space-y-3">
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
      </section>
    </div>
  );
}

interface MissionCardProps {
  mission: MissionSpec;
  status: 'claimed' | 'ready' | 'locked';
  progressLabel?: string;
}

function MissionCard({ mission, status, progressLabel, verifiable }: MissionCardProps) {
  const Icon = mission.kind === 'daily' ? CalendarCheck : Megaphone;
  const legacyClaimed = status === 'claimed';

  return (
    <div className="panel flex items-center gap-4 p-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-neon/30 text-neon-400">
        {legacyClaimed ? <Check size={20} /> : <Icon size={20} />}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-xs font-bold uppercase tracking-wide text-neon-300">{mission.title}</h3>
        <p className="mt-1 font-mono text-[11px] leading-relaxed text-neon-500">{mission.description}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[11px] tabular-nums">
          <span className="text-neon-400">Configured reward (not claimable): {formatZp(mission.reward)} ZP</span>
          {progressLabel && <span className="text-cyan-300">Local game estimate: {progressLabel}</span>}
        </div>
        {mission.actionUrl && <a href={mission.actionUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] text-cyan-300 underline">Open mission <ExternalLink size={10} /></a>}
        <p className="mt-2 font-mono text-[9px] text-amber-300">Trusted completion checks and reward claims are not available for this mission yet.</p>
      </div>
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-neon-600">{legacyClaimed ? 'Legacy local record' : 'Not claimable'}</span>
    </div>
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
