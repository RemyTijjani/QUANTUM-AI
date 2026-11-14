import { FRAGMENT_IDS, FRAGMENT_NAMES } from '@/lib/game/config';
import {
  Store,
  ArrowRightLeft,
  CalendarDays,
  ArrowUpRight,
  Flame,
  Gift,
  Radio,
  Target,
} from 'lucide-react';
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
  onOpenMissions: () => void;
}

export default function CoreTab({
  state,
  notify,
  onWatchAd,
  onFixFragment,
  verifiedZpBalance,
  onOpenEvents,
  onOpenMissions,
}: CoreTabProps) {
  const now = Date.now();
  const tier = tierInfo(state.lifetimeZp);
  const rate = passiveRate(state, now);
  const miningLeft = state.coreMiningUntil - now;
  const fixed = fixedCount(state);

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
    <div className="space-y-5 pb-3">
      <section className="panel relative overflow-hidden border border-neon/35 bg-gradient-to-br from-neon/10 via-black/50 to-cyan-500/5 p-4">
        <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full border border-neon/10" />
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <p className="label">Command dashboard</p>
            <h1 className="mt-1 font-display text-lg font-bold uppercase tracking-[0.18em] text-neon-300">Genesis Core</h1>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-neon-600">Your ZORD operations at a glance</p>
          </div>
          <span className="flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/5 px-2 py-1 font-mono text-[8px] uppercase text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Linked
          </span>
        </div>
        <div className="relative mt-4 grid grid-cols-2 gap-2">
          <div className="border border-neon/20 bg-black/40 p-3">
            <p className="label">Verified ZP</p>
            <p className="mt-1 font-display text-xl tabular-nums text-neon-200">{verifiedZpBalance === null ? '—' : formatZp(verifiedZpBalance)}</p>
            <p className="mt-1 font-mono text-[8px] text-neon-700">Server-recorded balance</p>
          </div>
          <div className="border border-cyan-400/20 bg-black/40 p-3">
            <p className="label">Core rank</p>
            <p className="mt-1 font-display text-xl text-cyan-200">{tier.rank}</p>
            <p className="mt-1 font-mono text-[8px] text-cyan-700">Tier {tier.tier}</p>
          </div>
          <div className="border border-neon/20 bg-black/40 p-3">
            <p className="label">Fragments online</p>
            <p className="mt-1 font-display text-xl tabular-nums text-neon-200">{fixed}<span className="text-sm text-neon-700"> / {FRAGMENT_IDS.length}</span></p>
          </div>
          <div className="border border-neon/20 bg-black/40 p-3">
            <p className="label">Local game rate</p>
            <p className="mt-1 font-display text-xl tabular-nums text-neon-200">{formatRate(rate)}</p>
            <p className="mt-1 font-mono text-[8px] text-amber-400">Estimate only · not verified ZP</p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onOpenMissions}
          className="group flex items-center gap-3 rounded-xl border border-cyan-400/25 bg-cyan-400/5 p-3 text-left transition hover:border-cyan-300/50"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><Target size={17} /></span>
          <span className="min-w-0"><span className="block font-mono text-[10px] font-bold uppercase text-cyan-200">Missions</span><span className="mt-1 block font-mono text-[8px] text-neon-600">Daily tasks & briefings</span></span>
          <ArrowUpRight size={14} className="ml-auto shrink-0 text-cyan-400" />
        </button>
        <button
          type="button"
          onClick={onOpenEvents}
          className="group flex items-center gap-3 rounded-xl border border-cyan-400/25 bg-cyan-400/5 p-3 text-left transition hover:border-cyan-300/50"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><CalendarDays size={17} /></span>
          <span className="min-w-0"><span className="block font-mono text-[10px] font-bold uppercase text-cyan-200">Events</span><span className="mt-1 block font-mono text-[8px] text-neon-600">Community operations</span></span>
          <ArrowUpRight size={14} className="ml-auto shrink-0 text-cyan-400" />
        </button>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div><p className="label">Retention systems</p><h2 className="title mt-1">Daily engagement</h2></div>
          <Flame size={18} className="text-orange-300" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <article className="panel space-y-3 border border-orange-400/25 bg-orange-400/5 p-3">
            <div className="flex items-center justify-between"><Flame size={18} className="text-orange-300" /><span className="border border-amber-400/25 px-1.5 py-0.5 font-mono text-[8px] uppercase text-amber-300">In progress</span></div>
            <div><h3 className="font-display text-xs font-bold uppercase text-orange-200">Daily Streaks</h3><p className="mt-1 font-mono text-[9px] leading-relaxed text-neon-600">Consecutive-day activity, milestone calendar and streak status.</p></div>
            <div className="border-t border-orange-400/15 pt-2"><p className="font-mono text-[8px] uppercase text-amber-300">Reward rules not activated</p><p className="mt-1 font-mono text-[8px] text-neon-700">No streak reward is currently claimable.</p></div>
          </article>
          <article className="panel space-y-3 border border-violet-400/25 bg-violet-400/5 p-3">
            <div className="flex items-center justify-between"><Gift size={18} className="text-violet-300" /><span className="border border-amber-400/25 px-1.5 py-0.5 font-mono text-[8px] uppercase text-amber-300">In progress</span></div>
            <div><h3 className="font-display text-xs font-bold uppercase text-violet-200">Mystery Discovery</h3><p className="mt-1 font-mono text-[9px] leading-relaxed text-neon-600">Daily discovery, reveal animation and earned-item history.</p></div>
            <div className="border-t border-violet-400/15 pt-2"><p className="font-mono text-[8px] uppercase text-amber-300">Reward pool not activated</p><p className="mt-1 font-mono text-[8px] text-neon-700">Opening and rewards are disabled.</p></div>
          </article>
        </div>
      </section>

      <section className="panel space-y-3 border border-cyan-500/25 bg-cyan-500/5 p-4">
        <div className="flex items-center gap-2"><Radio size={16} className="text-cyan-300" /><p className="label">Intelligence briefing</p></div>
        <div><h2 className="title mt-1">Mission intelligence feed</h2><p className="mt-1 font-mono text-[10px] leading-relaxed text-neon-500">Briefings, operational notices and special assignments are presented in Mission Control when published.</p></div>
        <button type="button" onClick={onOpenMissions} className="btn-ghost w-full"><Radio size={13} /> Open Mission Control <ArrowUpRight size={13} /></button>
      </section>

      <button
        type="button"
        onClick={onOpenEvents}
        className="group relative flex w-full items-center justify-between overflow-hidden rounded-xl border border-cyan-400/35 bg-gradient-to-r from-cyan-500/10 via-neon/5 to-transparent p-3 text-left shadow-[0_0_22px_rgba(34,211,238,0.07)] transition hover:border-cyan-300/60 hover:bg-cyan-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        aria-label="Open Events"
      >
        <span className="pointer-events-none absolute -right-5 -top-8 h-24 w-24 rounded-full border border-cyan-300/10" />
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-200"><CalendarDays size={19} /></span>
          <span className="min-w-0"><span className="block font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-200">Events</span><span className="mt-1 block truncate font-mono text-[9px] text-neon-500">Challenges, competitions & community activity</span></span>
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
        {miningLeft > 0 ? `Core timer: ${formatRemaining(miningLeft)} left` : 'Core timer inactive. Fix a fragment to restart the local game timer.'}
      </p>
      <p className="px-1 text-center font-mono text-[11px] leading-relaxed text-neon-500">
        Complete the timed unlock, then fix the fragment into the core. The displayed rate is a local game estimate, not verified ZP accrual. {fixed} of {FRAGMENT_IDS.length} fragments fixed.
      </p>
      <CharacterCard fixed={fixed} lifetimeZp={formatZp(state.lifetimeZp)} rate={formatRate(rate)} />

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
