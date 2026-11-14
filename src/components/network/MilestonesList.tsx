import { Gift } from 'lucide-react';
import { MILESTONES } from '@/lib/game/config';
import { formatZp } from '@/lib/format';

interface MilestonesListProps {
  subNodeCount: number;
}

export default function MilestonesList({ subNodeCount }: MilestonesListProps) {
  return (
    <div className="space-y-3">
      {MILESTONES.map((milestone) => {
        const reached = subNodeCount >= milestone.threshold;
        const progress = Math.min(1, subNodeCount / milestone.threshold) * 100;
        return (
          <div key={milestone.threshold} className="panel flex items-center gap-4 p-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-neon/30 text-neon-500">
              <Gift size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-xs font-bold uppercase tracking-wide text-neon-300">
                  {milestone.threshold} Referrals
                </h3>
                <span className="font-mono text-[11px] tabular-nums text-neon-400">+{formatZp(milestone.reward)} ZP</span>
              </div>
              <div className="bar mt-2.5">
                <div className="bar-fill" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-1.5 font-mono text-[10px] tabular-nums text-neon-500">
                {Math.min(subNodeCount, milestone.threshold)} / {milestone.threshold} operatives
              </p>
              <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-amber-300">
                {reached ? 'Threshold reached · verification pending' : 'Progress · reward not yet enabled'}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
