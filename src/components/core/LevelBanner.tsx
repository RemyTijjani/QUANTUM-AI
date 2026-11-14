import { Gauge } from 'lucide-react';
import { TIER_SIZE } from '@/lib/game/config';
import type { tierInfo } from '@/lib/game/state';
import { formatZp, formatRate } from '@/lib/format';

interface LevelBannerProps {
  tier: ReturnType<typeof tierInfo>;
  rate: number;
}

export default function LevelBanner({ tier, rate }: LevelBannerProps) {
  return (
    <section className="panel overflow-hidden p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label">Game tier · simulation</p>
          <p className="mt-1 font-display text-3xl font-bold tabular-nums text-neon-400 glow-text">
            {String(tier.tier).padStart(2, '0')}
          </p>
        </div>
        <div className="text-right">
          <p className="label">Operative rank</p>
          <p className="mt-1 font-display text-sm font-bold uppercase tracking-wider text-neon-300">{tier.rank}</p>
        </div>
      </div>

      <div className="mt-5">
        <div className="bar">
          <div className="bar-fill" style={{ width: `${tier.progress * 100}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between font-mono text-[11px] tabular-nums text-neon-500">
          <span>
            {formatZp(tier.intoTier)} / {formatZp(TIER_SIZE)} ZP
          </span>
          <span>{formatZp(tier.toNext)} ZP to Tier {String(tier.tier + 1).padStart(2, '0')}</span>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-neon/15 pt-4 font-mono text-[11px] uppercase tracking-wider text-neon-400">
        <Gauge size={14} />
        <span>Estimated game rate</span>
        <span className="ml-auto tabular-nums text-neon-300">{formatRate(rate)} ZP/SEC</span>
      </div>
    </section>
  );
}
