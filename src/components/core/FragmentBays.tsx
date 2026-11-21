import { Check } from 'lucide-react';
import FaIcon from '@/components/FaIcon';
import { CORE_SESSION_HOURS, FRAGMENT_IDS, FRAGMENT_ZP_PER_SEC, FRAGMENT_NAMES } from '@/lib/game/config';
import { formatCooldown, formatZp } from '@/lib/format';
import type { FragmentId } from '@/lib/game/config';
import type { FragmentStatus } from '@/lib/game/state';
import type { VerifiedAgentRental } from '@/lib/economy/verifiedEconomy';
import { FRAGMENT_ICON, STATUS_LABEL } from '@/components/core/fragmentVisuals';

const BAY_STYLE: Record<FragmentStatus, string> = {
  locked: 'border-dashed border-neon/35 bg-black/60 text-neon-500 hover:border-neon/60 hover:text-neon-400',
  unlocked: 'border-cyan-400/70 bg-cyan-400/10 text-cyan-300 shadow-[0_0_14px_rgba(34,211,238,0.25)] hover:bg-cyan-400/20',
  fixed: 'border-yellow-500 bg-yellow-500/10 text-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.4)] hover:bg-yellow-500/20',
};

interface FragmentBaysProps {
  fragments: Record<FragmentId, FragmentStatus>;
  cooldowns: Record<FragmentId, number>;
  miningUntil: Record<FragmentId, number>;
  miningEnabled: boolean;
  miningPausedByRental: boolean;
  activeAgentRentals: VerifiedAgentRental[];
  rateMultiplier: number;
  now: number;
  onFragmentPress: (id: FragmentId) => void;
}

export default function FragmentBays({ fragments, cooldowns, miningUntil, miningEnabled, miningPausedByRental, activeAgentRentals, rateMultiplier, now, onFragmentPress }: FragmentBaysProps) {
  const miningSessionMs = CORE_SESSION_HOURS * 60 * 60 * 1000;
  const cycleFragments = FRAGMENT_IDS.filter((id) =>
    fragments[id] === 'fixed' && miningUntil[id] > 0
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
    <section className="space-y-3">
      <div className="px-1">
        <p className="label">Fragment bays</p>
        <h2 className="title mt-1">Missing pieces</h2>
      </div>
      <div className="rounded-xl border border-emerald-400/25 bg-emerald-950/20 p-3">
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
          className="mt-3 h-3 overflow-hidden rounded-full border border-emerald-300/15 bg-black/60"
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
      <div className="grid grid-cols-2 gap-3">
        {FRAGMENT_IDS.map((id) => (
          <FragmentBay
            key={id}
            id={id}
            status={fragments[id]}
            cooldownRemaining={Math.max(0, cooldowns[id] - now)}
            miningRemaining={Math.max(0, miningUntil[id] - now)}
            miningEnabled={miningEnabled}
            miningPausedByRental={miningPausedByRental}
            rateMultiplier={rateMultiplier}
            onPress={() => onFragmentPress(id)}
          />
        ))}
      </div>
    </section>
  );
}

function FragmentBay({
  id,
  status,
  cooldownRemaining,
  miningRemaining,
  miningEnabled,
  miningPausedByRental,
  rateMultiplier,
  onPress,
}: {
  id: FragmentId;
  status: FragmentStatus;
  cooldownRemaining: number;
  miningRemaining: number;
  miningEnabled: boolean;
  miningPausedByRental: boolean;
  rateMultiplier: number;
  onPress: () => void;
}) {
  const cooldownActive = cooldownRemaining > 0;
  const miningActive = status === 'fixed' && miningRemaining > 0;
  const expiredFixed = status === 'fixed' && !miningActive;
  const visualStatus: FragmentStatus = expiredFixed ? 'locked' : status;
  const label = !miningEnabled
    ? 'Global mining paused'
    : miningActive && miningPausedByRental
      ? `Agent active · ${formatCooldown(miningRemaining)}`
      : miningActive
        ? `Mining · ${formatCooldown(miningRemaining)}`
        : cooldownActive
          ? `Cooldown · ${formatCooldown(cooldownRemaining)}`
          : expiredFixed
            ? 'Tap to reactivate'
            : STATUS_LABEL[status];

  return (
    <button
      type="button"
      onClick={onPress}
      disabled={cooldownActive || !miningEnabled}
      aria-label={`${FRAGMENT_NAMES[id]}: ${label}`}
      className={`relative flex min-h-[112px] flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center transition duration-500 active:scale-95 ${BAY_STYLE[visualStatus]} ${
        status === 'unlocked' && !cooldownActive ? 'animate-soft-pulse' : ''
      } ${cooldownActive || !miningEnabled ? 'cursor-not-allowed opacity-80' : ''}`}
    >
      {status === 'fixed' && miningActive && <Check size={14} className="absolute right-2 top-2" />}
      <FaIcon name={FRAGMENT_ICON[id]} size={22} />
      <span className="font-display text-[10px] font-bold uppercase leading-tight tracking-wider">
        {FRAGMENT_NAMES[id]}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-wider opacity-90">{label}</span>
      {status === 'fixed' && miningActive && miningEnabled && !miningPausedByRental && (
        <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-yellow-500/90">
          +{(FRAGMENT_ZP_PER_SEC * rateMultiplier).toFixed(2)} ZP/sec
        </span>
      )}
    </button>
  );
}
