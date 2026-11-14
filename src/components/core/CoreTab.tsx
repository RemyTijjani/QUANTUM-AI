import { FRAGMENT_IDS, FRAGMENT_NAMES } from '@/lib/game/config';
import { Store, ArrowRightLeft, CalendarDays, ArrowUpRight } from 'lucide-react';
import type { FragmentId } from '@/lib/game/config';
import { fixedCount, fragmentCooldownRemaining, passiveRate, tierInfo } from '@/lib/game/state';
import type { GameState, FragmentStatus } from '@/lib/game/state';
import { formatRate, formatZp, formatRemaining } from '@/lib/format';
import type { Notify } from '@/hooks/useToast';
import LevelBanner from '@/components/core/LevelBanner';
import CoreCircuit from '@/components/core/CoreCircuit';
import FragmentBays from '@/components/core/FragmentBays';
import CharacterCard from '@/components/core/CharacterCard';

interface CoreTabProps {
  state: GameState;
  notify: Notify;
  onWatchAd: (id: FragmentId) => void;
  onFixFragment: (id: FragmentId) => Promise<void>;
  verifiedZpBalance: number | null;
  onOpenEvents: () => void;
}

export default function CoreTab({ state, notify, onWatchAd, onFixFragment, verifiedZpBalance, onOpenEvents }: CoreTabProps) {
  const now = Date.now();
  const tier = tierInfo(state.lifetimeZp);
  const rate = passiveRate(state, now);
  const miningLeft = state.coreMiningUntil - now;

  const handleFragment = (id: FragmentId, status: FragmentStatus) => {
    if (status === 'locked') {
      onWatchAd(id);
      return;
    }
    if (status === 'unlocked') {
      if (fragmentCooldownRemaining(state, id, now) > 0) {
        notify('Fragment cooldown is still active', 'info');
        return;
      }
      void onFixFragment(id).then(() => {
        notify(`${FRAGMENT_NAMES[id]} fixed in the trusted gameplay record. Verified ZP accrual is not enabled yet.`, 'info');
      }).catch((error) => {
        notify(error instanceof Error ? error.message : 'Could not verify this fragment action', 'error');
      });
      return;
    }
    notify(`${FRAGMENT_NAMES[id]} is already online`, 'info');
  };

  return (
    <div className="space-y-5 pb-2">
      <button
        type="button"
        onClick={onOpenEvents}
        className="group relative flex w-full items-center justify-between overflow-hidden rounded-xl border border-cyan-400/35 bg-gradient-to-r from-cyan-500/10 via-neon/5 to-transparent p-3 text-left shadow-[0_0_22px_rgba(34,211,238,0.07)] transition hover:border-cyan-300/60 hover:bg-cyan-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        aria-label="Open Events"
      >
        <span className="pointer-events-none absolute -right-5 -top-8 h-24 w-24 rounded-full border border-cyan-300/10" />
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-200">
            <CalendarDays size={19} />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-200">Events</span>
              <span className="rounded border border-cyan-300/25 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-cyan-300">Operations</span>
            </span>
            <span className="mt-1 block truncate font-mono text-[9px] text-neon-500">Challenges, competitions & community activity</span>
          </span>
        </span>
        <ArrowUpRight size={17} className="ml-2 shrink-0 text-cyan-300 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </button>
      <LevelBanner tier={tier} rate={rate} />
      <CoreCircuit fragments={state.fragments} rate={rate} />
      <FragmentBays
        fragments={state.fragments}
        cooldowns={state.fragmentCooldowns}
        now={now}
        onFragmentPress={(id) => handleFragment(id, state.fragments[id])}
      />
      <p className="px-1 text-center font-mono text-[11px] leading-relaxed text-neon-500">
        {miningLeft > 0
          ? `Core timer: ${formatRemaining(miningLeft)} left`
          : 'Core timer inactive. Fix a fragment to restart the local game timer.'}
      </p>
      <p className="px-1 text-center font-mono text-[11px] leading-relaxed text-neon-500">
        Complete the timed unlock, then fix the fragment into the core. The displayed rate is a local game estimate, not verified ZP accrual.
        {' '}
        {fixedCount(state)} of {FRAGMENT_IDS.length} fragments fixed.
      </p>
      <CharacterCard
        fixed={fixedCount(state)}
        lifetimeZp={formatZp(state.lifetimeZp)}
        rate={formatRate(rate)}
      />

      <section className="panel space-y-3 border border-cyan-500/25 bg-cyan-500/5 p-4">
        <div className="flex items-center gap-2"><ArrowRightLeft size={16} className="text-cyan-300" /><p className="label">ZP → ZAP progression</p></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="border border-neon/20 bg-black/40 p-3"><p className="label">Verified ZP</p><p className="mt-1 font-display text-lg text-neon-300">{verifiedZpBalance === null ? '—' : formatZp(verifiedZpBalance)}</p></div>
          <div className="border border-cyan-500/20 bg-black/40 p-3"><p className="label">ZAP wallet</p><p className="mt-1 font-display text-lg text-cyan-300">Not active</p></div>
        </div>
        <div className="flex items-center justify-between font-mono text-[10px] text-neon-500"><span>Conversion rule: 1,000 ZP = 1 ZAP</span><span>100 ZAP minimum transfer</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-black/60"><div className="h-full bg-cyan-400" style={{ width: verifiedZpBalance === null ? '0%' : `${(verifiedZpBalance % 1000) / 10}%` }} /></div>
        <p className="font-mono text-[9px] leading-relaxed text-amber-300">Conversion, ZAP balances and transfers are not enabled yet. This indicator shows progress toward the next 1,000 ZP threshold; it does not mint or promise ZAP.</p>
      </section>

      <section className="panel space-y-3 p-4">
        <div className="flex items-center gap-2"><Store size={16} className="text-neon-400" /><p className="label">Service marketplace</p></div>
        <div><h2 className="title mt-1">Genesis service marketplace</h2><p className="mt-1 font-mono text-[10px] leading-relaxed text-neon-500">Explore the ZORD community services planned for rental below the Genesis Fragment core.</p></div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="border border-neon/20 bg-black/40 p-3"><p className="font-display text-xs font-bold text-neon-300">Sentinel</p><p className="mt-1 font-mono text-[9px] text-neon-600">Tier 1 · AI community protection</p></div>
          <div className="border border-neon/20 bg-black/40 p-3"><p className="font-display text-xs font-bold text-neon-300">Poly-Shield</p><p className="mt-1 font-mono text-[9px] text-neon-600">Tier 2 · Advanced community defense</p></div>
          <div className="border border-neon/20 bg-black/40 p-3 sm:col-span-2"><p className="font-display text-xs font-bold text-neon-300">Omini Glitch</p><p className="mt-1 font-mono text-[9px] text-neon-600">Tier 3 · Protection plus AI content and meme creation</p></div>
        </div>
        <p className="font-mono text-[9px] uppercase tracking-wider text-amber-300">Listings are previews. Rental checkout, payment and provisioning are not live.</p>
      </section>
    </div>
  );
}
