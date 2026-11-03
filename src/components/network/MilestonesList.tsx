import { Check, Gift } from 'lucide-react';
import { MILESTONES } from '@/lib/game/config';
import { formatIq } from '@/lib/format';

interface MilestonesListProps {
  subNodeCount: number;
  claimed: number[];
  onClaim: (threshold: number) => void;
}

export default function MilestonesList({ subNodeCount, claimed, onClaim }: MilestonesListProps) {
  return (
    <div className="space-y-3">
      {MILESTONES.map((milestone) => {
        const isClaimed = claimed.includes(milestone.threshold);
        const reached = subNodeCount >= milestone.threshold;
        const progress = Math.min(1, subNodeCount / milestone.threshold) * 100;
        return (
          <div key={milestone.threshold} className="panel flex items-center gap-4 p-4">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${
                isClaimed ? 'border-neon bg-neon/20 text-neon-300' : 'border-neon/30 text-neon-500'
              }`}
            >
              {isClaimed ? <Check size={20} /> : <Gift size={20} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-xs font-bold uppercase tracking-wide text-neon-300">
                  {milestone.threshold} Referrals
                </h3>
                <span className="font-mono text-[11px] tabular-nums text-neon-400">+{formatIq(milestone.reward)} IQ</span>
              </div>
              <div className="bar mt-2.5">
                <div className="bar-fill" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-1.5 font-mono text-[10px] tabular-nums text-neon-500">
                {Math.min(subNodeCount, milestone.threshold)} / {milestone.threshold} operatives
              </p>
            </div>
            <button
              type="button"
              onClick={() => onClaim(milestone.threshold)}
              disabled={!reached || isClaimed}
              className="btn-primary shrink-0 px-3 py-2"
            >
              {isClaimed ? 'Claimed' : 'Claim'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
