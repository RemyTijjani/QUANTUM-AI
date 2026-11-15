import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock3, LoaderCircle, ShieldCheck, Unplug, Wallet } from 'lucide-react';
import { getTonConnectUI } from '@/lib/ton-connect';
import type { TonConnectWallet } from '@/lib/ton-connect';
import {
  createTonProofChallenge,
  fetchTonWallet,
  nanoTonToTon,
  requestTonWithdrawal,
  tonToNanoTon,
  verifyTonWalletProof,
  type TonWalletData,
} from '@/lib/economy/tonWallet';

function rawTonAddress(value: string): string {
  const raw = value.match(/^(-?\\d+):([0-9a-fA-F]{64})$/);
  if (raw) return `${Number(raw[1])}:${raw[2].toLowerCase()}`;
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    if (bytes.length !== 36) return '';
    let crc = 0;
    for (let i = 0; i < 34; i += 1) {
      crc ^= bytes[i] << 8;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    if (bytes[34] !== (crc >> 8) || bytes[35] !== (crc & 0xff)) return '';
    const workchain = bytes[1] > 127 ? bytes[1] - 256 : bytes[1];
    const hash = Array.from(bytes.slice(2, 34), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${workchain}:${hash}`;
  } catch {
    return '';
  }
}

function shortAddress(address: string): string {
  return address.length > 18 ? address.slice(0, 9) + '…' + address.slice(-7) : address;
}

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ');
}

export default function TonWalletConnection() {
  const [wallet, setWallet] = useState<TonConnectWallet | null>(null);
  const [walletData, setWalletData] = useState<TonWalletData | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refreshWalletData = useCallback(async () => {
    setLoadingData(true);
    try {
      const data = await fetchTonWallet();
      setWalletData(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load TON wallet details.');
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    const handleWallet = (nextWallet: TonConnectWallet | null) => {
      if (!mounted) return;
      setWallet(nextWallet);
      if (!nextWallet) {
        void refreshWalletData();
        return;
      }

      const tonProof = nextWallet.connectItems?.tonProof;
      if (tonProof && 'proof' in tonProof) {
        if (!nextWallet.account.walletStateInit) {
          setError('This wallet did not provide the information needed to verify ownership. Disconnect and try again.');
          return;
        }
        setBusy(true);
        setError('');
        void verifyTonWalletProof({
          address: nextWallet.account.address,
          network: nextWallet.account.chain,
          ...(nextWallet.account.publicKey ? { public_key: nextWallet.account.publicKey } : {}),
          proof: {
            ...tonProof.proof,
            state_init: nextWallet.account.walletStateInit,
          },
        }).then(async () => {
          if (!mounted) return;
          setNotice('Wallet ownership verified securely.');
          await refreshWalletData();
        }).catch((cause) => {
          if (mounted) setError(cause instanceof Error ? cause.message : 'Wallet ownership could not be verified.');
        }).finally(() => {
          if (mounted) setBusy(false);
        });
      } else if (tonProof && 'error' in tonProof) {
        setError(tonProof.error.message || 'This wallet does not support TON proof verification. Try Tonkeeper or another supported wallet.');
      } else {
        // A restored connection is not proof of ownership. Only the server's saved verification can unlock withdrawals.
        void refreshWalletData();
      }
    };

    try {
      const ui = getTonConnectUI();
      handleWallet(ui.wallet);
      unsubscribe = ui.onStatusChange(handleWallet);
      setReady(true);
    } catch (cause) {
      if (mounted) setError(cause instanceof Error ? cause.message : 'TON Connect could not be initialized.');
    }

    void refreshWalletData();
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [refreshWalletData]);

  const connect = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const ui = getTonConnectUI();
      ui.setConnectRequestParameters({ state: 'loading' });
      const payload = await createTonProofChallenge();
      ui.setConnectRequestParameters({ state: 'ready', value: { tonProof: payload } });
      await ui.openModal();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start secure wallet connection.');
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

  const submitWithdrawal = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const amountNano = tonToNanoTon(withdrawAmount);
      await requestTonWithdrawal(amountNano, crypto.randomUUID());
      setWithdrawAmount('');
      setNotice('Withdrawal request submitted. Your TON is reserved while an admin reviews it; nothing has been sent yet.');
      await refreshWalletData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit the withdrawal request.');
    } finally {
      setBusy(false);
    }
  };

  const isMainnet = wallet?.account.chain === '-239';
  const isVerified = walletData?.wallet?.verification_status === 'verified' && (!wallet || (wallet.account.chain === '-239' && rawTonAddress(wallet.account.address) === walletData.wallet.wallet_address));
  const availableNano = walletData?.balance.availableNano ?? '0';
  const availableTon = Number(nanoTonToTon(availableNano));
  const hasEnough = (() => {
    try {
      return withdrawAmount.trim() !== '' && BigInt(tonToNanoTon(withdrawAmount)) > 0n &&
        BigInt(tonToNanoTon(withdrawAmount)) <= BigInt(availableNano);
    } catch {
      return false;
    }
  })();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Wallet size={16} className="text-cyan-300" />
        <p className="label">TON Connect wallet</p>
        {isVerified && <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-[9px] text-emerald-300"><ShieldCheck size={11} /> Verified</span>}
      </div>

      {wallet ? (
        <div className="flex items-center justify-between gap-3 border border-neon/20 bg-black/30 p-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] text-neon-200">{shortAddress(wallet.account.address)}</p>
            <p className={'mt-1 font-mono text-[9px] ' + (isMainnet ? 'text-emerald-300' : 'text-amber-300')}>
              {isMainnet ? 'Connected · TON mainnet' : 'Wrong network · switch to TON mainnet'}
            </p>
            <p className="mt-1 font-mono text-[9px] text-neon-600">
              {isVerified ? 'Ownership verified by ZORD' : 'Connected, but ownership is not verified'}
            </p>
          </div>
          {isVerified ? <CheckCircle2 size={17} className="shrink-0 text-emerald-300" /> : <Clock3 size={17} className="shrink-0 text-amber-300" />}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="font-mono text-[10px] leading-relaxed text-neon-500">
            Connect Tonkeeper or Telegram Wallet. ZORD asks your wallet to sign a one-time ownership check. Connecting does not send money.
          </p>
          <button type="button" className="btn-primary w-full" disabled={!ready || busy} onClick={() => void connect()}>
            {busy || !ready ? <LoaderCircle size={14} className="animate-spin" /> : <Wallet size={14} />}
            {ready ? 'Connect and verify wallet' : 'Loading wallet connector…'}
          </button>
        </div>
      )}

      {wallet && (
        <button type="button" className="btn-ghost w-full" disabled={busy} onClick={() => void disconnect()}>
          {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Unplug size={14} />}
          Disconnect wallet
        </button>
      )}

      <section className="rounded-lg border border-neon/15 bg-black/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="label">Withdrawable TON (Gram)</p>
          <button type="button" className="text-[9px] text-neon-500 underline" disabled={loadingData} onClick={() => void refreshWalletData()}>Refresh</button>
        </div>
        <p className="mt-2 font-display text-2xl font-bold text-white">{loadingData ? '—' : availableTon.toLocaleString(undefined, { maximumFractionDigits: 9 })} <span className="text-xs font-normal text-neon-500">TON</span></p>
        <p className="mt-1 text-[9px] text-neon-700">Reserved for pending requests: {nanoTonToTon(walletData?.balance.reservedNano ?? '0')} TON</p>
        {walletData?.wallet && !wallet && <p className="mt-1 text-[9px] text-neon-600">Verified payout wallet: {shortAddress(walletData.wallet.wallet_address)}</p>}

        {isVerified ? (
          <div className="mt-3 space-y-2">
            <label htmlFor="ton-withdraw-amount" className="block text-[10px] text-neon-500">Amount to withdraw</label>
            <div className="flex gap-2">
              <input id="ton-withdraw-amount" inputMode="decimal" value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} placeholder="0.00 TON" className="min-w-0 flex-1 rounded-lg border border-neon/20 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50" />
              <button type="button" className="btn-ghost" onClick={() => setWithdrawAmount(nanoTonToTon(availableNano))}>Max</button>
            </div>
            <button type="button" className="btn-primary w-full" disabled={busy || !hasEnough} onClick={() => void submitWithdrawal()}>
              {busy ? <LoaderCircle size={14} className="animate-spin" /> : <ArrowDownLeftIcon />}
              Request withdrawal
            </button>
            <p className="text-[9px] leading-relaxed text-amber-300">Requests are reviewed by an admin. TON is reserved first; an external transfer is recorded only after it is completed.</p>
          </div>
        ) : (
          <p className="mt-3 text-[10px] leading-relaxed text-amber-300">Verify a TON mainnet wallet to unlock withdrawal requests. Your available balance stays safe in ZORD until then.</p>
        )}
      </section>

      {(walletData?.withdrawals.length ?? 0) > 0 && (
        <section className="space-y-2">
          <p className="label">Withdrawal history</p>
          {walletData?.withdrawals.map((request) => (
            <div key={request.id} className="flex items-center justify-between gap-3 rounded-lg border border-neon/10 bg-black/20 p-3">
              <div>
                <p className="text-xs text-white">{nanoTonToTon(request.amount_nano)} TON</p>
                <p className="mt-1 text-[9px] text-neon-700">{new Date(request.created_at).toLocaleDateString()}</p>
              </div>
              <span className="rounded-full border border-neon/20 px-2 py-1 text-[9px] capitalize text-neon-300">{formatStatus(request.status)}</span>
            </div>
          ))}
        </section>
      )}

      {notice && <p role="status" className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 text-[10px] leading-relaxed text-emerald-300">{notice}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-400/20 bg-red-400/5 p-3 text-[10px] leading-relaxed text-red-300">{error}</p>}
      <p className="font-mono text-[9px] leading-relaxed text-neon-700">No seed phrase or private key is requested. Wallet verification is separate from payment approval.</p>
    </div>
  );
}

function ArrowDownLeftIcon() {
  return <span aria-hidden="true">↘</span>;
}
