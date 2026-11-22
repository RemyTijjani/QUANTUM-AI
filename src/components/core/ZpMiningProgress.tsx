import { CORE_SESSION_HOURS, FRAGMENT_IDS, FRAGMENT_ZP_PER_SEC } from '@/lib/game/config';
import type { FragmentId } from '@/lib/game/config';
import type { FragmentStatus } from '@/lib/game/state';
import type { VerifiedAgentRental } from '@/lib/economy/verifiedEconomy';
import { formatZp } from '@/lib/format';

interface ZpMiningProgressProps {
  fragments: Record<FragmentId, FragmentStatus>;
  miningUntil: Record<FragmentId, number>;
  miningEnabled: boolean;
  miningPausedByRental: boolean;
  activeAgentRentals: VerifiedAgentRental[];
  rateMultiplier: number;
  now: number;
}

export default function ZpMiningProgress({ fragments, miningUntil, miningEnabled, miningPausedByRental, activeAgentRentals, rateMultiplier, now }: ZpMiningProgressProps) {
  const miningSessionMs = CORE_SESSION_HOURS * 60 * 60 * 1000;
  const cycleFragments = FRAGMENT_IDS.filter((id) =>
    fragments[id] === 'fixed' && miningUntil[id] > now
  );
  const cycleRate = FRAGMENT_ZP_PER_SEC * rateMultiplier;
  const runningRentals = activeAgentRentals.filter((rental) => Date.parse(rental.startsAt) <= now && Date.parse(rental.expiresAt) > now);
  const agentTotalZp = runningRentals.reduce((sum, rental) => sum + rental.ratePerSecond * ((Date.parse(rental.expiresAt) - Date.parse(rental.startsAt)) / 1000), 0);
  const agentRemainingZp = runningRentals.reduce((sum, rental) => sum + rental.ratePerSecond * ((Date.parse(rental.expiresAt) - now) / 1000), 0);
  const agentRate = runningRentals.reduce((sum, rental) => sum + rental.ratePerSecond, 0);
  const agentMode = runningRentals.length > 0;
  const totalCycleZp = agentMode ? agentTotalZp : cycleFragments.length * cycleRate * (miningSessionMs / 1000);
  const remainingCycleZp = agentMode
    ? agentRemainingZp
    : miningEnabled
      ? cycleFragments.reduce((total, id) => {
          const remainingMs = Math.max(0, Math.min(miningSessionMs, miningUntil[id] - now));
          return total + cycleRate * (remainingMs / 1000);
        }, 0)
      : totalCycleZp;
  const displayedRate = agentMode ? agentRate : cycleRate;
  const cycleProgress = totalCycleZp > 0 ? Math.max(0, Math.min(100, (remainingCycleZp / totalCycleZp) * 100)) : 0;
  const activeMiningCount = cycleFragments.filter((id) => miningUntil[id] > now).length;
  const miningPaused = !miningEnabled || miningPausedByRental;

  return (
    <div className="rounded-xl border-2 border-emerald-400/45 bg-gradient-to-br from-emerald-950/70 via-black/70 to-cyan-950/40 p-4 shadow-[0_0_18px_rgba(16,185,129,0.12)]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
            <p className="font-mono text-[9px] font-bold uppercase tracking-wider text-emerald-300">ZP mining capacity</p>
            <p className="mt-1 text-[10px] text-emerald-100/75">
              {agentMode
                ? `${runningRentals.length} mining agent${runningRentals.length === 1 ? '' : 's'} generating ZP · fragments paused`
                : cycleFragments.length === 0
                  ? 'Rent a mining agent or fix a fragment to load ZP capacity'
                  : miningPaused
                    ? miningPausedByRental ? 'Fragment rewards paused while an agent is active' : 'Fragment mining paused by Admin'
                    : `${activeMiningCount} fragment${activeMiningCount === 1 ? '' : 's'} contributing to this cycle`}
            </p>
          </div>
        <div className="shrink-0 text-right">
            <p className="font-display text-lg font-bold tabular-nums text-emerald-200">{formatZp(remainingCycleZp)} <span className="text-[9px] font-mono text-emerald-400">ZP LEFT</span></p>
            <p className="font-mono text-[9px] text-emerald-500">of {formatZp(totalCycleZp)} ZP</p>
          </div>
      </div>
      <div
        className="mt-3 h-4 overflow-hidden rounded-full border border-emerald-300/30 bg-black/80"
          role="progressbar"
          aria-label="Remaining ZP in the active mining capacity"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(cycleProgress)}
        >
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-emerald-300 to-cyan-300 shadow-[0_0_12px_rgba(52,211,153,0.35)] transition-[width] duration-1000 ease-linear"
            style={{ width: String(cycleProgress) + '%' }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[9px] text-emerald-500">
          <span>{agentMode ? `+${displayedRate.toFixed(2)} ZP/sec · rental agents` : cycleFragments.length > 0 ? `+${cycleRate.toFixed(2)} ZP/sec per fragment` : 'No active mining cycle'}</span>
          <span>{agentMode || cycleFragments.length > 0 ? `${Math.round(cycleProgress)}% remaining` : '0% loaded'}</span>
        </div>
    </div>
  );
}
