import { Cpu, Lock, LockOpen } from 'lucide-react';
import { FRAGMENT_IDS } from '@/lib/game/config';
import type { FragmentId } from '@/lib/game/config';
import type { FragmentStatus } from '@/lib/game/state';
import { formatRate } from '@/lib/format';
import FaIcon from '@/components/FaIcon';
import { FRAGMENT_ICON } from '@/components/core/fragmentVisuals';

// Paths run from each logo node inward to the chip, so the signal flows toward the core.
const TRACE_PATH: Record<FragmentId, string> = {
  top: 'M50 14 V36',
  bottom: 'M50 86 V64',
  left: 'M14 50 H36',
  right: 'M86 50 H64',
};

const NODE_POSITION: Record<FragmentId, string> = {
  top: 'left-1/2 top-[14%]',
  bottom: 'left-1/2 top-[86%]',
  left: 'left-[14%] top-1/2',
  right: 'left-[86%] top-1/2',
};

const NODE_STYLE: Record<FragmentStatus, string> = {
  locked: 'border-dashed border-neon/40 bg-black/80 text-neon-600',
  unlocked: 'border-cyan-400/80 bg-cyan-400/10 text-cyan-300 animate-soft-pulse',
  fixed: 'border-yellow-500 bg-yellow-500/15 text-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.4)]',
};

interface CoreCircuitProps {
  fragments: Record<FragmentId, FragmentStatus>;
  rate: number;
}

export default function CoreCircuit({ fragments, rate }: CoreCircuitProps) {
  return (
    <section className="panel mx-auto w-full max-w-[360px] p-4">
      <div className="relative aspect-square w-full">
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
          {FRAGMENT_IDS.map((id) => (
            <path
              key={`ghost-${id}`}
              d={TRACE_PATH[id]}
              fill="none"
              stroke="rgba(34,197,94,0.22)"
              strokeWidth={1}
              strokeLinecap="round"
            />
          ))}
          {FRAGMENT_IDS.filter((id) => fragments[id] === 'fixed').map((id) => (
            <path
              key={`glow-${id}`}
              d={TRACE_PATH[id]}
              fill="none"
              stroke="rgba(234,179,8,0.4)"
              strokeWidth={4}
              strokeLinecap="round"
              className="blur-[2px]"
            />
          ))}
          {FRAGMENT_IDS.filter((id) => fragments[id] === 'fixed').map((id) => (
            <path
              key={`live-${id}`}
              d={TRACE_PATH[id]}
              pathLength={100}
              fill="none"
              stroke="#eab308"
              strokeWidth={1.6}
              strokeLinecap="round"
              className="trace-live"
            />
          ))}
        </svg>

        {FRAGMENT_IDS.map((id) => {
          const status = fragments[id];
          const icon =
            status === 'locked' ? (
              <Lock size={14} />
            ) : status === 'unlocked' ? (
              <LockOpen size={14} />
            ) : (
              <FaIcon name={FRAGMENT_ICON[id]} size={14} />
            );
          return (
            <div
              key={id}
              aria-hidden
              className={`absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border transition duration-500 ${NODE_POSITION[id]} ${NODE_STYLE[status]}`}
            >
              {icon}
            </div>
          );
        })}

        <div className="absolute left-1/2 top-1/2 flex aspect-square w-[28%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-xl border border-neon bg-[#06140b] shadow-glow">
          <div className="absolute -inset-[14%] animate-spin-slow rounded-full border border-dashed border-neon/40" />
          <Cpu size={26} className="text-neon-400 animate-soft-pulse" />
          <span className="mt-1 font-display text-[9px] font-bold uppercase tracking-[0.18em] text-neon-400">ZP Core</span>
          <span className="font-mono text-[10px] tabular-nums text-neon-500">+{formatRate(rate)}/s</span>
        </div>
      </div>
    </section>
  );
}
