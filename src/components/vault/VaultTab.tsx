import { Link2, Link2Off, Landmark, Coins, Cpu } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { TON_FAUCET_AMOUNT, VAULT_ADDRESS } from '@/lib/game/config';
import type { GameState } from '@/lib/game/state';
import { formatIq, formatTon, truncateAddress } from '@/lib/format';
import type { GameActions } from '@/hooks/useGame';
import type { Notify } from '@/hooks/useToast';

interface VaultTabProps {
  state: GameState;
  actions: GameActions;
  notify: Notify;
}

export default function VaultTab({ state, actions, notify }: VaultTabProps) {
  const { connected, faucetClaimed, tonBalance } = state.wallet;

  const toggleConnection = () => {
    if (connected) {
      actions.disconnectWallet();
      notify('Vault unlinked. Rentals are paused until you reconnect', 'info');
      return;
    }
    const isFirstLink = !faucetClaimed;
    actions.connectWallet();
    notify(
      isFirstLink
        ? `Vault linked. Testnet faucet credited ${TON_FAUCET_AMOUNT} TON`
        : 'Vault linked to ROKO OS',
    );
  };

  return (
    <div className="space-y-6 pb-2">
      <section className="panel space-y-5 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="label">TON operative vault</p>
            <h2 className="title mt-1">Wallet link</h2>
          </div>
          <span
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${
              connected ? 'border-neon/60 bg-neon/10 text-neon-300' : 'border-neon/20 text-neon-600'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-neon shadow-glow' : 'bg-neon-700'}`} />
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        <div className="rounded-lg border border-neon/20 bg-black/50 px-4 py-3">
          <p className="label">Linked vault address</p>
          <p className="mt-1 font-mono text-sm tabular-nums text-neon-300">
            {connected ? truncateAddress(VAULT_ADDRESS) : 'Not linked'}
          </p>
        </div>

        <button
          type="button"
          onClick={toggleConnection}
          className={connected ? 'btn-ghost w-full' : 'btn-primary w-full'}
        >
          {connected ? <Link2Off size={16} /> : <Link2 size={16} />}
          {connected ? 'Disconnect vault' : 'Connect vault'}
        </button>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BalanceCard
          icon={Coins}
          label="TON balance"
          value={formatTon(tonBalance)}
          unit="TON"
          tone="amber"
        />
        <BalanceCard
          icon={Cpu}
          label="IQ vault balance"
          value={formatIq(state.iq)}
          unit="IQ"
          tone="neon"
        />
      </section>

      <p className="px-1 text-center font-mono text-[11px] leading-relaxed text-neon-600">
        <Landmark size={12} className="mr-1 inline" />
        Simulated TON Connect session. No real funds move in this build.
      </p>
    </div>
  );
}

const TONE_CLASS = {
  amber: 'border-amber-400/35 text-amber-300',
  neon: 'border-neon/35 text-neon-300',
} as const;

function BalanceCard({
  icon: Icon,
  label,
  value,
  unit,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  unit: string;
  tone: keyof typeof TONE_CLASS;
}) {
  return (
    <div className={`panel p-5 ${TONE_CLASS[tone]}`}>
      <div className="flex items-center gap-2 text-neon-500">
        <Icon size={14} />
        <p className="label">{label}</p>
      </div>
      <p className="mt-3 font-display text-2xl font-bold tabular-nums">
        {value} <span className="font-mono text-xs text-neon-500">{unit}</span>
      </p>
    </div>
  );
}
