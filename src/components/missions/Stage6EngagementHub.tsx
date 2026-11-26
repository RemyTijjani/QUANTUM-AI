import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import MysteryBoxPanel from '@/components/missions/MysteryBoxPanel';
import ExpeditionsScreen from '@/components/missions/ExpeditionsScreen';
import RafflesScreen from '@/components/missions/RafflesScreen';
import type { Notify } from '@/hooks/useToast';
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Compass,
  Gift,
  Trophy,
  Target,
} from 'lucide-react';

export type EngagementView = 'missions' | 'streaks' | 'mystery' | 'raffles' | 'expeditions';

const VIEWS: { id: EngagementView; label: string; icon: typeof Target }[] = [
  { id: 'missions', label: 'Missions', icon: Target },
  { id: 'streaks', label: 'Streaks', icon: CalendarDays },
  { id: 'mystery', label: 'Boxes', icon: Gift },
  { id: 'raffles', label: 'Raffles', icon: Trophy },
  { id: 'expeditions', label: 'Expeditions', icon: Compass },
];

export default function Stage6EngagementHub({
  active,
  onChange,
  onZpReward,
  notify,
}: {
  active: EngagementView;
  onChange: (view: EngagementView) => void;
  onZpReward: () => Promise<void>;
  notify: Notify;
}) {
  return (
    <>
      <nav aria-label="Mission experiences" className="flex min-w-0 gap-1 overflow-x-auto rounded-xl border border-neon/20 bg-black/30 p-1 [scrollbar-width:thin]">
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-current={active === id ? 'page' : undefined}
            className={`flex min-h-12 min-w-[68px] flex-1 flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 font-mono text-[8px] uppercase tracking-wide transition ${
              active === id
                ? 'border border-neon/40 bg-neon/10 text-neon-200'
                : 'border border-transparent text-neon-600 hover:bg-neon/5 hover:text-neon-400'
            }`}
          >
            <Icon size={15} />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </nav>

      {active === 'streaks' && <DailyStreakScreen onZpReward={onZpReward} notify={notify} />}
      {active === 'mystery' && <MysteryBoxPanel onZpReward={onZpReward} notify={notify} />}
      {active === 'raffles' && <RafflesScreen />}
      {active === 'expeditions' && <ExpeditionsScreen />}
    </>
  );
}

function FeatureHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: typeof Target;
}) {
  return (
    <div className="min-w-0 panel space-y-3 border border-neon/25 bg-gradient-to-br from-neon/10 via-black/50 to-cyan-500/5 p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-neon/30 bg-neon/10 text-neon-300">
          <Icon size={18} />
        </span>
        <div>
          <p className="label">{eyebrow}</p>
          <h2 className="title mt-1">{title}</h2>
        </div>
      </div>
      <p className="font-mono text-[9px] sm:text-[10px] leading-relaxed text-neon-500">{description}</p>
    </div>
  );
}




type DailyStreakStatus = {
  currentStreakDay: number;
  bestStreakDay: number;
  claimedToday: boolean;
  nextStreakDay: number;
  claimDate: string;
  lastClaimDate?: string | null;
  lastRewardType?: DailyStreakClaim['rewardType'] | null;
  lastRewardAmount?: number | null;
  lastRewardMetadata?: Record<string, unknown> | null;
};

type DailyStreakClaim = {
  streakDay: number;
  rewardType: 'zp' | 'zap' | 'boost' | 'mystery_box' | 'temporary_agent';
  rewardAmount?: number | null;
  rewardMetadata?: Record<string, unknown>;
  alreadyClaimed?: boolean;
};

function streakRewardLabel(claim: DailyStreakClaim) {
  if (claim.rewardType === 'zp') return `+${claim.rewardAmount ?? 0} ZP`;
  if (claim.rewardType === 'zap') return `+${claim.rewardAmount ?? 0} ZAP`;
  if (claim.rewardType === 'boost') return '2× Fragment Mining boost — 6 hours after activation';
  if (claim.rewardType === 'mystery_box') {
    const tier = claim.rewardMetadata?.boxTier;
    return `${typeof tier === 'string' ? tier.toUpperCase() : 'MYSTERY'} BOX`;
  }
  return 'Free Agent 1 — 24 hours after activation';
}

function formatUtcCountdown(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function DailyStreakScreen({ onZpReward, notify }: { onZpReward: () => Promise<void>; notify: Notify }) {
  const [status, setStatus] = useState<DailyStreakStatus | null>(null);
  const [lastClaim, setLastClaim] = useState<DailyStreakClaim | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const { data, error: requestError } = await supabase.functions.invoke('gameplay-actions', {
        body: { action: 'get_daily_streak_state' },
      });
      if (requestError || !data?.streak) {
        setError('Could not load your trusted streak status.');
        return;
      }
      const streak = data.streak as DailyStreakStatus;
      setStatus(streak);
      if (streak.claimedToday && streak.lastRewardType) {
        setLastClaim({
          streakDay: streak.currentStreakDay,
          rewardType: streak.lastRewardType,
          rewardAmount: streak.lastRewardAmount ?? null,
          rewardMetadata: streak.lastRewardMetadata ?? {},
          alreadyClaimed: true,
        });
      } else {
        setLastClaim(null);
      }
      setError('');
    } catch {
      setError('Could not load your trusted streak status. Check your connection and retry.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const refreshQuietly = () => void refresh(true);
    void refresh();
    const interval = window.setInterval(refreshQuietly, 60000);
    window.addEventListener('focus', refreshQuietly);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshQuietly);
    };
  }, [refresh]);

  const claim = async () => {
    if (claiming || loading || claimedToday || error) return;
    setClaiming(true);
    try {
      const { data, error: requestError } = await supabase.functions.invoke('gameplay-actions', {
        body: { action: 'claim_daily_streak' },
      });

      if (requestError || !data?.success) {
        await refresh(true);
        notify(data?.error || requestError?.message || 'Daily Streak claim failed. Check your streak status before retrying.', 'error');
        return;
      }

      const result = data as DailyStreakClaim & {
        currentStreakDay?: number;
        bestStreakDay?: number;
        alreadyClaimed?: boolean;
      };
      setLastClaim(result);
      try {
        await onZpReward();
      } catch {
        notify('Your Daily Streak reward was recorded, but your balance could not refresh. Reopen the Vault or refresh later.', 'error');
      }
      await refresh();
      notify(result.alreadyClaimed
        ? 'Today’s Daily Streak reward was already claimed.'
        : `Day ${result.streakDay} claimed: ${streakRewardLabel(result)}`);
    } catch (requestError) {
      await refresh(true);
      notify(requestError instanceof Error ? requestError.message : 'Daily Streak claim failed. Check your streak status before retrying.', 'error');
    } finally {
      setClaiming(false);
    }
  };

  const currentDay = status?.currentStreakDay ?? 0;
  const nextDay = status?.nextStreakDay ?? 1;
  const claimedToday = status?.claimedToday ?? false;
  const nextUtcMidnight = new Date(nowMs);
  nextUtcMidnight.setUTCHours(24, 0, 0, 0);
  const nextClaimCountdown = formatUtcCountdown(nextUtcMidnight.getTime() - nowMs);

  return (
    <section className="space-y-3">
      <FeatureHeader
        eyebrow="Retention protocol"
        title="Daily Streaks"
        description="Claim once per UTC day. Miss a UTC calendar day and your next claim restarts at Day 1."
        icon={CalendarDays}
      />
      <div className="panel space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div><p className="label">Current streak</p><p className="mt-1 font-display text-3xl text-neon-200">{loading ? '—' : currentDay} <span className="text-xs text-neon-600">days</span></p></div>
          <div className="text-right"><p className="label">Best streak</p><p className="mt-1 font-display text-xl text-cyan-200">{loading ? '—' : status?.bestStreakDay ?? 0}</p></div>
        </div>
        <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6">
          {Array.from({ length: 30 }, (_, index) => index + 1).map((day) => {
            const completed = day <= currentDay;
            const isNext = day === nextDay && !claimedToday;
            const dayReward = day <= 7 ? `${day * 100} ZP` : 'Random';
            return (
              <div
                key={day}
                aria-label={`Day ${day}: ${completed ? 'claimed' : isNext ? 'available to claim' : 'locked'}`}
                className={`min-w-0 rounded-lg border px-1 py-2.5 text-center ${completed ? 'border-neon/40 bg-neon/10' : isNext ? 'border-cyan-300/45 bg-cyan-300/10' : 'border-neon/15 bg-black/30'}`}
              >
                <p className="font-mono text-[8px] text-neon-600">DAY {day}</p>
                <div className={`mx-auto mt-1.5 flex h-6 w-6 items-center justify-center rounded-full border ${completed ? 'border-neon/50 text-neon-300' : isNext ? 'border-cyan-300/50 text-cyan-200' : 'border-neon/20 text-neon-700'}`}>
                  {completed ? <CheckCircle2 size={12} /> : isNext ? <Gift size={12} /> : <Clock3 size={11} />}
                </div>
                <p className="mt-1 truncate font-mono text-[8px] text-neon-500">{dayReward}</p>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neon/10 pt-3 font-mono text-[9px] text-neon-600">
          <span>UTC claim date: {status?.claimDate ?? '—'}</span>
          <span>{claimedToday ? `Claimed · Next claim in ${nextClaimCountdown}` : `Available · Day ${nextDay}`}</span>
        </div>
        {error && <p className="font-mono text-[10px] text-amber-300">{error}</p>}
        <button
          type="button"
          onClick={() => void claim()}
          disabled={loading || claiming || claimedToday || Boolean(error)}
          className="btn-primary w-full py-3 text-[10px] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {claiming ? 'Claiming securely…' : claimedToday ? 'Daily reward claimed' : `Claim Day ${nextDay} reward`}
        </button>
        {lastClaim && (
          <div role="status" aria-live="polite" className="mystery-reward-reveal rounded-lg border border-neon/25 bg-neon/5 p-3">
            <p className="label">Latest reward — Day {lastClaim.streakDay}</p>
            <p className="mt-1 font-display text-sm text-neon-200">{streakRewardLabel(lastClaim)}</p>
            <p className="mt-1 font-mono text-[8px] text-neon-600">Reward selected and recorded by the trusted server.</p>
          </div>
        )}
      </div>
      <div className="panel space-y-2 p-4">
        <p className="label">Days 8–30 reward pool</p>
        <p className="font-mono text-[9px] leading-relaxed text-neon-500">35%: 10–20 ZAP · 34%: 2× Fragment Mining boost · 30%: Mystery Box (80% Standard / 20% Premium) · 1%: Free Agent 1 for 24 hours after activation.</p>
      </div>
    </section>
  );
}
