import { useEffect, useState } from 'react';
import { CheckCircle2, LoaderCircle, Unplug, Wallet } from 'lucide-react';
import { getTonConnectUI } from '@/lib/ton-connect';
import type { TonConnectWallet } from '@/lib/ton-connect';

function shortAddress(address: string): string {
  return address.length > 16 ? address.slice(0, 8) + '…' + address.slice(-8) : address;
}

export default function TonWalletConnection() {
  const [wallet, setWallet] = useState<TonConnectWallet | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    try {
      const ui = getTonConnectUI();
      const syncWallet = (nextWallet: TonConnectWallet | null) => {
        if (mounted) setWallet(nextWallet);
      };
      syncWallet(ui.wallet);
      unsubscribe = ui.onStatusChange(syncWallet);
      setReady(true);
    } catch (cause) {
      if (mounted) {
        setError(cause instanceof Error ? cause.message : 'TON Connect could not be initialized.');
      }
    }

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      await getTonConnectUI().openModal();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open the wallet selector.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError('');
    try {
      await getTonConnectUI().disconnect();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not disconnect this wallet.');
    } finally {
      setBusy(false);
    }
  };

  const isMainnet = wallet?.account.chain === '-239';

  return (
    <section className="panel space-y-3 border border-cyan-400/25 p-4">
      <div className="flex items-center gap-2">
        <Wallet size={16} className="text-cyan-300" />
        <p className="label">TON Connect wallet</p>
      </div>

      {wallet ? (
        <>
          <div className="flex items-center justify-between gap-3 border border-neon/20 bg-black/30 p-3">
            <div className="min-w-0">
              <p className="font-mono text-[11px] text-neon-200">{shortAddress(wallet.account.address)}</p>
              <p className={'mt-1 font-mono text-[9px] ' + (isMainnet ? 'text-emerald-300' : 'text-amber-300')}>
                {isMainnet ? 'Connected · TON mainnet' : 'Connected · switch to TON mainnet for rentals'}
              </p>
            </div>
            <CheckCircle2 size={17} className={isMainnet ? 'shrink-0 text-emerald-300' : 'shrink-0 text-amber-300'} />
          </div>
          <button type="button" className="btn-ghost w-full" disabled={busy} onClick={() => void disconnect()}>
            {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Unplug size={14} />}
            Disconnect wallet
          </button>
        </>
      ) : (
        <div className="space-y-2">
          <p className="font-mono text-[10px] leading-relaxed text-neon-500">
            Connect Tonkeeper or Telegram Wallet. Connecting only shares your public wallet address; it does not authorize a payment.
          </p>
          <button type="button" className="btn-primary w-full" disabled={!ready || busy} onClick={() => void connect()}>
            {busy || !ready ? <LoaderCircle size={14} className="animate-spin" /> : <Wallet size={14} />}
            {ready ? 'Connect wallet' : 'Loading wallet connector…'}
          </button>
        </div>
      )}

      {error && <p role="status" className="font-mono text-[10px] text-red-300">{error}</p>}
      <p className="font-mono text-[9px] leading-relaxed text-amber-300">
        Wallet linking is separate from payments. No funds are sent and no rental is activated by connecting.
      </p>
    </section>
  );
}
