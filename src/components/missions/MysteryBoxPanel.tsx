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
  freeClaimAvailable: boolean;
  lastFreeClaimAt: string | null;
  nextFreeClaimAt: string | null;
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

function isOpenResult(value: unknown): value is OpenResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate.success === true
    && (candidate.boxTier === 'standard' || candidate.boxTier === 'premium')
    && typeof candidate.rewardCode === 'string'
    && (candidate.rewardType === 'zp' || candidate.rewardType === 'zap' || candidate.rewardType === 'boost')
    && (candidate.zpAmount === null || typeof candidate.zpAmount === 'number')
    && (candidate.zapAmount === null || typeof candidate.zapAmount === 'number');
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
  const [dailyClaimBusy, setDailyClaimBusy] = useState(false);
  const [repeatMessage, setRepeatMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const freeClaimAvailable = Boolean(
    repeatBox && (
      repeatBox.freeClaimAvailable ||
      (repeatBox.nextFreeClaimAt !== null && new Date(repeatBox.nextFreeClaimAt).getTime() <= nowMs)
    )
  );

  const loadInventory = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setErrorMessage(null);
    try {
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
    } catch (requestError) {
      setErrorMessage(requestError instanceof Error ? requestError.message : 'Could not load your Mystery Box inventory.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  useEffect(() => {
    const refresh = () => void loadInventory(true);
    const interval = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [loadInventory]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const counts = useMemo(() => ({
    standard: inventory.availableBoxes.filter((box) => box.boxTier === 'standard').length,
    premium: inventory.availableBoxes.filter((box) => box.boxTier === 'premium').length,
  }), [inventory.availableBoxes]);

  const claimDailyBox = async () => {
    if (dailyClaimBusy || !freeClaimAvailable) return;
    setDailyClaimBusy(true);
    setOpeningId('daily-claim');
    setRepeatMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke('mystery-box-actions', {
        body: { action: 'claim_daily_mystery_box' },
      });
      if (error || !data?.success) {
        setRepeatMessage(data?.message || error?.message || 'Your free Mystery Box could not be claimed. Please try again.');
        await loadInventory(true);
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 850));
      notify(data.alreadyClaimed ? 'Your free daily Mystery Box is already claimed.' : 'Your free daily Mystery Box has been added to your inventory.');
      await loadInventory(true);
    } catch (requestError) {
      setRepeatMessage(requestError instanceof Error ? requestError.message : 'Your free Mystery Box could not be claimed. Please try again.');
      await loadInventory(true);
    } finally {
      setDailyClaimBusy(false);
      setOpeningId(null);
    }
  };

  const openRepeatBox = async () => {
    if (repeatBusy || !repeatBox || repeatBox.zpBalance < 500) return;
    setRepeatBusy(true);
    setOpeningId('repeat');
    setRepeatMessage(null);
    setLastReward(null);
    try {
      const { data, error } = await supabase.functions.invoke('mystery-box-actions', {
        body: {
          action: 'open_repeat_mystery_box',
          method: 'zp',
          requestId: crypto.randomUUID(),
        },
      });

      if (error || !data?.success) {
        setRepeatMessage(data?.message || error?.message || 'The repeat box could not be opened. Refreshing your status…');
        await loadInventory(true);
        return;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 1600));
      setLastReward(data as OpenResult);
      notify('Repeat Mystery Box opened. 500 ZP was charged and the reward was recorded.');
      await loadInventory(true);
      try {
        await onZpReward();
      } catch {
        notify('The reward was recorded, but your ZP balance could not refresh. Reopen the Vault or refresh later.', 'error');
      }
    } catch (requestError) {
      setRepeatMessage(requestError instanceof Error ? requestError.message : 'The repeat box could not be opened. Refreshing your status…');
      await loadInventory(true);
    } finally {
      setRepeatBusy(false);
      setOpeningId(null);
    }
  };

  const openRepeatBoxWithAd = async () => {
    if (repeatBusy || !repeatBox) return;
    setRepeatBusy(true);
    setOpeningId('repeat-ad');
    setRepeatMessage(null);
    setLastReward(null);
    try {
      const requestId = crypto.randomUUID();
      const { data: session, error: sessionError } = await supabase.functions.invoke('mystery-box-actions', {
        body: { action: 'begin_mystery_box_ad', requestId },
      });
      if (sessionError || !session?.success || session.provider !== 'onclicka' ||
          session.spotId !== 6155605 || typeof session.sessionId !== 'string') {
        throw new Error(session?.message || sessionError?.message || 'OnClicka could not prepare your rewarded-ad session.');
      }

      const onclickaWindow = window as Window & {
        initCdTma?: (options: { id: number }) => Promise<() => Promise<unknown>>;
      };
      if (typeof onclickaWindow.initCdTma !== 'function') {
        throw new Error('OnClicka is still loading. Please try again in a moment.');
      }
      const showOnclickaAd = await onclickaWindow.initCdTma({ id: 6155605 });
      if (typeof showOnclickaAd !== 'function') {
        throw new Error('OnClicka could not initialize the rewarded video.');
      }

      // SDK completion is only one signal. The server callback is independently
      // required before the database grants the box and starts the shared cooldown.
      await showOnclickaAd();

      let result: unknown = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const { data, error } = await supabase.functions.invoke('mystery-box-actions', {
          body: { action: 'confirm_mystery_box_ad', sessionId: session.sessionId },
        });
        if (error) throw new Error(error.message || 'Could not confirm the OnClicka ad session.');
        if (data?.success === true && data?.completed === true) {
          result = data;
          break;
        }
        if (data?.reason && !['pending_verification', 'session_not_pending'].includes(data.reason)) {
          throw new Error('OnClicka verification could not complete this Mystery Box opening.');
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }

      if (!result) {
        notify('OnClicka finished the video, but ZORD is still waiting for its verified server callback. No Mystery Box has been credited yet.', 'info');
        await loadInventory(true);
        return;
      }

      if (!isOpenResult(result)) {
        throw new Error('The verified Mystery Box response was incomplete. Please refresh your inventory.');
      }
      setLastReward(result);
      notify('OnClicka verified your rewarded ad. Your Mystery Box reward has been recorded.');
      await loadInventory(true);
      try {
        await onZpReward();
      } catch {
        notify('The reward was recorded, but your ZP balance could not refresh. Reopen the Vault or refresh later.', 'error');
      }
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : 'The OnClicka rewarded ad could not be verified. No box was granted.', 'error');
    } finally {
      setRepeatBusy(false);
      setOpeningId(null);
    }
  };

  const openBox = async (box: MysteryBox) => {
    if (openingId) return;
    setOpeningId(box.entitlementId);
    setLastReward(null);
    try {
      const { data, error } = await supabase.functions.invoke('mystery-box-actions', {
        body: { action: 'open_mystery_box', entitlementId: box.entitlementId },
      });
      if (error || !data?.success) {
        notify(error?.message || 'The box could not be opened. Checking your inventory status…', 'error');
        // A response can be lost after the server has committed the opening.
        // Refresh so the UI does not leave a consumed box looking available.
        await loadInventory(true);
        return;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 1600));
      const result = data as OpenResult;
      setLastReward(result);
      notify(result.alreadyOpened ? 'This box was already opened; its recorded reward is shown.' : 'Mystery Box opened successfully.');
      await loadInventory(true);
      try {
        await onZpReward();
      } catch {
        notify('The reward was recorded, but your ZP balance could not refresh. Reopen the Vault or refresh later.', 'error');
      }
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : 'The box could not be opened. Checking your inventory status…', 'error');
      await loadInventory(true);
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <section className="min-w-0 space-y-3">
      <div className="panel min-w-0 space-y-3 border border-violet-400/25 bg-gradient-to-br from-violet-500/10 via-black/50 to-cyan-500/5 p-3 sm:p-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className={"mystery-box-art flex h-9 w-9 items-center justify-center rounded-lg border border-violet-300/30 bg-violet-400/10 text-violet-200 " + (openingId ? "mystery-box-art--opening" : "")}><Gift size={18} /></span>
          <div><p className="label">Reward inventory</p><h2 className="title mt-1">Mystery Boxes</h2></div>
          <button type="button" onClick={() => void loadInventory(true)} disabled={refreshing || loading} aria-label="Refresh Mystery Box inventory" className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-lg border border-neon/40 bg-neon/10 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wide text-neon-200 shadow-[0_0_12px_rgba(34,211,238,0.12)] hover:bg-neon/20 disabled:opacity-50">
            {refreshing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            <span>{refreshing ? "Refreshing" : "Refresh"}</span>
          </button>
        </div>
        <p className="font-mono text-[10px] leading-relaxed text-neon-500">Your available boxes are loaded from the trusted reward service. The server selects the box tier and prize, then records every opening.</p>
        <div className="min-w-0 rounded-lg border border-violet-300/20 bg-violet-400/5 p-3">
          <p className="font-mono text-[10px] font-bold uppercase text-violet-200">How Standard and Premium work</p>
          <p className="mt-1 font-mono text-[9px] leading-relaxed text-neon-400">Every free daily claim or 500 ZP repeat opening awards one randomly selected box: <span className="font-bold text-neon-200">Standard · 80%</span> or <span className="font-bold text-violet-200">Premium · 20%</span>. You cannot choose or purchase a Premium Box directly. When a Premium Box is awarded, it appears in your inventory below.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-neon/20 bg-black/30 p-3"><p className="label">Standard</p><p className="mt-1 font-display text-2xl text-neon-200">{counts.standard}</p><p className="font-mono text-[8px] uppercase text-neon-700">Available</p></div>
          <div className="rounded-lg border border-violet-300/25 bg-black/30 p-3"><p className="label">Premium</p><p className="mt-1 font-display text-2xl text-violet-200">{counts.premium}</p><p className="font-mono text-[8px] uppercase text-violet-400/70">Available</p></div>
        </div>
      <div className="mt-4 space-y-3 border-t border-neon/15 pt-4">
        <div className="space-y-3 rounded-xl border border-violet-300/25 bg-gradient-to-r from-violet-500/10 via-black/25 to-cyan-500/5 p-3 sm:p-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className={"mystery-box-art flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-violet-300/35 bg-violet-400/10 text-violet-100 " + (dailyClaimBusy ? "mystery-box-art--opening" : "")}>
              <Gift size={28} />
            </span>
            <div className="min-w-0">
              <p className="label">Daily Discovery Box</p>
              <p className="mt-1 font-display text-sm font-bold text-violet-100">Your Mystery Box is always here</p>
              <p className="mt-1 font-mono text-[9px] leading-relaxed text-neon-500">Claim one free box every 24 hours. This is independent of your Daily Streak.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void claimDailyBox()}
            disabled={dailyClaimBusy || loading || !freeClaimAvailable}
            aria-label="Claim your free daily Mystery Box"
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-violet-300/40 bg-violet-300/15 px-3 py-3 font-mono text-[10px] font-bold uppercase tracking-wide text-violet-100 transition hover:bg-violet-300/20 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {dailyClaimBusy ? <Loader2 size={15} className="animate-spin" /> : <Gift size={15} />}
            {dailyClaimBusy
              ? 'Claiming your box…'
              : !repeatBox
                ? 'Checking availability…'
                : freeClaimAvailable
                  ? 'Claim your free Mystery Box'
                  : repeatBox.nextFreeClaimAt
                    ? `Available in ${formatCountdown(new Date(repeatBox.nextFreeClaimAt).getTime() - nowMs)}`
                    : 'Daily box unavailable'}
          </button>
          <p className="font-mono text-[8px] leading-relaxed text-neon-700">After claiming, your box appears in Your Boxes below. Open it there to reveal the server-selected reward.</p>
        </div>
        <div className="space-y-3 border-t border-neon/15 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-2 min-[380px]:items-center">
            <div><p className="label">Open another box</p><p className="mt-1 font-mono text-[9px] text-neon-600">Watch an OnClicka rewarded video or spend 500 ZP for one more randomly tiered box.</p></div>
            <span className="rounded-md border border-amber-300/20 px-2 py-1 font-mono text-[8px] uppercase text-amber-200">500 ZP</span>
          </div>
          {repeatBox ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-neon/15 bg-black/30 p-3"><p className="label">Your ZP balance</p><p className="mt-1 font-display text-xl text-neon-200">{Number(repeatBox.zpBalance || 0).toLocaleString()}</p></div>
                <div className="rounded-lg border border-neon/15 bg-black/30 p-3"><p className="label">Next opening</p><p className="mt-1 font-mono text-sm font-bold text-amber-200">{repeatBox.cooldownUntil && new Date(repeatBox.cooldownUntil).getTime() > nowMs ? formatCountdown(new Date(repeatBox.cooldownUntil).getTime() - nowMs) : 'Ready'}</p></div>
              </div>
              {repeatBox.cooldownUntil && new Date(repeatBox.cooldownUntil).getTime() > nowMs && (
                <p className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 font-mono text-[9px] text-amber-200">Your shared 2-hour cooldown is active. Both repeat options unlock when it ends.</p>
              )}
              {repeatMessage && <p role="alert" className="rounded-lg border border-red-400/20 bg-red-400/5 p-3 font-mono text-[9px] text-red-300">{repeatMessage}</p>}
              <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-2">
                <button type="button" onClick={() => void openRepeatBoxWithAd()} disabled={repeatBusy || (repeatBox.cooldownUntil !== null && new Date(repeatBox.cooldownUntil).getTime() > nowMs)} className="min-h-11 rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 font-mono text-[9px] font-bold uppercase text-cyan-100 disabled:opacity-40">{repeatBusy && openingId === "repeat-ad" ? <Loader2 size={14} className="mx-auto animate-spin" /> : "Watch OnClicka Ad"}</button>
                <button type="button" onClick={() => void openRepeatBox()} disabled={repeatBusy || (repeatBox.cooldownUntil !== null && new Date(repeatBox.cooldownUntil).getTime() > nowMs) || repeatBox.zpBalance < 500} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 font-mono text-[9px] font-bold uppercase text-amber-100 disabled:opacity-40">
                  {repeatBusy ? <Loader2 size={14} className="animate-spin" /> : 'Open for 500 ZP'}
                </button>
              </div>
              {repeatBox.zpBalance < 500 && <p className="font-mono text-[8px] text-red-300">You need {500 - repeatBox.zpBalance} more ZP for another opening.</p>}
            </>
          ) : (
            <p className="rounded-lg border border-neon/15 bg-black/20 p-3 font-mono text-[9px] text-neon-700">Repeat opening status is loading. Refresh if this message remains.</p>
          )}
          <p className="font-mono text-[8px] leading-relaxed text-neon-700">Both repeat options share one server-enforced 2-hour cooldown. OnClicka rewards are credited only after its server callback and ZORD SDK completion are both recorded.</p>
        </div>
      </div>
      </div>

      {errorMessage && <div role="alert" className="panel border border-red-400/25 bg-red-400/5 p-3 font-mono text-[10px] text-red-300">{errorMessage} <button type="button" onClick={() => void loadInventory()} className="ml-2 underline">Retry</button></div>}



      {lastReward && (
        <div role="status" aria-live="polite" className="mystery-reward-reveal panel space-y-2 border border-emerald-400/30 bg-emerald-400/5 p-4">
          <div className="flex items-center gap-2 text-emerald-300"><Sparkles size={16} /><p className="label">Recorded reward</p></div>
          <p className="font-display text-lg font-bold text-emerald-200">{lastReward.rewardLabel || (lastReward.rewardType === 'zp' ? `${lastReward.zpAmount} ZP` : lastReward.rewardType === 'zap' ? `${lastReward.zapAmount} ZAP` : '2× Fragment Mining boost · 6 hours')}</p>
          <p className="font-mono text-[9px] text-neon-600">The server has recorded this boost as an activation reward. Open ZORD Agents → Temporary Activations to activate it; the six-hour timer starts only when you activate it and doubles trusted Fragment mining accrual while active.</p>
        </div>
      )}

      <div className="panel min-w-0 space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="label">Your boxes</p><span className="font-mono text-[9px] text-neon-700">{inventory.availableBoxes.length} available</span></div>
        {loading ? <div className="flex items-center justify-center gap-2 py-6 font-mono text-[10px] text-neon-600"><Loader2 size={14} className="animate-spin" /> Loading secure inventory</div> : inventory.availableBoxes.length === 0 ? (
          <div className="py-6 text-center"><Gift size={25} className="mx-auto text-neon-700" /><p className="mt-2 font-mono text-[10px] text-neon-400">No boxes available yet</p><p className="mt-1 font-mono text-[9px] text-neon-700">Boxes will appear here when earned through an enabled reward activity.</p></div>
        ) : inventory.availableBoxes.map((box) => (
          <article key={box.entitlementId} className="flex min-w-0 flex-wrap items-center gap-3 border border-neon/15 bg-black/20 p-3">
            <span className={`mystery-box-art flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${box.boxTier === 'premium' ? 'mystery-box-art--premium border-violet-300/30 text-violet-200' : 'border-neon/25 text-neon-300'} ${openingId === box.entitlementId ? 'mystery-box-art--opening' : ''}`}><Gift size={19} /></span>
            <div className="min-w-0 flex-1"><p className="break-words font-display text-xs font-bold uppercase text-neon-200">{box.boxTier} Box</p><p className="mt-1 font-mono text-[8px] text-neon-700">Received {formatDate(box.grantedAt)}</p></div>
            <button type="button" onClick={() => void openBox(box)} disabled={openingId !== null} className="ml-auto min-h-11 rounded-lg border border-neon/30 bg-neon/10 px-3 py-2 font-mono text-[9px] font-bold uppercase text-neon-200 disabled:opacity-50">
              {openingId === box.entitlementId ? <Loader2 size={13} className="animate-spin" /> : 'Open'}
            </button>
          </article>
        ))}
        <p className="flex items-start gap-2 border-t border-neon/10 pt-3 font-mono text-[8px] leading-relaxed text-neon-700"><ShieldCheck size={13} className="shrink-0" /> Opening a box immediately records and grants its server-selected reward. Please open only when you are ready.</p>
      </div>

      {inventory.recentOpenings.length > 0 && (
        <div className="panel min-w-0 space-y-2 p-3 sm:p-4">
          <p className="label">Recent openings</p>
          {inventory.recentOpenings.slice(0, 8).map((opening) => (
            <div key={opening.openingId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-neon/10 py-2 last:border-0">
              <div><p className="font-mono text-[9px] uppercase text-neon-300">{opening.boxTier} · {opening.rewardType === 'zp' ? `${opening.zpAmount} ZP` : opening.rewardType === 'zap' ? `${opening.zapAmount} ZAP` : '2× mining boost'}</p><p className="mt-1 font-mono text-[8px] text-neon-700">{formatDate(opening.openedAt)}</p></div>
              <span className="font-mono text-[8px] uppercase text-emerald-300">Recorded</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
