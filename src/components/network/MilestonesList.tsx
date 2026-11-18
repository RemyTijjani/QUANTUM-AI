import { CheckCircle2, Gift, LockKeyhole } from 'lucide-react';
import type { ReferralMilestone } from '@/lib/economy/referralMilestones';

interface MilestonesListProps {
  referralCount: number;
  milestones: ReferralMilestone[];
  claimingThreshold: number | null;
  onClaim: (threshold: number) => void;
}

export default function MilestonesList({
  referralCount,
  milestones,
  claimingThreshold,
  onClaim,
}: MilestonesListProps) {
  return (
    <div className="min-w-0 space-y-3">
      {milestones.map((milestone) => {
        const reached = milestone.reached;
        const claimed = Boolean(milestone.claimedAt);
        const progress = Math.min(1, referralCount / milestone.threshold) * 100;
        const remaining = Math.max(0, milestone.threshold - referralCount);
        return (
          <div key={milestone.threshold} className="panel flex min-w-0 items-start gap-3 p-3 sm:items-center sm:gap-4 sm:p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neon/30 text-neon-500 sm:h-11 sm:w-11">
              {claimed ? <CheckCircle2 size={20} /> : reached ? <Gift size={20} /> : <LockKeyhole size={19} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <h3 className="min-w-0 font-display text-xs font-bold uppercase tracking-wide text-neon-300">
                  {milestone.threshold} Referrals
                </h3>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-neon-400">
                  +{milestone.rewardZap} ZAP
                </span>
              </div>
              <div className="bar mt-2.5">
                <div className="bar-fill" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-1.5 font-mono text-[10px] tabular-nums text-neon-500">
                {Math.min(referralCount, milestone.threshold)} / {milestone.threshold} verified referrals
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className={`font-mono text-[9px] uppercase tracking-wider ${claimed ? 'text-emerald-300' : reached ? 'text-neon-300' : 'text-neon-600'}`}>
                  {claimed ? 'Reward claimed' : reached ? 'Milestone reached · ready to claim' : `${remaining} more referrals needed`}
                </p>
                {reached && !claimed && (
                  <button
                    type="button"
                    onClick={() => onClaim(milestone.threshold)}
                    disabled={claimingThreshold !== null}
                    className="btn-cyan min-h-9 px-3 text-[10px] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {claimingThreshold === milestone.threshold ? 'Claiming...' : `Claim ${milestone.rewardZap} ZAP`}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
