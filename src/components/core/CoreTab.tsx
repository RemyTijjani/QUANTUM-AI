import { AGENTS, FRAGMENT_IDS, FRAGMENT_NAMES, FRAGMENT_ZP_PER_SEC } from '@/lib/game/config';
import {
  Flame,
  Gift,
  Compass,
  Store,
} from 'lucide-react';
import type { FragmentId } from '@/lib/game/config';
import { fixedCount, fragmentCooldownRemaining, tierInfo } from '@/lib/game/state';
import type { GameState, FragmentStatus } from '@/lib/game/state';
import { formatRate, formatZp, formatRemaining } from '@/lib/format';
import { Coins, Award } from 'lucide-react';
import type { Notify } from '@/hooks/useToast';
import CoreCircuit from '@/components/core/CoreCircuit';
import FragmentBays from '@/components/core/FragmentBays';
import ZpMiningProgress from '@/components/core/ZpMiningProgress';
import CharacterCard from '@/components/core/CharacterCard';
import type { ZapAchievements } from '@/lib/economy/zapWallet';
import type { VerifiedAgentRental } from '@/lib/economy/verifiedEconomy';

interface CoreTabProps {
  state: GameState;
  now: number;
  fragmentMiningEnabled: boolean;
  fragmentMiningRateMultiplier: number;
  notify: Notify;
  onWatchAd: (id: FragmentId) => void;
  onFixFragment: (id: FragmentId) => Promise<boolean>;
  verifiedZpBalance: number | null;
  activeAgentRentals: VerifiedAgentRental[];
  zapEarned: number | null;
  zapLoading: boolean;
  zapAchievements: ZapAchievements | null;
  zapAchievementsLoading: boolean;
  gramWalletConnected: boolean;
  onOpenVault: () => void;
  onClaimAchievement: (level: number) => Promise<void>;
  pendingFragmentZp: number;
  nextFragmentReleaseAt: string | null;
  entityNumber: number | null;
  onOpenExpeditions: () => void;
  onOpenStreaks: () => void;
  onOpenMysteryBoxes: () => void;
  onOpenRaffles: () => void;
  onOpenMarket: () => void;
}

export default function CoreTab({
  state,
  now,
  fragmentMiningEnabled,
  fragmentMiningRateMultiplier,
  notify,
  onWatchAd,
  onFixFragment,
  verifiedZpBalance,
  activeAgentRentals,
  zapEarned,
  zapLoading,
  zapAchievements,
  zapAchievementsLoading,
  gramWalletConnected,
  onOpenVault,
  onClaimAchievement,
  pendingFragmentZp,
  nextFragmentReleaseAt,
  entityNumber,
  onOpenExpeditions,
  onOpenStreaks,
  onOpenMysteryBoxes,
  onOpenRaffles,
  onOpenMarket,
}: CoreTabProps) {
  const miningLeft = state.coreMiningUntil - now;
  const nextFragmentCooldown = Math.min(
    ...FRAGMENT_IDS
      .filter((id) => state.fragments[id] === 'fixed' && state.fragmentCooldowns[id] > now)
      .map((id) => state.fragmentCooldowns[id] - now),
    Number.POSITIVE_INFINITY,
  );
  const fixed = fixedCount(state);
  const activeFragmentCount = FRAGMENT_IDS.filter((id) =>
    state.fragments[id] === 'fixed' && state.fragmentMiningUntil[id] > now
  ).length;
  const paidRentalRate = activeAgentRentals
    .filter((rental) => Date.parse(rental.startsAt) <= now && Date.parse(rental.expiresAt) > now)
    .reduce((sum, rental) => sum + rental.ratePerSecond, 0);
  const temporaryAgentRate = state.temporaryAgentUntil > now ? AGENTS.alpha.zpPerSec : 0;
  const temporaryFragmentBoost = state.fragmentMiningBoostUntil > now ? state.fragmentMiningBoostMultiplier : 1;
  const effectiveFragmentRateMultiplier = fragmentMiningRateMultiplier * temporaryFragmentBoost;
  const fragmentRate = !fragmentMiningEnabled || paidRentalRate > 0
    ? 0
    : activeFragmentCount * FRAGMENT_ZP_PER_SEC * effectiveFragmentRateMultiplier;
  const rate = verifiedZpBalance === null ? 0 : paidRentalRate + temporaryAgentRate + fragmentRate;
  const miningRateLabel = verifiedZpBalance === null ? '—' : formatRate(rate);
  const maxMiningRate = Math.max(
    FRAGMENT_ZP_PER_SEC * FRAGMENT_IDS.length * fragmentMiningRateMultiplier * 2,
    AGENTS.alpha.zpPerSec + AGENTS.overclock.zpPerSec,
    rate,
  );
  const miningRateProgress = verifiedZpBalance !== null && maxMiningRate > 0
    ? Math.max(0, Math.min(100, (rate / maxMiningRate) * 100))
    : 0;
  const netZapProgress = zapAchievements?.netZap ?? zapEarned;
  const tier = netZapProgress === null || netZapProgress === undefined ? null : tierInfo(netZapProgress);
  const coreRank = zapAchievements?.coreRank;
  const rankNumber = coreRank?.rankNumber ?? tier?.tier ?? null;
  const rankProgress = Math.max(0, Math.min(100, coreRank?.progressPercent ?? (tier ? tier.progress * 100 : 0)));
  const zapProgress = netZapProgress === null || netZapProgress === undefined
    ? 0
    : Math.max(0, Math.min(100, ((netZapProgress % 500) + 500) % 500 / 5));

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
    if (fragmentCooldownRemaining(state, id, now) > 0) {
      notify('Fragment cooldown is still active', 'info');
      return;
    }
    onWatchAd(id);
  };

  return (
    <div className="min-w-0 space-y-5 pb-3">
      <section
        className="relative isolate min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.13),transparent_58%),linear-gradient(145deg,rgba(8,22,34,0.98),rgba(2,8,16,0.98)_58%,rgba(5,20,20,0.98))] p-2.5 shadow-[0_16px_45px_rgba(0,0,0,0.38)]"
        aria-label="Mining and progression"
      >
        <div className="pointer-events-none absolute -left-12 -top-16 h-36 w-36 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -right-10 h-36 w-36 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="relative mb-2 flex items-center justify-between gap-2">
          <div>
            <p className="font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-slate-400">Core telemetry</p>
            <p className="mt-0.5 font-display text-xs font-bold uppercase tracking-wider text-slate-100">Your power at a glance</p>
            <p className="mt-0.5 text-[8px] text-slate-400">Build your rank. Keep your core running.</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[8px] uppercase tracking-wider text-slate-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
            Active
          </span>
        </div>
        <div className="relative grid grid-cols-2 gap-2">
          <div className="group relative flex min-w-0 flex-col items-center overflow-hidden rounded-xl border border-cyan-300/20 bg-gradient-to-b from-cyan-400/[0.09] to-slate-950/70 px-2 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/60 to-transparent" />
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.28em] text-cyan-200">ZAP</span>
            <div
              className="relative mt-1.5 grid h-[5rem] w-[5rem] place-items-center rounded-full p-[5px] shadow-[0_0_25px_rgba(34,211,238,0.16)] transition-transform duration-500 group-hover:scale-[1.04]"
              style={{ background: `conic-gradient(from -90deg, #a5f3fc 0%, #22d3ee ${zapProgress}%, rgba(34,211,238,0.10) ${zapProgress}%, rgba(34,211,238,0.10) 100%)` }}
              role="img"
              aria-label={`ZAP progress ${zapProgress.toFixed(0)} percent`}
            >
              <div className="grid h-full w-full place-items-center rounded-full border border-cyan-100/10 bg-[#06131e] shadow-[inset_0_2px_12px_rgba(0,0,0,0.75)]">
                <div className="text-center">
                  <span className="block font-display text-lg font-bold leading-none tabular-nums text-cyan-50 drop-shadow-[0_0_8px_rgba(103,221,255,0.55)]">
                    {zapLoading || netZapProgress === null || netZapProgress === undefined ? '—' : formatZp(zapProgress)}
                  </span>
                  <span className="mt-1 block font-mono text-[7px] font-semibold uppercase tracking-[0.2em] text-cyan-400/80">Progress</span>
                </div>
              </div>
            </div>
            <p className="mt-1.5 font-mono text-[8px] font-semibold uppercase tracking-wider text-cyan-300/80">Build your rank</p>
            <p className="mt-0.5 text-center text-[8px] leading-tight text-slate-500">Net ZAP moves you forward</p>
          </div>
          <div className="group relative flex min-w-0 flex-col items-center overflow-hidden rounded-xl border border-emerald-300/20 bg-gradient-to-b from-emerald-400/[0.09] to-slate-950/70 px-2 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-emerald-200/60 to-transparent" />
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.28em] text-emerald-200">ZP</span>
            <div
              className="relative mt-2 grid h-[5.7rem] w-[5.7rem] place-items-center rounded-full p-[5px] shadow-[0_0_25px_rgba(52,211,153,0.15)] transition-transform duration-500 group-hover:scale-[1.04]"
              style={{ background: `conic-gradient(from -90deg, #bbf7d0 0%, #34d399 ${miningRateProgress}%, rgba(52,211,153,0.10) ${miningRateProgress}%, rgba(52,211,153,0.10) 100%)` }}
              role="img"
              aria-label={verifiedZpBalance === null ? 'ZP mining rate unavailable' : `ZP mining rate ${miningRateLabel} per second`}
            >
              <div className="grid h-full w-full place-items-center rounded-full border border-emerald-100/10 bg-[#061711] shadow-[inset_0_2px_12px_rgba(0,0,0,0.75)]">
                <div className="text-center">
                  <span className="block max-w-[4.7rem] truncate font-display text-sm font-bold leading-none tabular-nums text-emerald-50 drop-shadow-[0_0_8px_rgba(124,247,197,0.5)]">{miningRateLabel}</span>
                  <span className="mt-1 block font-mono text-[7px] font-semibold uppercase tracking-[0.2em] text-emerald-400/80">ZP / sec</span>
                </div>
              </div>
            </div>
            <p className="mt-1.5 font-mono text-[8px] font-semibold uppercase tracking-wider text-emerald-300/80">Live mining power</p>
            <p className="mt-1 text-center text-[8px] leading-tight text-slate-500">Your ZP earned per second</p>
          </div>
        </div>
        <div className="relative mt-2 rounded-lg border border-white/[0.07] bg-black/30 px-3 py-1.5">
          <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[8px] uppercase tracking-wider">
            <span className="text-slate-400">Next rank · keep rising</span>
            <span className="font-bold tabular-nums text-cyan-200">{Math.round(rankProgress)}%</span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full border border-cyan-100/10 bg-slate-900"
            role="progressbar"
            aria-label="Core rank progression"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(rankProgress)}
          >
            <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-sky-300 to-cyan-100 shadow-[0_0_12px_rgba(103,221,255,0.55)] transition-all duration-700" style={{ width: String(rankProgress) + '%' }} />
          </div>
        </div>
      </section>

      <section className="panel relative min-w-0 overflow-hidden border border-neon/35 bg-gradient-to-br from-neon/10 via-black/50 to-cyan-500/5 p-2.5">
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
        <div className="relative mt-3 grid grid-cols-2 gap-2">
          <div className="min-w-0 rounded-xl border border-neon/25 bg-black/40 p-2.5">
            <div className="flex items-center gap-2 text-neon-300"><Coins size={14}/><p className="label">Verified ZP</p></div>
            <p className="mt-2 font-display text-2xl font-bold tabular-nums text-neon-100">{verifiedZpBalance === null ? '—' : formatZp(verifiedZpBalance)}</p>
            <p className="mt-1 text-[9px] text-neon-600">Available gameplay points</p>
            <p className="mt-2 text-[9px] text-amber-300">Pending: {formatZp(pendingFragmentZp)} ZP</p>
            <p className="mt-1 text-[8px] text-neon-700">{nextFragmentReleaseAt ? `Next release in ${formatRemaining(new Date(nextFragmentReleaseAt).getTime() - now)}` : 'No pending Fragment rewards'}</p>
          </div>
          <div className="min-w-0 rounded-xl border border-cyan-300/25 bg-cyan-950/30 p-2.5">
            <div className="flex items-center gap-2 text-cyan-200"><Award size={14}/><p className="label">ZAP score</p></div>
            <p className="mt-2 font-display text-2xl font-bold tabular-nums text-cyan-100">{zapLoading ? '…' : zapEarned === null ? '—' : formatZp(zapEarned)}</p>
            <p className="mt-1 text-[9px] text-cyan-600">Net ZAP activity (earned − spent)</p>
            <p className="mt-2 text-[9px] text-cyan-700">Rank & achievement score</p>
          </div>
          <div className="min-w-0 rounded-xl border border-cyan-400/20 bg-black/40 p-2.5">
            <p className="label">Core rank</p>
            <p className="mt-1 break-words font-display text-xl text-cyan-200">{tier?.rank ?? '—'}</p>
            <p className="mt-1 text-[9px] text-cyan-700">Rank {rankNumber ?? '—'} · {netZapProgress === null || netZapProgress === undefined ? '—' : formatZp(netZapProgress)} net ZAP</p>
          </div>
          <div className="min-w-0 rounded-xl border border-neon/20 bg-black/40 p-2.5">
            <p className="label">Fragments online</p><p className="mt-1 font-display text-xl text-neon-200">{activeFragmentCount}<span className="text-sm text-neon-700"> / {FRAGMENT_IDS.length}</span></p>
          </div>
        </div>
      </section>

      <section className="panel min-w-0 border border-cyan-400/20 bg-cyan-950/15 p-2.5" aria-label="Daily activities">
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onOpenStreaks} className="flex min-h-[4.25rem] min-w-0 items-center gap-2 rounded-lg border border-orange-400/25 bg-orange-400/5 p-2 text-left transition hover:border-orange-300/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300">
            <Flame size={17} className="shrink-0 text-orange-300" />
            <span className="min-w-0"><span className="block truncate font-mono text-[9px] font-bold uppercase text-orange-200">Daily Streak</span><span className="mt-0.5 block truncate font-mono text-[8px] text-neon-600">Claim reward</span></span>
          </button>
          <button type="button" onClick={onOpenMysteryBoxes} className="flex min-h-[4.25rem] min-w-0 items-center gap-2 rounded-lg border border-violet-400/25 bg-violet-400/5 p-2 text-left transition hover:border-violet-300/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
            <Gift size={17} className="shrink-0 text-violet-300" />
            <span className="min-w-0"><span className="block truncate font-mono text-[9px] font-bold uppercase text-violet-200">Mystery Box</span><span className="mt-0.5 block truncate font-mono text-[8px] text-neon-600">Open rewards</span></span>
          </button>
          <button type="button" onClick={onOpenExpeditions} className="flex min-h-[4.25rem] min-w-0 items-center gap-2 rounded-lg border border-cyan-400/25 bg-cyan-400/5 p-2 text-left transition hover:border-cyan-300/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
            <Compass size={17} className="shrink-0 text-cyan-200" />
            <span className="min-w-0"><span className="block truncate font-mono text-[9px] font-bold uppercase text-cyan-200">Expedition</span><span className="mt-0.5 block truncate font-mono text-[8px] text-neon-600">Solo & team</span></span>
          </button>
          <button type="button" onClick={onOpenRaffles} className="flex min-h-[4.25rem] min-w-0 items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/5 p-2 text-left transition hover:border-amber-300/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
            <Gift size={17} className="shrink-0 text-amber-300" />
            <span className="min-w-0"><span className="block truncate font-mono text-[9px] font-bold uppercase text-amber-200">Raffle</span><span className="mt-0.5 block truncate font-mono text-[8px] text-neon-600">Prize draws</span></span>
          </button>
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
                <span className="font-mono tabular-nums text-cyan-100">{zapAchievements ? formatZp(zapAchievements.nextLevelAt) : '500'} ZAP</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cyan-950"><div className="h-full rounded-full bg-cyan-300 transition-all" style={{ width: String(zapProgress) + '%' }} /></div>
            </div>
            {zapAchievementsLoading ? (
              <p className="py-2 text-center text-[10px] text-cyan-600">Loading achievements…</p>
            ) : zapAchievements && zapAchievements.achievements.length > 0 ? (
              <div className="space-y-2">
                {[...zapAchievements.achievements].sort((a, b) => b.level - a.level).map((achievement) => (
                  <details key={achievement.level} className="group rounded-lg border border-cyan-400/10 bg-black/25">
                    <summary className="flex cursor-pointer list-none items-center gap-3 p-2.5 [&::-webkit-details-marker]:hidden">
                      <span className={"grid h-8 w-8 shrink-0 place-items-center rounded-full border " + ((achievement.isClaimed || achievement.isMinted) ? 'border-amber-300/40 bg-amber-300/10 text-amber-200' : achievement.isUnlocked ? 'border-emerald-300/40 bg-emerald-300/10 text-emerald-200' : 'border-slate-500/30 bg-slate-500/10 text-slate-400')}>
                        <Award size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[10px] font-semibold text-cyan-100">Level {achievement.level} badge</span>
                        <span className="block text-[9px] text-cyan-700">{(achievement.isClaimed || achievement.isMinted) ? 'Claimed · Permanent' : achievement.isUnlocked ? 'Unlocked · Unclaimed' : 'Locked'}</span>
                      </span>
                      <span className="text-xs text-cyan-400 transition-transform group-open:rotate-180">⌄</span>
                    </summary>
                    <div className="border-t border-cyan-400/10 px-3 py-2.5">
                      <p className="text-[9px] text-cyan-700">{formatZp(achievement.requiredNetZap)} net ZAP required</p>
                      <span className={"mt-2 inline-flex rounded-full px-2 py-1 text-[8px] uppercase tracking-wide " + ((achievement.isClaimed || achievement.isMinted) ? 'bg-amber-300/10 text-amber-200' : achievement.isUnlocked ? 'bg-emerald-300/10 text-emerald-200' : 'bg-slate-500/10 text-slate-400')}>{(achievement.isClaimed || achievement.isMinted) ? 'Claimed · Permanent' : achievement.isUnlocked ? 'Unlocked · Unclaimed' : 'Locked'}</span>
                      {achievement.isClaimed || achievement.isMinted ? (
                        <p className="mt-2 rounded-lg border border-amber-300/20 bg-amber-300/5 px-2.5 py-2 text-[9px] text-amber-200">Permanently stored in your collection.</p>
                      ) : achievement.isUnlocked ? (
                        <button
                          type="button"
                          className="btn-primary mt-2 w-full"
                          onClick={() => gramWalletConnected ? void onClaimAchievement(achievement.level) : onOpenVault()}
                        >
                          {gramWalletConnected ? 'Claim Achievement · 0.1 Gram' : 'Connect Wallet to Claim'}
                        </button>
                      ) : null}
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-cyan-400/15 px-3 py-4 text-center text-[10px] leading-relaxed text-cyan-700">First badge unlocks at 500 net ZAP.</p>
            )}
          </div>
        </details>
      </section>

      <ZpMiningProgress
        fragments={state.fragments}
        miningUntil={state.fragmentMiningUntil}
        miningEnabled={fragmentMiningEnabled}
        miningPausedByRental={paidRentalRate > 0}
        activeAgentRentals={activeAgentRentals}
        rateMultiplier={effectiveFragmentRateMultiplier}
        now={now}
      />

      <CoreCircuit fragments={state.fragments} miningUntil={state.fragmentMiningUntil} now={now} rate={rate} />
      <FragmentBays
        fragments={state.fragments}
        cooldowns={state.fragmentCooldowns}
        miningUntil={state.fragmentMiningUntil}
        miningEnabled={fragmentMiningEnabled}
        miningPausedByRental={paidRentalRate > 0}
        activeAgentRentals={activeAgentRentals}
        rateMultiplier={effectiveFragmentRateMultiplier}
        now={now}
        onFragmentPress={(id) => handleFragment(id, state.fragments[id])}
      />
      <p className="px-1 text-center font-mono text-[11px] leading-relaxed text-neon-500">
        {!fragmentMiningEnabled
          ? 'Global Fragment mining is paused by Admin.'
          : paidRentalRate > 0 && activeFragmentCount > 0
            ? 'Fragment rewards are suppressed while a paid agent is active.'
            : activeFragmentCount > 0
              ? `Mining active · ${formatRemaining(miningLeft)} remaining`
              : Number.isFinite(nextFragmentCooldown)
                ? `Next Fragment available in ${formatRemaining(nextFragmentCooldown)}`
                : fixed > 0
                  ? 'Unlock Shield or Processor for free, or verify an ad to unlock or reactivate another Fragment and resume mining.'
                  : 'Unlock Shield or Processor for free, or verify an ad to unlock another Fragment and start mining.'}
      </p>
      <p className="px-1 text-center font-mono text-[11px] leading-relaxed text-neon-500">
        Shield and Processor unlock free after their five-second activation animation. Capacitor and Atom require their assigned rewarded ads and trusted server-side verification. Once unlocked, fix a Fragment into the core to begin server-recorded mining. {fixed} of {FRAGMENT_IDS.length} fragments fixed.
      </p>
      <section className="panel min-w-0 border border-violet-400/25 bg-gradient-to-r from-violet-500/10 via-black/45 to-cyan-500/5 p-3" aria-label="ZORD Market">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-violet-300/25 bg-violet-400/10 text-violet-200"><Store size={18} /></span>
            <span className="min-w-0">
              <span className="block font-display text-sm font-bold uppercase tracking-wider text-violet-100">ZORD Market</span>
              <span className="mt-0.5 block truncate font-mono text-[9px] text-neon-500">Mining agents & community services</span>
            </span>
          </div>
          <button type="button" onClick={onOpenMarket} className="shrink-0 rounded-lg border border-violet-300/30 bg-violet-400/10 px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-wide text-violet-100 transition hover:bg-violet-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
            Open market
          </button>
        </div>
      </section>
      <CharacterCard fixed={fixed} rate={miningRateLabel} entityNumber={entityNumber} />



    </div>
  );
}
