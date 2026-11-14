import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gift, Loader2, RefreshCw, Sparkles, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type BoxTier = 'standard' | 'premium';
interface MysteryBox {
  entitlementId: string;
  boxTier: BoxTier;
  grantedAt: string;
  source: string;
}
interface Opening {
  openingId: string;
  entitlementId: string;
  boxTier: BoxTier;
  rewardCode: string;
  rewardType: 'zp' | 'zap' | 'boost';
  zpAmount: number | null;
  zapAmount: number | null;
  openedAt: string;
}
interface Inventory {
  availableBoxes: MysteryBox[];
  recentOpenings: Opening[];
}
interface RepeatBoxState {
  dailyClaimedToday: boolean;
  cooldownUntil: string | null;
  zpBalance: number;
  costZp: number;
  cooldownSeconds: number;
  standardChance: number;
  premiumChance: number;
  adsEnabled: boolean;
}
interface OpenResult {
  success: boolean;
  alreadyOpened?: boolean;
  boxTier: BoxTier;
  rewardCode: string;
  rewardType: 'zp' | 'zap' | 'boost';
  rewardLabel?: string;
  zpAmount: number | null;
  zapAmount: number | null;
}

const STANDARD_ODDS = [
  ['100 ZP', '20%'], ['200 ZP', '18%'], ['300 ZP', '15%'], ['400 ZP', '12%'],
  ['500 ZP', '10%'], ['600 ZP', '8%'], ['700 ZP', '6%'], ['800 ZP', '5%'],
  ['900 ZP', '3%'], ['1,000 ZP', '3%'],
];
const PREMIUM_ODDS = [
  ['100 ZP', '2%'], ['200 ZP', '3%'], ['300 ZP', '4%'], ['400 ZP', '5%'],
  ['500 ZP', '6%'], ['600 ZP', '8%'], ['700 ZP', '10%'], ['800 ZP', '12%'],
  ['900 ZP', '14%'], ['1,000 ZP', '16%'], ['1–10 ZAP', '10% total (1% each)'],
  ['2× Fragment Mining boost · 6h', '10%'],
];

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Date unavailable';
}

function formatCountdown(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

export default function MysteryBoxPanel({
  onZpReward,
  notify,
}: {
  onZpReward: () => Promise<void>;
  notify: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [inventory, setInventory] = useState<Inventory>({ availableBoxes: [], recentOpenings: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [lastReward, setLastReward] = useState<OpenResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [repeatBox, setRepeatBox] = useState<RepeatBoxState | null>(null);
  const [repeatBusy, setRepeatBusy] = useState(false);
  const [repeatMessage, setRepeatMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const loadInventory = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setErrorMessage(null);
    const { data, error } = await supabase.functions.invoke('mystery-box-actions', {
      body: { action: 'get_inventory' },
    });
    if (error) {
      setErrorMessage(error.message || 'Could not load your Mystery Box inventory.');
    } else {
      const next = (data?.inventory ?? {}) as Partial<Inventory>;
      setInventory({
        availableBoxes: Array.isArray(next.availableBoxes) ? next.availableBoxes : [],
        recentOpenings: Array.isArray(next.recentOpenings) ? next.recentOpenings : [],
      });
      setRepeatBox(data?.repeatBox && typeof data.repeatBox === 'object' ? data.repeatBox as RepeatBoxState : null);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const counts = useMemo(() => ({
    standard: inventory.availableBoxes.filter((box) => box.boxTier === 'standard').length,
    premium: inventory.availableBoxes.filter((box) => box.boxTier === 'premium').length,
  }), [inventory.availableBoxes]);

  const openRepeatBox = async () => {
    if (repeatBusy || !repeatBox?.dailyClaimedToday || !repeatBox || repeatBox.zpBalance < 500) return;
    setRepeatBusy(true);
    setRepeatMessage(null);
    setLastReward(null);
    const { data, error } = await supabase.functions.invoke('mystery-box-actions', {
      body: {
        action: 'open_repeat_mystery_box',
        method: 'zp',
        requestId: crypto.randomUUID(),
      },
    });
    setRepeatBusy(false);

    if (error || !data?.success) {
      setRepeatMessage(data?.message || error?.message || 'The repeat box could not be opened. Refreshing your status…');
      await loadInventory(true);
      return;
    }

    setLastReward(data as OpenResult);
    notify('Repeat Mystery Box opened. 500 ZP was charged and the reward was recorded.');
    await loadInventory(true);
    await onZpReward();
  };

  const openBox = async (box: MysteryBox) => {
    if (openingId) return;
    setOpeningId(box.entitlementId);
    setLastReward(null);
    const { data, error } = await supabase.functions.invoke('mystery-box-actions', {
      body: { action: 'open_mystery_box', entitlementId: box.entitlementId },
    });
    setOpeningId(null);
    if (error || !data?.success) {
      notify(error?.message || 'The box could not be opened. Checking your inventory status…', 'error');
      // A response can be lost after the server has committed the opening.
      // Refresh so the UI does not leave a consumed box looking available.
      await loadInventory(true);
      return;
    }

    const result = data as OpenResult;
    setLastReward(result);
    notify(result.alreadyOpened ? 'This box was already opened; its recorded reward is shown.' : 'Mystery Box opened successfully.');
    await loadInventory(true);
    if (result.rewardType === 'zp' && typeof result.zpAmount === 'number') {
      await onZpReward();
    }
  };

  return (
    <section className="space-y-3">
      <div className="panel space-y-3 border border-violet-400/25 bg-gradient-to-br from-violet-500/10 via-black/50 to-cyan-500/5 p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-violet-300/30 bg-violet-400/10 text-violet-200"><Gift size={18} /></span>
          <div><p className="label">Reward inventory</p><h2 className="title mt-1">Mystery Boxes</h2></div>
          <button type="button" onClick={() => void loadInventory(true)} disabled={refreshing || loading} aria-label="Refresh Mystery Box inventory" className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-lg border border-neon/40 bg-neon/10 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wide text-neon-200 shadow-[0_0_12px_rgba(34,211,238,0.12)] hover:bg-neon/20 disabled:opacity-50">
            {refreshing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            <span>{refreshing ? "Refreshing" : "Refresh"}</span>
          </button>
        </div>
        <p className="font-mono text-[10px] leading-relaxed text-neon-500">Your available boxes are loaded from the trusted reward service. The server selects the prize and records every opening.</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-neon/20 bg-black/30 p-3"><p className="label">Standard</p><p className="mt-1 font-display text-2xl text-neon-200">{counts.standard}</p><p className="font-mono text-[8px] uppercase text-neon-700">Available</p></div>
          <div className="rounded-lg border border-violet-300/25 bg-black/30 p-3"><p className="label">Premium</p><p className="mt-1 font-display text-2xl text-violet-200">{counts.premium}</p><p className="font-mono text-[8px] uppercase text-violet-400/70">Available</p></div>
        </div>
      </div>

      {errorMessage && <div role="alert" className="panel border border-red-400/25 bg-red-400/5 p-3 font-mono text-[10px] text-red-300">{errorMessage} <button type="button" onClick={() => void loadInventory()} className="ml-2 underline">Retry</button></div>}

      <div className="panel space-y-3 border border-amber-300/20 bg-gradient-to-br from-amber-400/10 via-black/40 to-violet-500/5 p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-amber-300/25 bg-amber-300/10 text-amber-200"><Gift size={18} /></span>
          <div><p className="label">Repeat opening</p><h3 className="title mt-1">Mystery Box Refill</h3></div>
          <span className="ml-auto rounded-md border border-amber-300/20 px-2 py-1 font-mono text-[8px] uppercase text-amber-200">500 ZP</span>
        </div>
        <p className="font-mono text-[9px] leading-relaxed text-neon-500">After claiming today's Daily Streak reward, open another box for 500 ZP. Each paid opening randomly gives a Standard Box (80%) or Premium Box (20%), using the published reward odds.</p>
        {repeatBox ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-neon/15 bg-black/30 p-3"><p className="label">Your ZP balance</p><p className="mt-1 font-display text-xl text-neon-200">{Number(repeatBox.zpBalance || 0).toLocaleString()}</p></div>
              <div className="rounded-lg border border-neon/15 bg-black/30 p-3"><p className="label">Next opening</p><p className="mt-1 font-mono text-sm font-bold text-amber-200">{repeatBox.cooldownUntil && new Date(repeatBox.cooldownUntil).getTime() > nowMs ? formatCountdown(new Date(repeatBox.cooldownUntil).getTime() - nowMs) : 'Ready'}</p></div>
            </div>
            {!repeatBox.dailyClaimedToday ? (
              <p className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 font-mono text-[9px] text-amber-200">Claim today's Daily Streak reward first to unlock repeat openings.</p>
            ) : repeatBox.cooldownUntil && new Date(repeatBox.cooldownUntil).getTime() > nowMs ? (
              <p className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 font-mono text-[9px] text-amber-200">Your shared 2-hour cooldown is active. Both ZP and rewarded-ad openings will remain locked until it ends.</p>
            ) : null}
            {repeatMessage && <p role="alert" className="rounded-lg border border-red-400/20 bg-red-400/5 p-3 font-mono text-[9px] text-red-300">{repeatMessage}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => void openRepeatBox()} disabled={repeatBusy || !repeatBox.dailyClaimedToday || (repeatBox.cooldownUntil !== null && new Date(repeatBox.cooldownUntil).getTime() > nowMs) || repeatBox.zpBalance < 500} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 font-mono text-[9px] font-bold uppercase text-amber-100 disabled:opacity-40">
                {repeatBusy ? <Loader2 size={14} className="animate-spin" /> : 'Open for 500 ZP'}
              </button>
              <button type="button" disabled className="min-h-11 rounded-lg border border-neon/15 bg-black/20 px-3 py-2 font-mono text-[9px] font-bold uppercase text-neon-700 disabled:opacity-70" title="AdsGram integration is not enabled yet">Watch ad · coming soon</button>
            </div>
            {repeatBox.zpBalance < 500 && <p className="font-mono text-[8px] text-red-300">You need {500 - repeatBox.zpBalance} more ZP for another opening.</p>}
          </>
        ) : (
          <p className="rounded-lg border border-neon/15 bg-black/20 p-3 font-mono text-[9px] text-neon-700">Repeat openings are waiting for the Preview database and trusted service update. Your existing free Mystery Box openings remain available.</p>
        )}
        <p className="font-mono text-[8px] leading-relaxed text-neon-700">The ZP and future AdsGram methods share one server-enforced 2-hour cooldown. AdsGram is intentionally disabled until its reward verification is implemented; no ad-view reward can be claimed yet.</p>
      </div>

      {lastReward && (
        <div role="status" aria-live="polite" className="panel space-y-2 border border-emerald-400/30 bg-emerald-400/5 p-4">
          <div className="flex items-center gap-2 text-emerald-300"><Sparkles size={16} /><p className="label">Recorded reward</p></div>
          <p className="font-display text-lg font-bold text-emerald-200">{lastReward.rewardLabel || (lastReward.rewardType === 'zp' ? `${lastReward.zpAmount} ZP` : lastReward.rewardType === 'zap' ? `${lastReward.zapAmount} ZAP` : '2× Fragment Mining boost · 6 hours')}</p>
          <p className="font-mono text-[9px] text-neon-600">The server has recorded this boost as an activation reward. Open ZORD Agents → Temporary Activations to activate it; the six-hour timer starts only when you activate it. It changes the in-game mining estimate, not your verified ZP balance.</p>
        </div>
      )}

      <div className="panel space-y-3 p-4">
        <div className="flex items-center justify-between"><p className="label">Your boxes</p><span className="font-mono text-[9px] text-neon-700">{inventory.availableBoxes.length} available</span></div>
        {loading ? <div className="flex items-center justify-center gap-2 py-6 font-mono text-[10px] text-neon-600"><Loader2 size={14} className="animate-spin" /> Loading secure inventory</div> : inventory.availableBoxes.length === 0 ? (
          <div className="py-6 text-center"><Gift size={25} className="mx-auto text-neon-700" /><p className="mt-2 font-mono text-[10px] text-neon-400">No boxes available yet</p><p className="mt-1 font-mono text-[9px] text-neon-700">Boxes will appear here when earned through an enabled reward activity.</p></div>
        ) : inventory.availableBoxes.map((box) => (
          <article key={box.entitlementId} className="flex items-center gap-3 border border-neon/15 bg-black/20 p-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${box.boxTier === 'premium' ? 'border-violet-300/30 text-violet-200' : 'border-neon/25 text-neon-300'}`}><Gift size={19} /></span>
            <div className="min-w-0 flex-1"><p className="font-display text-xs font-bold uppercase text-neon-200">{box.boxTier} Box</p><p className="mt-1 font-mono text-[8px] text-neon-700">Received {formatDate(box.grantedAt)}</p></div>
            <button type="button" onClick={() => void openBox(box)} disabled={openingId !== null} className="rounded-lg border border-neon/30 bg-neon/10 px-3 py-2 font-mono text-[9px] font-bold uppercase text-neon-200 disabled:opacity-50">
              {openingId === box.entitlementId ? <Loader2 size={13} className="animate-spin" /> : 'Open'}
            </button>
          </article>
        ))}
        <p className="flex items-start gap-2 border-t border-neon/10 pt-3 font-mono text-[8px] leading-relaxed text-neon-700"><ShieldCheck size={13} className="shrink-0" /> Opening a box immediately records and grants its server-selected reward. Please open only when you are ready.</p>
      </div>

      <div className="panel space-y-3 p-4">
        <p className="label">Published reward odds</p>
        <details className="group rounded-lg border border-neon/15 bg-black/20 p-3">
          <summary className="cursor-pointer list-none font-mono text-[10px] font-bold uppercase text-neon-300">Standard Box · 100% ZP rewards</summary>
          <div className="mt-3 space-y-2">{STANDARD_ODDS.map(([prize, chance]) => <div key={prize} className="flex justify-between font-mono text-[9px] text-neon-500"><span>{prize}</span><span>{chance}</span></div>)}</div>
        </details>
        <details className="group rounded-lg border border-violet-300/20 bg-black/20 p-3">
          <summary className="cursor-pointer list-none font-mono text-[10px] font-bold uppercase text-violet-200">Premium Box · ZP, ZAP or boost</summary>
          <div className="mt-3 space-y-2">{PREMIUM_ODDS.map(([prize, chance]) => <div key={prize} className="flex justify-between gap-3 font-mono text-[9px] text-neon-500"><span>{prize}</span><span className="shrink-0 text-right">{chance}</span></div>)}</div>
        </details>
        <p className="font-mono text-[8px] leading-relaxed text-neon-700">ZAP amounts 1–10 each have an equal 1% overall chance in a Premium Box. A Premium Box boost appears under ZORD Agents → Temporary Activations. Activate it there; its six-hour timer starts on activation and it affects the in-game mining estimate only.</p>
      </div>

      {inventory.recentOpenings.length > 0 && (
        <div className="panel space-y-2 p-4">
          <p className="label">Recent openings</p>
          {inventory.recentOpenings.slice(0, 8).map((opening) => (
            <div key={opening.openingId} className="flex items-center justify-between gap-3 border-b border-neon/10 py-2 last:border-0">
              <div><p className="font-mono text-[9px] uppercase text-neon-300">{opening.boxTier} · {opening.rewardType === 'zp' ? `${opening.zpAmount} ZP` : opening.rewardType === 'zap' ? `${opening.zapAmount} ZAP` : '2× mining boost'}</p><p className="mt-1 font-mono text-[8px] text-neon-700">{formatDate(opening.openedAt)}</p></div>
              <span className="font-mono text-[8px] uppercase text-emerald-300">Recorded</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
