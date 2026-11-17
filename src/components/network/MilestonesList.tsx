import { Gift } from 'lucide-react';
import { MILESTONES } from '@/lib/game/config';
import { formatZp } from '@/lib/format';

interface MilestonesListProps {
  subNodeCount: number;
}

export default function MilestonesList({ subNodeCount }: MilestonesListProps) {
  return (
    <div className="min-w-0 space-y-3">
      {MILESTONES.map((milestone) => {
        const reached = subNodeCount >= milestone.threshold;
        const progress = Math.min(1, subNodeCount / milestone.threshold) * 100;
        return (
          <div key={milestone.threshold} className="panel flex min-w-0 items-start gap-3 p-3 sm:items-center sm:gap-4 sm:p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neon/30 text-neon-500 sm:h-11 sm:w-11">
              <Gift size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <h3 className="min-w-0 font-display text-xs font-bold uppercase tracking-wide text-neon-300">
                  {milestone.threshold} Referrals
                </h3>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-neon-400">+{formatZp(milestone.reward)} ZP</span>
              </div>
              <div className="bar mt-2.5">
                <div className="bar-fill" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-1.5 font-mono text-[10px] tabular-nums text-neon-500">
                {Math.min(subNodeCount, milestone.threshold)} / {milestone.threshold} operatives
              </p>
              <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-amber-300">
                {reached ? 'Threshold reached · payout not enabled' : 'Progress · payout not enabled'}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
