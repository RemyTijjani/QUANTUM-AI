import { AGENTS, CORE_BASE_RATE, FRAGMENT_IDS, FRAGMENT_NAMES, FRAGMENT_ZP_PER_SEC } from '@/lib/game/config';
import {
  Store,
  ArrowUpRight,
  Flame,
  Gift,
  Compass,
  Target,
} from 'lucide-react';
import type { FragmentId } from '@/lib/game/config';
import { fixedCount, fragmentCooldownRemaining, passiveRate, tierInfo } from '@/lib/game/state';
import type { GameState, FragmentStatus } from '@/lib/game/state';
import { formatRate, formatZp, formatRemaining } from '@/lib/format';
import { Coins, Award } from 'lucide-react';
import type { Notify } from '@/hooks/useToast';
import CoreCircuit from '@/components/core/CoreCircuit';
import FragmentBays from '@/components/core/FragmentBays';
import CharacterCard from '@/components/core/CharacterCard';
import type { ZapAchievements } from '@/lib/economy/zapWallet';

interface CoreTabProps {
  state: GameState;
  notify: Notify;
  onWatchAd: (id: FragmentId) => void;
  onFixFragment: (id: FragmentId) => Promise<boolean>;
  verifiedZpBalance: number | null;
  zapEarned: number | null;
  zapLoading: boolean;
  zapAchievements: ZapAchievements | null;
  zapAchievementsLoading: boolean;
  pendingFragmentZp: number;
  nextFragmentReleaseAt: string | null;
  onOpenExpeditions: () => void;
  onOpenMissions: () => void;
  onOpenStreaks: () => void;
  onOpenMysteryBoxes: () => void;
  onOpenRaffles: () => void;
}

export default function CoreTab({
  state,
  notify,
  onWatchAd,
  onFixFragment,
  verifiedZpBalance,
  zapEarned,
  zapLoading,
  zapAchievements,
  zapAchievementsLoading,
  pendingFragmentZp,
  nextFragmentReleaseAt,
  onOpenExpeditions,
  onOpenMissions,
  onOpenStreaks,
  onOpenMysteryBoxes,
  onOpenRaffles,
}: CoreTabProps) {
  const now = Date.now();
  const rate = passiveRate(state, now);
  const miningLeft = state.coreMiningUntil - now;
  const fixed = fixedCount(state);
  const maxMiningRate = Math.max(
    CORE_BASE_RATE + FRAGMENT_ZP_PER_SEC * FRAGMENT_IDS.length,
    ...Object.values(AGENTS).map((agent) => agent.zpPerSec),
    rate,
  );
  const miningRateProgress = maxMiningRate > 0 ? Math.max(0, Math.min(100, (rate / maxMiningRate) * 100)) : 0;
  const netZapProgress = zapAchievements?.netZap ?? zapEarned;
  const tier = tierInfo(netZapProgress ?? 0);
  const coreRank = zapAchievements?.coreRank;
  const rankNumber = coreRank?.rankNumber ?? tier.tier;
  const rankProgress = Math.max(0, Math.min(100, coreRank?.progressPercent ?? tier.progress * 100));
  const zapProgress = netZapProgress === null || netZapProgress === undefined
    ? 0
    : Math.max(0, Math.min(100, ((netZapProgress % 100) + 100) % 100));

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
      void onFixFragment(id).then((started) => {
        if (started) {
          notify(`${FRAGMENT_NAMES[id]} mining has started. ZP accrues from server-recorded mining time and each earned amount stays pending for six hours.`, 'info');
        }
      }).catch((error) => {
        notify(error instanceof Error ? error.message : 'Could not verify this fragment action', 'error');
      });
      return;
    }
    notify(`${FRAGMENT_NAMES[id]} is already online`, 'info');
  };

  return (
    <div className="min-w-0 space-y-5 pb-3">
      <section className="panel min-w-0 border border-cyan-300/20 bg-black/35 p-3" aria-label="Mining and progression">
        <div className="grid grid-cols-2 items-center gap-3">
          <div className="flex justify-center">
            <div
              className="grid h-[4.25rem] w-[4.25rem] place-items-center rounded-full"
              style={{ background: `conic-gradient(#67ddff ${zapProgress}%, rgba(103,221,255,0.12) 0)` }}
              role="img"
              aria-label={`ZAP progress ${zapProgress.toFixed(0)} percent`}
            >
              <div className="grid h-[3.55rem] w-[3.55rem] place-items-center rounded-full bg-[#07111a]">
                <span className="font-display text-base font-bold tabular-nums text-cyan-100">
                  {zapLoading || netZapProgress === null || netZapProgress === undefined ? '—' : formatZp(zapProgress)}
                </span>
              </div>
            </div>
          </div>
          <div className="flex justify-center">
            <div
              className="grid h-[4.25rem] w-[4.25rem] place-items-center rounded-full"
              style={{ background: `conic-gradient(#7cf7c5 ${miningRateProgress}%, rgba(124,247,197,0.12) 0)` }}
              role="img"
              aria-label={`ZP mining rate ${formatRate(rate)} per second`}
            >
              <div className="grid h-[3.55rem] w-[3.55rem] place-items-center rounded-full bg-[#07110f]">
                <span className="font-display text-sm font-bold tabular-nums text-neon-100">{formatRate(rate)}</span>
              </div>
            </div>
          </div>
        </div>
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-cyan-950/90"
          role="progressbar"
          aria-label="Core rank progression"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(rankProgress)}
        >
          <div className="h-full rounded-full bg-cyan-300 transition-all duration-500" style={{ width: String(rankProgress) + '%' }} />
        </div>
      </section>

      <section className="panel relative min-w-0 overflow-hidden border border-neon/35 bg-gradient-to-br from-neon/10 via-black/50 to-cyan-500/5 p-3 min-[380px]:p-4">
        <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full border border-neon/10" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="label">Command dashboard</p>
            <h1 className="mt-1 font-display text-lg font-bold uppercase tracking-[0.18em] text-neon-300">Genesis Core</h1>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-neon-600">Your ZORD operations at a glance</p>
          </div>
          <span className="flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/5 px-2 py-1 font-mono text-[8px] uppercase text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Linked
          </span>
        </div>
        <div className="relative mt-4 grid grid-cols-2 gap-2 min-[380px]:gap-3">
          <div className="min-w-0 rounded-xl border border-neon/25 bg-black/40 p-3">
            <div className="flex items-center gap-2 text-neon-300"><Coins size={14}/><p className="label">Verified ZP</p></div>
            <p className="mt-2 font-display text-2xl font-bold tabular-nums text-neon-100">{verifiedZpBalance === null ? '—' : formatZp(verifiedZpBalance)}</p>
            <p className="mt-1 text-[9px] text-neon-600">Available gameplay points</p>
            <p className="mt-2 text-[9px] text-amber-300">Pending: {formatZp(pendingFragmentZp)} ZP</p>
            <p className="mt-1 text-[8px] text-neon-700">{nextFragmentReleaseAt ? `Next release in ${formatRemaining(new Date(nextFragmentReleaseAt).getTime() - now)}` : 'No pending Fragment rewards'}</p>
          </div>
          <div className="min-w-0 rounded-xl border border-cyan-300/25 bg-cyan-950/30 p-3">
            <div className="flex items-center gap-2 text-cyan-200"><Award size={14}/><p className="label">ZAP score</p></div>
            <p className="mt-2 font-display text-2xl font-bold tabular-nums text-cyan-100">{zapLoading ? '…' : zapEarned === null ? '—' : formatZp(zapEarned)}</p>
            <p className="mt-1 text-[9px] text-cyan-600">Net ZAP activity (earned − spent)</p>
            <p className="mt-2 text-[9px] text-cyan-700">Rank & achievement score</p>
          </div>
          <div className="min-w-0 rounded-xl border border-cyan-400/20 bg-black/40 p-3">
            <p className="label">Core rank</p>
            <p className="mt-1 break-words font-display text-xl text-cyan-200">{tier.rank}</p>
            <p className="mt-1 text-[9px] text-cyan-700">Rank {rankNumber} · {formatZp(netZapProgress ?? 0)} net ZAP</p>
          </div>
          <div className="min-w-0 rounded-xl border border-neon/20 bg-black/40 p-3">
            <p className="label">Fragments online</p><p className="mt-1 font-display text-xl text-neon-200">{fixed}<span className="text-sm text-neon-700"> / {FRAGMENT_IDS.length}</span></p>
            <p className="mt-1 text-[9px] text-neon-700">Displayed rate estimate: {formatRate(rate)}</p>
          </div>
        </div>
      </section>

      <section className="panel min-w-0 border border-cyan-400/20 bg-cyan-950/15 p-3 min-[380px]:p-4">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <span className="block label">ZAP achievement collection</span>
              <span className="mt-1 block font-display text-sm font-bold uppercase tracking-wider text-cyan-100">Ring milestones</span>
            </span>
            <span className="flex items-center gap-2 text-cyan-300">
              <Award size={18} />
              <span className="font-mono text-[10px]">{zapAchievements?.achievements.length ?? 0}</span>
              <span className="text-xs transition-transform group-open:rotate-180">⌄</span>
            </span>
          </summary>
          <div className="mt-3 space-y-3">
            <div className="rounded-lg border border-cyan-400/15 bg-black/30 p-3">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-cyan-200">Next badge · Level {zapAchievements ? zapAchievements.currentLevel + 1 : 1}</span>
                <span className="font-mono tabular-nums text-cyan-100">{zapAchievements ? formatZp(zapAchievements.nextLevelAt) : '100'} ZAP</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cyan-950"><div className="h-full rounded-full bg-cyan-300 transition-all" style={{ width: String(zapProgress) + '%' }} /></div>
            </div>
            {zapAchievementsLoading ? (
              <p className="py-2 text-center text-[10px] text-cyan-600">Loading achievements…</p>
            ) : zapAchievements && zapAchievements.achievements.length > 0 ? (
              <div className="space-y-2">
                {[...zapAchievements.achievements].sort((a, b) => b.level - a.level).slice(0, 6).map((achievement) => (
                  <details key={achievement.level} className="group rounded-lg border border-cyan-400/10 bg-black/25">
                    <summary className="flex cursor-pointer list-none items-center gap-3 p-2.5 [&::-webkit-details-marker]:hidden">
                      <span className={"grid h-8 w-8 shrink-0 place-items-center rounded-full border " + (achievement.isMinted ? 'border-amber-300/40 bg-amber-300/10 text-amber-200' : achievement.isUnlocked ? 'border-emerald-300/40 bg-emerald-300/10 text-emerald-200' : 'border-slate-500/30 bg-slate-500/10 text-slate-400')}>
                        <Award size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[10px] font-semibold text-cyan-100">Level {achievement.level} badge</span>
                        <span className="block text-[9px] text-cyan-700">{achievement.isMinted ? 'Minted' : achievement.isUnlocked ? 'Unlocked' : 'Locked'}</span>
                      </span>
                      <span className="text-xs text-cyan-400 transition-transform group-open:rotate-180">⌄</span>
                    </summary>
                    <div className="border-t border-cyan-400/10 px-3 py-2.5">
                      <p className="text-[9px] text-cyan-700">{formatZp(achievement.requiredNetZap)} net ZAP required</p>
                      <span className={"mt-2 inline-flex rounded-full px-2 py-1 text-[8px] uppercase tracking-wide " + (achievement.isMinted ? 'bg-amber-300/10 text-amber-200' : achievement.isUnlocked ? 'bg-emerald-300/10 text-emerald-200' : 'bg-slate-500/10 text-slate-400')}>{achievement.isMinted ? 'Minted' : achievement.isUnlocked ? 'Unlocked' : 'Locked'}</span>
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-cyan-400/15 px-3 py-4 text-center text-[10px] leading-relaxed text-cyan-700">First badge unlocks at 100 net ZAP.</p>
            )}
          </div>
        </details>
      </section>

      <section className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onOpenMissions}
          className="group flex items-center gap-3 rounded-xl border border-cyan-400/25 bg-cyan-400/5 p-3 text-left transition hover:border-cyan-300/50"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><Target size={17} /></span>
          <span className="min-w-0"><span className="block font-mono text-[10px] font-bold uppercase text-cyan-200">Missions</span><span className="mt-1 block font-mono text-[8px] text-neon-600">Daily tasks & rewards</span></span>
          <ArrowUpRight size={14} className="ml-auto shrink-0 text-cyan-400" />
        </button>
        <button
          type="button"
          onClick={onOpenExpeditions}
          className="group flex items-center gap-3 rounded-xl border border-cyan-400/25 bg-cyan-400/5 p-3 text-left transition hover:border-cyan-300/50"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><Compass size={17} /></span>
          <span className="min-w-0"><span className="block font-mono text-[10px] font-bold uppercase text-cyan-200">Expeditions</span><span className="mt-1 block font-mono text-[8px] text-neon-600">Missions & team challenges</span></span>
          <ArrowUpRight size={14} className="ml-auto shrink-0 text-cyan-400" />
        </button>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div><p className="label">Retention systems</p><h2 className="title mt-1">Daily engagement</h2></div>
          <Flame size={18} className="text-orange-300" />
        </div>
        <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
          <button type="button" onClick={onOpenStreaks} className="panel space-y-3 border border-orange-400/25 bg-orange-400/5 p-3 text-left transition hover:border-orange-300/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300">
            <div className="flex items-center justify-between"><Flame size={18} className="text-orange-300" /><span className="border border-emerald-400/25 px-1.5 py-0.5 font-mono text-[8px] uppercase text-emerald-300">Open streak</span></div>
            <div><h3 className="font-display text-xs font-bold uppercase text-orange-200">Daily Streaks</h3><p className="mt-1 font-mono text-[9px] leading-relaxed text-neon-600">View your trusted streak count, claim today's reward and track milestones.</p></div>
            <div className="border-t border-orange-400/15 pt-2"><p className="font-mono text-[8px] uppercase text-orange-300">Daily claim · UTC reset</p><p className="mt-1 font-mono text-[8px] text-neon-700">Open your server-verified streak status.</p></div>
          </button>
          <button
            type="button"
            onClick={onOpenMysteryBoxes}
            aria-label="Open Mystery Boxes"
            className="panel group space-y-3 border border-violet-400/25 bg-violet-400/5 p-3 text-left transition hover:border-violet-300/55 hover:bg-violet-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
          >
            <div className="flex items-center justify-between"><Gift size={18} className="text-violet-300 transition-transform group-hover:scale-110" /><span className="border border-emerald-400/25 px-1.5 py-0.5 font-mono text-[8px] uppercase text-emerald-300">Open boxes</span></div>
            <div><h3 className="font-display text-xs font-bold uppercase text-violet-200">Mystery Boxes</h3><p className="mt-1 font-mono text-[9px] leading-relaxed text-neon-600">Open earned boxes, claim daily rewards and view your reward history.</p></div>
            <div className="border-t border-violet-400/15 pt-2"><p className="font-mono text-[8px] uppercase text-violet-300">Standard · Premium</p><p className="mt-1 font-mono text-[8px] text-neon-700">Tap to enter your reward inventory.</p></div>
          </button>
        </div>
      </section>

      <section className="panel min-w-0 space-y-3 border border-amber-400/25 bg-amber-400/5 p-3 min-[380px]:p-4">
        <div className="flex items-center gap-2"><Gift size={16} className="text-amber-300" /><p className="label">Community prize draws</p></div>
        <div><h2 className="title mt-1">Live ZORD Raffles</h2><p className="mt-1 font-mono text-[10px] leading-relaxed text-neon-500">Explore active raffles, review prize details and manage your entries in one place.</p></div>
        <button type="button" onClick={onOpenRaffles} className="btn-ghost min-h-11 w-full"><Gift size={13} /> Open Raffles <ArrowUpRight size={13} /></button>
      </section>

      <button
        type="button"
        onClick={onOpenExpeditions}
        className="group relative flex min-h-12 w-full min-w-0 items-center justify-between overflow-hidden rounded-xl border border-cyan-400/35 bg-gradient-to-r from-cyan-500/10 via-neon/5 to-transparent p-3 text-left shadow-[0_0_22px_rgba(34,211,238,0.07)] transition hover:border-cyan-300/60 hover:bg-cyan-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        aria-label="Open Expeditions"
      >
        <span className="pointer-events-none absolute -right-5 -top-8 h-24 w-24 rounded-full border border-cyan-300/10" />
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-200"><Compass size={19} /></span>
          <span className="min-w-0"><span className="block font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-200">Expeditions</span><span className="mt-1 block truncate font-mono text-[9px] text-neon-500">Solo missions, team challenges & community activity</span></span>
        </span>
        <ArrowUpRight size={17} className="ml-2 shrink-0 text-cyan-300 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </button>

      <CoreCircuit fragments={state.fragments} rate={rate} />
      <FragmentBays
        fragments={state.fragments}
        cooldowns={state.fragmentCooldowns}
        now={now}
        onFragmentPress={(id) => handleFragment(id, state.fragments[id])}
      />
      <p className="px-1 text-center font-mono text-[11px] leading-relaxed text-neon-500">
        {miningLeft > 0 ? `Core timer: ${formatRemaining(miningLeft)} left` : 'No active fragment mining session. Fix an unlocked fragment to start server-recorded mining.'}
      </p>
      <p className="px-1 text-center font-mono text-[11px] leading-relaxed text-neon-500">
        Each Fragment has its own assigned advertising provider. Ad unlocking will activate after publisher approval and trusted server-side verification. Once unlocked, fix the Fragment into the core to begin server-recorded mining. {fixed} of {FRAGMENT_IDS.length} fragments fixed.
      </p>
      <CharacterCard fixed={fixed} rate={formatRate(rate)} />



      <section className="panel space-y-3 p-4">
        <div className="flex items-center gap-2"><Store size={16} className="text-neon-400" /><p className="label">Service marketplace</p></div>
        <div><h2 className="title mt-1">Genesis service marketplace</h2><p className="mt-1 font-mono text-[10px] leading-relaxed text-neon-500">Explore the ZORD community services planned for rental below the Genesis Fragment core.</p></div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="border border-neon/20 bg-black/40 p-3"><p className="font-display text-xs font-bold text-neon-300">Sentinel</p><p className="mt-1 font-mono text-[9px] text-neon-600">Tier 1 · AI community protection</p></div>
          <div className="border border-neon/20 bg-black/40 p-3"><p className="font-display text-xs font-bold text-neon-300">Poly-Shield</p><p className="mt-1 font-mono text-[9px] text-neon-600">Tier 2 · Advanced community defense</p></div>
          <div className="border border-neon/20 bg-black/40 p-3 sm:col-span-2"><p className="font-display text-xs font-bold text-neon-300">Omini Glitch</p><p className="mt-1 font-mono text-[9px] text-neon-600">Tier 3 · Protection plus AI content and meme creation</p></div>
        </div>
        <p className="font-mono text-[9px] uppercase tracking-wider text-amber-300">Agent rental checkout and server-side payment verification are enabled in Preview. Real GRAM wallet transfers and Telegram bot provisioning remain locked.</p>
      </section>
    </div>
  );
}
