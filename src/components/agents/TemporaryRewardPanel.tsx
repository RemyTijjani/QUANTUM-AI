import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { CheckCircle2, Clock3, Gift, LoaderCircle, Zap } from 'lucide-react';

type Reward = {
  entitlementId: string;
  rewardType: 'fragment_mining_boost' | 'daily_streak_agent';
  rewardCode: string;
  status: 'available' | 'active';
  grantedAt: string;
  activatedAt: string | null;
  expiresAt: string | null;
  metadata: Record<string, unknown>;
};

function remaining(expiresAt: string | null, now: number) {
  if (!expiresAt) return '—';
  const ms = Math.max(0, new Date(expiresAt).getTime() - now);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${hours}h ${minutes}m ${seconds}s`;
}

export default function TemporaryRewardPanel() {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error: requestError } = await supabase.functions.invoke('gameplay-actions', {
      body: { action: 'get_reward_entitlements' },
    });
    if (requestError || !data?.success || !Array.isArray(data.rewards)) {
      setError('Could not load your reward inventory.');
      setLoading(false);
      return;
    }
    setRewards(data.rewards as Reward[]);
    setError('');
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const activate = async (entitlementId: string) => {
    setActivating(entitlementId);
    setError('');
    const { data, error: requestError } = await supabase.functions.invoke('gameplay-actions', {
      body: { action: 'activate_reward_entitlement', entitlementId },
    });
    setActivating(null);
    if (requestError || !data?.success) {
      setError(data?.error || 'Could not activate this reward.');
      return;
    }
    await refresh();
  };

  const boost = rewards.filter(r => r.rewardType === 'fragment_mining_boost');
  const agent = rewards.filter(r => r.rewardType === 'daily_streak_agent');
  const renderReward = (reward: Reward) => {
    const isBoost = reward.rewardType === 'fragment_mining_boost';
    const active = reward.status === 'active' && Boolean(reward.expiresAt) && new Date(reward.expiresAt as string).getTime() > now;
    return (
      <article key={reward.entitlementId} className="flex flex-col gap-3 border border-neon/20 bg-black/30 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isBoost ? <Zap size={15} className="text-cyan-300" /> : <Gift size={15} className="text-neon-300" />}
            <p className="font-display text-xs font-bold text-neon-200">
              {isBoost ? '2× Fragment Mining · 6 hours' : 'Free Alpha Miner · 24 hours'}
            </p>
          </div>
          <p className="mt-1 font-mono text-[9px] text-neon-600">
            {active ? `Active · ${remaining(reward.expiresAt, now)} remaining` : 'Available to activate'}
          </p>
        </div>
        {active ? (
          <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase text-green-300"><CheckCircle2 size={13} /> Active</span>
        ) : (
          <button
            type="button"
            className="btn-primary shrink-0"
            disabled={loading || activating !== null || reward.status !== 'available'}
            onClick={() => void activate(reward.entitlementId)}
          >
            {activating === reward.entitlementId ? <LoaderCircle size={13} className="animate-spin" /> : null}
            Activate
          </button>
        )}
      </article>
    );
  };

  return (
    <section className="panel space-y-3 border border-cyan-400/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div><p className="label">Earned reward inventory</p><h2 className="title mt-1">Temporary activations</h2></div>
        <button type="button" className="btn-ghost" onClick={() => void refresh()} disabled={loading}>Refresh</button>
      </div>
      {loading && <p className="font-mono text-[9px] text-neon-600">Loading trusted rewards…</p>}
      {error && <p role="alert" className="font-mono text-[10px] text-amber-300">{error}</p>}
      {!loading && boost.length === 0 && agent.length === 0 && !error && (
        <p className="py-4 text-center font-mono text-[10px] text-neon-600">No temporary rewards available yet. Earn them through eligible Daily Streak or Mystery Box rewards.</p>
      )}
      {boost.map(renderReward)}
      {agent.map(renderReward)}
      <p className="font-mono text-[9px] leading-relaxed text-amber-300">
        Activation and expiry are controlled by the server. Free Alpha Miner is the 24-hour Agent 1 reward, not a paid rental. An active reward changes the in-game mining estimate while its server timer runs. It does not credit verified ZP or change your wallet balance.
      </p>
      <div className="flex items-center gap-1 font-mono text-[8px] text-neon-700"><Clock3 size={11} /> Timers begin only when you activate a reward.</div>
    </section>
  );
}
