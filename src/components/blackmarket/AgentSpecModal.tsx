import { AGENTS, VAULT_ADDRESS } from '@/lib/game/config';
import type { AgentId } from '@/lib/game/config';
import { isAgentActive } from '@/lib/game/state';
import type { GameState } from '@/lib/game/state';
import { formatRate, formatRemaining, formatTon, truncateAddress } from '@/lib/format';
import type { GameActions } from '@/hooks/useGame';
import type { Notify } from '@/hooks/useToast';
import Modal from '@/components/Modal';

interface AgentSpecModalProps {
  agentId: AgentId;
  state: GameState;
  actions: GameActions;
  notify: Notify;
  onGoToVault: () => void;
  onClose: () => void;
}

export default function AgentSpecModal({ agentId, state, actions, notify, onGoToVault, onClose }: AgentSpecModalProps) {
  const spec = AGENTS[agentId];
  const now = Date.now();
  const active = isAgentActive(state, agentId, now);
  const { connected, tonBalance } = state.wallet;
  const canAfford = tonBalance >= spec.priceTon;

  const rows = [
    { label: 'Output', value: `+${formatRate(spec.iqPerSec)} IQ/sec` },
    {
      label: 'Network kickback',
      value: spec.kickbackMultiplier > 1 ? `x${spec.kickbackMultiplier} (+200%)` : 'Standard (10%)',
    },
    { label: 'Duration', value: `${spec.durationDays} days` },
    { label: 'Price', value: `${formatTon(spec.priceTon)} TON` },
    { label: 'Status', value: active ? `Online, ${formatRemaining(state.agents[agentId] - now)} left` : 'Offline' },
  ];

  const handleRent = () => {
    actions.rentAgent(agentId);
    notify(`${spec.name} rented for ${spec.durationDays} days`);
    onClose();
  };

  return (
    <Modal title="Telemetry Specification" onClose={onClose}>
      <div className="space-y-5">
        <div>
          <p className="label">Hash-agent</p>
          <h3 className="mt-1 font-display text-base font-bold uppercase tracking-wide text-neon-300">{spec.name}</h3>
          <p className="mt-2 font-mono text-xs leading-relaxed text-neon-500">{spec.summary}</p>
        </div>

        <dl className="divide-y divide-neon/15 overflow-hidden rounded-lg border border-neon/20 bg-black/40">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="font-mono text-[11px] uppercase tracking-wider text-neon-500">{row.label}</dt>
              <dd className="text-right font-mono text-xs tabular-nums text-neon-300">{row.value}</dd>
            </div>
          ))}
        </dl>

        <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-4 py-3 font-mono text-[11px] leading-relaxed text-amber-200">
          {connected ? (
            <>
              Paying from vault {truncateAddress(VAULT_ADDRESS)}. Balance {formatTon(tonBalance)} TON.
            </>
          ) : (
            'Link your TON vault in the Vault tab to rent this agent.'
          )}
        </div>

        {!connected ? (
          <button type="button" onClick={onGoToVault} className="btn-primary w-full">
            Link TON vault
          </button>
        ) : (
          <button
            type="button"
            onClick={handleRent}
            disabled={!canAfford}
            className="btn-primary w-full"
          >
            {!canAfford
              ? 'Insufficient TON'
              : `${active ? 'Extend rental' : 'Confirm rental'} // ${formatTon(spec.priceTon)} TON`}
          </button>
        )}
      </div>
    </Modal>
  );
}
