import { useState } from 'react';
import type { ReactNode } from 'react';
import { Activity, Cpu, RotateCcw, ShieldCheck, User, Wallet, Zap } from 'lucide-react';
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
      <div className="space-y-5">
        <section className="relative overflow-hidden rounded-2xl border border-neon/30 bg-gradient-to-br from-neon/15 via-[#07130c] to-black p-4 shadow-[inset_0_1px_0_rgba(134,239,172,0.08)]">
          <div className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-neon/10 blur-3xl" />
          <div className="relative flex min-w-0 items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-neon/40 bg-black/50 text-neon-300 shadow-glow">
              <User size={25} strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-neon/30 bg-neon/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-neon-300">
                  Tier {String(tier.tier).padStart(2, '0')}
                </span>
                <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-neon-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-neon-400 shadow-[0_0_7px_rgba(74,222,128,0.8)]" />
                  Operative profile
                </span>
              </div>
              <h3 className="break-words font-display text-lg font-bold leading-tight text-white">{displayName}</h3>
              <p className="mt-1 break-words font-mono text-xs text-neon-300">{tier.rank}</p>
            </div>
          </div>
          <div className="relative mt-4 flex items-center justify-between gap-3 border-t border-neon/15 pt-3">
            <span className="font-mono text-[11px] text-neon-500">Current standing</span>
            <span className="font-display text-xs font-bold uppercase tracking-wider text-neon-300">{tier.rank}</span>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-xs font-bold uppercase tracking-[0.14em] text-white">Wallet overview</h3>
              <p className="mt-0.5 font-mono text-[11px] text-neon-500">Game and server-verified balances</p>
            </div>
            <Wallet size={17} className="text-neon-400" />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <BalanceCard
              label="Game ZP"
              value={formatZp(state.zp)}
              icon={<Zap size={15} />}
              detail="Local game balance"
            />
            <BalanceCard
              label="Verified ZP"
              value={verifiedZpBalance === null ? 'Unavailable' : formatZp(verifiedZpBalance)}
              icon={<ShieldCheck size={15} />}
              detail="Server-confirmed"
              featured
            />
          </div>
        </section>

        <section className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-xs font-bold uppercase tracking-[0.14em] text-white">Operative statistics</h3>
            <Activity size={16} className="text-neon-400" />
          </div>
          <dl className="grid grid-cols-2 gap-2">
            <Stat label="Passive rate" value={formatRate(passiveRate(state, now))} detail="Estimated ZP / sec" />
            <Stat label="Fragments" value={`${fixedCount(state)} / ${FRAGMENT_IDS.length}`} detail="Connected" />
            <Stat label="Game lifetime" value={formatZp(state.lifetimeZp)} detail="Lifetime game ZP" />
            <Stat label="Verified lifetime" value={verifiedZpLifetime === null ? 'Unavailable' : formatZp(verifiedZpLifetime)} detail="Server-recorded ZP" />
          </dl>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-xs font-bold uppercase tracking-[0.14em] text-white">Active hash-agents</h3>
              <p className="mt-0.5 font-mono text-[11px] text-neon-500">Your currently running agents</p>
            </div>
            <Cpu size={17} className="text-neon-400" />
          </div>
          {rentals.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-neon-500">
                <Cpu size={17} />
              </div>
              <div className="min-w-0">
                <p className="font-display text-xs font-semibold text-neon-300">No active agents</p>
                <p className="mt-0.5 font-mono text-[11px] text-neon-500">Your agent slots are currently idle.</p>
              </div>
            </div>
          ) : (
            <ul className="space-y-2">
              {rentals.map((id) => (
                <li key={id} className="flex min-w-0 items-center gap-3 rounded-xl border border-neon/20 bg-neon/[0.045] px-3 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neon/20 bg-black/40 text-neon-300">
                    <Cpu size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-display text-xs font-bold uppercase tracking-wide text-neon-200">{AGENTS[id].name}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-neon-500">Active rental</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-neon/20 bg-black/30 px-2 py-1 font-mono text-[11px] tabular-nums text-neon-300">
                    {formatRemaining(Math.max(state.agents[id], id === 'alpha' ? state.temporaryAgentUntil : 0) - now)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3 border-t border-red-500/20 pt-4">
          <div className="flex items-center gap-2">
            <RotateCcw size={15} className="text-red-300" />
            <h3 className="font-display text-xs font-bold uppercase tracking-[0.14em] text-red-200">Local game reset</h3>
          </div>
          <p className="font-mono text-xs leading-relaxed text-neon-400">
            Resets the legacy game save, including its game ZP balance and local game stats. Server-verified ZP, wallet transactions, and server-owned Fragment records are not erased.
          </p>
          {confirmingReset ? (
            <div className="space-y-3 rounded-xl border border-red-500/35 bg-red-500/[0.06] p-3">
              <p className="font-mono text-xs leading-relaxed text-red-100" role="alert">
                This local reset cannot be undone. Server-owned balances and records will remain unchanged.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingReset(false)}
                  className="min-h-11 rounded-lg border border-white/15 bg-white/5 px-3 py-2 font-display text-xs font-bold uppercase tracking-wide text-neon-200 transition hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onReset}
                  className="min-h-11 rounded-lg border border-red-500/60 bg-red-500/15 px-3 py-2 font-display text-xs font-bold uppercase tracking-wide text-red-100 transition hover:bg-red-500/25"
                >
                  Confirm reset
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingReset(true)}
              className="min-h-11 w-full rounded-xl border border-red-500/40 bg-red-500/[0.06] px-4 py-2.5 font-display text-xs font-bold uppercase tracking-[0.1em] text-red-200 transition hover:border-red-400/60 hover:bg-red-500/10"
            >
              Reset local game progress
            </button>
          )}
        </section>
      </div>
    </Modal>
  );
}

function BalanceCard({ label, value, icon, detail, featured = false }: { label: string; value: string; icon: ReactNode; detail: string; featured?: boolean }) {
  return (
    <div className={`min-w-0 rounded-xl border p-3 ${featured ? 'border-neon/35 bg-neon/[0.08]' : 'border-white/10 bg-white/[0.025]'}`}>
      <div className="flex items-center gap-1.5 text-neon-400">
        {icon}
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-2 break-words font-display text-lg font-bold leading-tight tabular-nums text-white">{value}</p>
      <p className="mt-1 break-words font-mono text-[10px] text-neon-500">{detail}</p>
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-3">
      <dt className="break-words font-mono text-[10px] font-semibold uppercase tracking-wider text-neon-400">{label}</dt>
      <dd className="mt-1 break-words font-display text-sm font-bold tabular-nums text-white">{value}</dd>
      <p className="mt-0.5 break-words font-mono text-[10px] text-neon-500">{detail}</p>
    </div>
  );
}
