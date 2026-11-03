import { useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Flame, Pickaxe } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  AGENTS,
  AGENT_IDS,
  FRAGMENT_IDS,
  FRAGMENT_IQ_PER_SEC,
  FRAGMENT_NAMES,
} from '@/lib/game/config';
import type { AgentId, FragmentId } from '@/lib/game/config';
import { fixedCount, fragmentCooldownRemaining, isAgentActive } from '@/lib/game/state';
import { FRAGMENT_ICON } from '@/components/core/fragmentVisuals';
import type { FragmentStatus, GameState } from '@/lib/game/state';
import { formatCooldown, formatRemaining, formatRate, formatTon } from '@/lib/format';
import type { GameActions } from '@/hooks/useGame';
import type { Notify } from '@/hooks/useToast';
import AgentSpecModal from '@/components/blackmarket/AgentSpecModal';
import FaIcon from '@/components/FaIcon';

const AGENT_ICON: Record<AgentId, LucideIcon> = {
  alpha: Pickaxe,
  overclock: Flame,
};

interface BlackmarketTabProps {
  state: GameState;
  actions: GameActions;
  notify: Notify;
  onWatchAd: (id: FragmentId) => void;
  onGoToVault: () => void;
}

export default function BlackmarketTab({ state, actions, notify, onWatchAd, onGoToVault }: BlackmarketTabProps) {
  const [selected, setSelected] = useState<AgentId | null>(null);
  const now = Date.now();
  return (
    <div className="space-y-6 pb-2">
      <section className="space-y-3">
        <div className="flex items-end justify-between px-1">
          <div>
            <p className="label">Hash-agent rentals</p>
            <h2 className="title mt-1">Autonomous miners</h2>
          </div>
          <span className="font-mono text-[11px] text-amber-300">Paid in TON</span>
        </div>

        {AGENT_IDS.map((id) => {
          const spec = AGENTS[id];
          const Icon = AGENT_ICON[id];
          const active = isAgentActive(state, id, now);
          return (
            <button
              key={id}
              type="button"
              onClick={() => setSelected(id)}
              className="panel group block w-full p-4 text-left transition duration-200 hover:-translate-y-0.5 hover:border-neon/60 hover:shadow-glow active:scale-[0.99]"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-neon/40 bg-neon/10 text-neon-400 transition group-hover:shadow-glow">
                  <Icon size={22} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display text-sm font-bold uppercase tracking-wide text-neon-300">{spec.name}</h3>
                  </div>
                  <p className="mt-1 font-mono text-[11px] leading-relaxed text-neon-500">{spec.summary}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px]">
                    <Badge>+{formatRate(spec.iqPerSec)} IQ/sec</Badge>
                    {spec.kickbackMultiplier > 1 && <Badge>+200% kickback</Badge>}
                    <Badge tone="amber">{formatTon(spec.priceTon)} TON / {spec.durationDays}d</Badge>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-neon/15 pt-3 font-mono text-[11px] uppercase tracking-wider">
                <span className={active ? 'text-neon-400' : 'text-neon-600'}>
                  {active ? `Online // ${formatRemaining(state.agents[id] - now)} left` : 'Offline'}
                </span>
                <span className="text-neon-400 transition group-hover:translate-x-0.5">View telemetry</span>
              </div>
            </button>
          );
        })}
      </section>

      <section className="space-y-3">
        <div className="px-1">
          <p className="label">Individual acquisitions</p>
          <h2 className="title mt-1">Unique fragments</h2>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {FRAGMENT_IDS.map((id) => (
            <UniqueFragmentCard
              key={id}
              id={id}
              status={state.fragments[id]}
              cooldownRemaining={fragmentCooldownRemaining(state, id, now)}
              onWatchAd={() => onWatchAd(id)}
              onFix={() => {
                actions.fixFragment(id);
                notify(`${FRAGMENT_NAMES[id]} fixed into the circuit. Core mining started`);
              }}
            />
          ))}
        </div>
      </section>

      {selected && (
        <AgentSpecModal
          agentId={selected}
          state={state}
          actions={actions}
          notify={notify}
          onGoToVault={() => {
            setSelected(null);
            onGoToVault();
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function UniqueFragmentCard({
  id,
  status,
  cooldownRemaining,
  onWatchAd,
  onFix,
}: {
  id: FragmentId;
  status: FragmentStatus;
  cooldownRemaining: number;
  onWatchAd: () => void;
  onFix: () => void;
}) {
  const cooldownActive = cooldownRemaining > 0;
  const isLocked = status === 'locked';
  const isFixed = status === 'fixed';
  const action = isLocked ? onWatchAd : onFix;
  const actionLabel = isFixed ? 'Online' : cooldownActive ? formatCooldown(cooldownRemaining) : isLocked ? 'Watch ad' : 'Fix now';

  return (
    <button
      type="button"
      onClick={action}
      disabled={isFixed || cooldownActive}
      className={`panel relative flex min-h-[150px] flex-col items-center justify-center gap-2 p-3 text-center transition duration-200 active:scale-95 ${
        isFixed
          ? 'border-amber-400/70 bg-amber-400/10 text-amber-300 shadow-[0_0_16px_rgba(251,191,36,0.2)]'
          : isLocked
            ? 'border-dashed border-neon/35 text-neon-400 hover:border-neon/70 hover:bg-neon/5'
            : 'border-cyan-400/60 bg-cyan-400/10 text-cyan-300 hover:bg-cyan-400/15'
      } ${cooldownActive ? 'cursor-not-allowed opacity-80' : ''}`}
    >
      {isFixed && <Check size={14} className="absolute right-2 top-2" />}
      <FaIcon name={FRAGMENT_ICON[id]} size={20} />
      <span className="font-display text-[10px] font-bold uppercase leading-tight tracking-wider">{FRAGMENT_NAMES[id]}</span>
      <span className="font-mono text-[10px] uppercase tracking-wider opacity-90">{actionLabel}</span>
      {isFixed && <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-amber-300">+{FRAGMENT_IQ_PER_SEC.toFixed(2)} IQ/sec</span>}
    </button>
  );
}

function Badge({ children, tone = 'green' }: { children: ReactNode; tone?: 'green' | 'amber' }) {
  const style = tone === 'amber' ? 'border-amber-400/40 bg-amber-400/10 text-amber-300' : 'border-neon/30 bg-neon/10 text-neon-300';
  return <span className={`rounded-md border px-2 py-0.5 ${style}`}>{children}</span>;
}

