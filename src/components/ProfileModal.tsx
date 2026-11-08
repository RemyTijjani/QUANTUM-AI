import { useState } from 'react';
import { RotateCcw, User } from 'lucide-react';
import { AGENTS, FRAGMENT_IDS } from '@/lib/game/config';
import { activeAgents, fixedCount, passiveRate, tierInfo } from '@/lib/game/state';
import type { GameState } from '@/lib/game/state';
import { formatZp, formatRate, formatRemaining } from '@/lib/format';
import Modal from '@/components/Modal';

export interface ProfileIdentity {
  firstName: string | null;
  username: string | null;
}

interface ProfileModalProps {
  state: GameState;
  identity: ProfileIdentity | null;
  onReset: () => void;
  onClose: () => void;
}

export default function ProfileModal({ state, identity, onReset, onClose }: ProfileModalProps) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const now = Date.now();
  const tier = tierInfo(state.lifetimeZp);
  const rentals = activeAgents(state, now);
  const displayName = identity?.username
    ? `@${identity.username}`
    : identity?.firstName ?? 'Unnamed operative';

  return (
    <Modal title="Operative Profile" onClose={onClose}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-neon/50 bg-neon/10 text-neon-400 shadow-glow">
            <User size={26} />
          </div>
          <div>
            <p className="label">Operative rank</p>
            <h3 className="mt-1 font-display text-base font-bold uppercase tracking-wide text-neon-300">
              {tier.rank}
            </h3>
            <p className="mt-1 font-mono text-[11px] text-neon-300">{displayName}</p>
            <p className="font-mono text-[11px] text-neon-500">ZORD Tier {String(tier.tier).padStart(2, '0')}</p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-2">
          <Stat label="Total ZP balance" value={formatZp(state.zp)} />
          <Stat label="Passive ZP/sec" value={formatRate(passiveRate(state, now))} />
          <Stat label="Fragments connected" value={`${fixedCount(state)} / ${FRAGMENT_IDS.length}`} />
          <Stat label="Lifetime ZP" value={formatZp(state.lifetimeZp)} />
        </dl>

        <section className="space-y-2">
          <p className="label">Active hash-agents</p>
          {rentals.length === 0 ? (
            <p className="rounded-lg border border-neon/15 bg-black/40 px-4 py-3 font-mono text-[11px] text-neon-500">
              No agents online. ZORD Agents are coming soon.
            </p>
          ) : (
            <ul className="space-y-2">
              {rentals.map((id) => (
                <li
                  key={id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-neon/25 bg-neon/5 px-4 py-3"
                >
                  <span className="font-display text-[11px] font-bold uppercase tracking-wide text-neon-300">
                    {AGENTS[id].name}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-neon-400">
                    {formatRemaining(state.agents[id] - now)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3 border-t border-red-500/25 pt-5">
          <p className="label !text-red-300/80">System utilities</p>
          <p className="font-mono text-[11px] leading-relaxed text-neon-500">
            Wipes ZP, fragments, rentals, sub-nodes and vault link. This cannot be undone.
          </p>
          <button
            type="button"
            onClick={() => (confirmingReset ? onReset() : setConfirmingReset(true))}
            className="w-full rounded-lg border border-red-500/60 bg-red-500/10 px-4 py-2.5 font-display text-[11px] font-bold uppercase tracking-[0.16em] text-red-300 transition duration-200 hover:bg-red-500/20 active:scale-[0.98]"
          >
            <RotateCcw size={14} className="mr-2 inline" />
            {confirmingReset ? 'Confirm wipe' : 'Reset system memory'}
          </button>
        </section>
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neon/15 bg-black/40 px-3 py-3">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-neon-500">{label}</dt>
      <dd className="mt-1 font-display text-sm font-bold tabular-nums text-neon-300">{value}</dd>
    </div>
  );
}
