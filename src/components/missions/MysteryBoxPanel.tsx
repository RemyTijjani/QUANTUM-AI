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
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  const counts = useMemo(() => ({
    standard: inventory.availableBoxes.filter((box) => box.boxTier === 'standard').length,
    premium: inventory.availableBoxes.filter((box) => box.boxTier === 'premium').length,
  }), [inventory.availableBoxes]);

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
