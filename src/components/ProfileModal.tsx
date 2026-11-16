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
  verifiedZpBalance: number | null;
  verifiedZpLifetime: number | null;
  onReset: () => void;
  onClose: () => void;
}

export default function ProfileModal({ state, identity, verifiedZpBalance, verifiedZpLifetime, onReset, onClose }: ProfileModalProps) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const now = Date.now();
  const tier = tierInfo(state.lifetimeZp);
  const rentals = activeAgents(state, now);
  const displayName = identity?.firstName
    ? identity.username
      ? `${identity.firstName} · @${identity.username}`
      : identity.firstName
    : identity?.username
      ? `@${identity.username}`
      : 'Unnamed operative';

  return (
    <Modal title="Operative Profile" onClose={onClose}>
      <div className="space-y-6">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-neon/50 bg-neon/10 text-neon-400 shadow-glow">
            <User size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="label">Operative rank</p>
            <h3 className="mt-1 font-display text-base font-bold uppercase tracking-wide text-neon-300">
              {tier.rank}
            </h3>
            <p className="mt-1 break-words font-mono text-xs text-neon-300">{displayName}</p>
            <p className="font-mono text-[11px] text-neon-500">ZORD Tier {String(tier.tier).padStart(2, '0')}</p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-2 sm:gap-3">
          <Stat label="Game ZP balance" value={formatZp(state.zp)} />
          <Stat label="Verified ZP balance" value={verifiedZpBalance === null ? 'Unavailable' : formatZp(verifiedZpBalance)} />
          <Stat label="Estimated passive ZP/sec" value={formatRate(passiveRate(state, now))} />
          <Stat label="Fragments connected" value={`${fixedCount(state)} / ${FRAGMENT_IDS.length}`} />
          <Stat label="Lifetime game ZP" value={formatZp(state.lifetimeZp)} />
          <Stat label="Verified lifetime ZP" value={verifiedZpLifetime === null ? 'Unavailable' : formatZp(verifiedZpLifetime)} />
        </dl>

        <section className="space-y-2">
          <p className="label">Active hash-agents</p>
          {rentals.length === 0 ? (
            <p className="rounded-lg border border-neon/15 bg-black/40 px-4 py-3 font-mono text-[11px] text-neon-500">
              No active agents at the moment.
            </p>
          ) : (
            <ul className="space-y-2">
              {rentals.map((id) => (
                <li
                  key={id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-neon/25 bg-neon/5 px-4 py-3"
                >
                  <span className="min-w-0 break-words font-display text-xs font-bold uppercase tracking-wide text-neon-300">
                    {AGENTS[id].name}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-neon-400">
                    {formatRemaining(Math.max(state.agents[id], id === 'alpha' ? state.temporaryAgentUntil : 0) - now)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3 border-t border-red-500/25 pt-5">
          <p className="label !text-red-300/80">System utilities</p>
          <p className="font-mono text-xs leading-relaxed text-neon-400">
            Resets the legacy game save, including its game ZP balance and local game stats. It does not erase server-verified ZP, wallet transactions, or server-owned Fragment records.
          </p>
          {confirmingReset ? (
            <div className="space-y-3 rounded-lg border border-red-500/35 bg-red-500/5 p-3">
              <p className="font-mono text-xs leading-relaxed text-red-200" role="alert">
                This local reset cannot be undone. Server-owned balances and records will remain unchanged.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingReset(false)}
                  className="min-h-11 rounded-lg border border-neon/30 bg-transparent px-3 py-2 font-display text-xs font-bold uppercase tracking-wide text-neon-300 transition hover:bg-neon/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onReset}
                  className="min-h-11 rounded-lg border border-red-500/60 bg-red-500/15 px-3 py-2 font-display text-xs font-bold uppercase tracking-wide text-red-200 transition hover:bg-red-500/25"
                >
                  Confirm local reset
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingReset(true)}
              className="min-h-11 w-full rounded-lg border border-red-500/60 bg-red-500/10 px-4 py-2.5 font-display text-xs font-bold uppercase tracking-[0.12em] text-red-300 transition duration-200 hover:bg-red-500/20 active:scale-[0.98]"
            >
              <RotateCcw size={14} className="mr-2 inline" />
              Reset local game progress
            </button>
          )}
        </section>
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-neon/15 bg-black/40 px-3 py-3">
      <dt className="break-words font-mono text-xs uppercase tracking-wide text-neon-400">{label}</dt>
      <dd className="mt-1 break-words font-display text-sm font-bold tabular-nums text-neon-300">{value}</dd>
    </div>
  );
}
