import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, CheckCircle2, Coins, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import { formatZp } from '@/lib/format';
import {
  convertZpToZap,
  fetchZapWallet,
  type ZapWallet,
} from '@/lib/economy/zapWallet';

export default function ZapWalletPanel({
  verifiedZpBalance,
  onConversionComplete,
}: {
  verifiedZpBalance: number | null;
  onConversionComplete: () => Promise<void> | void;
}) {
  const [wallet, setWallet] = useState<ZapWallet | null>(null);
  const [amountZp, setAmountZp] = useState('1000');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [pendingAmount, setPendingAmount] = useState<string | null>(null);

  const maxConvertibleZp = verifiedZpBalance === null || !Number.isFinite(verifiedZpBalance)
    ? 0
    : Math.floor(verifiedZpBalance / 1000) * 1000;
  const parsedAmount = /^\\d+$/.test(amountZp) ? Number(amountZp) : 0;
  const validAmount = Number.isSafeInteger(parsedAmount) &&
    parsedAmount >= 1000 &&
    parsedAmount % 1000 === 0 &&
    parsedAmount <= maxConvertibleZp;

  const loadWallet = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const nextWallet = await fetchZapWallet();
      setWallet(nextWallet);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load your ZAP wallet.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  const zapEquivalent = useMemo(
    () => validAmount ? parsedAmount / 1000 : 0,
    [parsedAmount, validAmount],
  );

  const handleConvert = async () => {
    if (!validAmount || submitting) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    const key = pendingKey && pendingAmount === amountZp
      ? pendingKey
      : crypto.randomUUID();
    setPendingKey(key);
    setPendingAmount(amountZp);

    try {
      const result = await convertZpToZap(amountZp, key);
      setWallet(result.wallet);
      setSuccess(`Converted ${formatZp(result.conversion.zpDebited)} ZP into ${result.conversion.zapCredited} ZAP.`);
      setAmountZp('1000');
      setPendingKey(null);
      setPendingAmount(null);
      await onConversionComplete();
    } catch (conversionError) {
      const message = conversionError instanceof Error ? conversionError.message : 'Conversion could not be completed.';
      // Refresh balances in case the server completed the request but the response was interrupted.
      await loadWallet();
      setError(message);
      await onConversionComplete();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="panel space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-cyan-300">
          <Wallet size={17} />
          <h2 className="title">ZAP wallet</h2>
        </div>
        <button
          type="button"
          onClick={() => void loadWallet(true)}
          disabled={refreshing || loading}
          className="rounded-lg border border-neon/20 p-2 text-neon-400 disabled:opacity-40"
          aria-label="Refresh ZAP wallet"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="rounded-xl border border-cyan-400/25 bg-cyan-400/5 p-4">
        <div className="flex items-center gap-2 text-cyan-300">
          <Coins size={15} />
          <p className="label">Available ZAP</p>
        </div>
        <p className="mt-2 font-display text-3xl text-cyan-200">
          {loading ? '…' : wallet ? formatZp(wallet.balance) : 'Unavailable'}
        </p>
        <p className="mt-1 font-mono text-[9px] text-cyan-500">Whole ZAP units · secured server wallet</p>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-neon/15 px-3 py-2">
        <span className="font-mono text-[10px] text-neon-500">Conversion rate</span>
        <span className="font-mono text-[10px] font-bold text-neon-300">1,000 ZP = 1 ZAP</span>
      </div>

      <div className="space-y-2">
        <label htmlFor="zp-conversion-amount" className="label">Convert ZP into ZAP</label>
        <div className="flex gap-2">
          <input
            id="zp-conversion-amount"
            type="number"
            min="1000"
            step="1000"
            inputMode="numeric"
            value={amountZp}
            onChange={(event) => {
              setAmountZp(event.target.value);
              setError(null);
              setSuccess(null);
              if (pendingAmount !== event.target.value) {
                setPendingKey(null);
                setPendingAmount(null);
              }
            }}
            disabled={submitting}
            className="min-w-0 flex-1 rounded-lg border border-neon/25 bg-obsidian px-3 py-3 font-mono text-sm text-neon-100 outline-none focus:border-neon/70 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => setAmountZp(String(maxConvertibleZp || 1000))}
            disabled={submitting || maxConvertibleZp < 1000}
            className="rounded-lg border border-neon/25 px-3 font-mono text-[9px] uppercase text-neon-300 disabled:opacity-40"
          >
            Max
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 font-mono text-[9px] text-neon-600">
          <span>Available: {verifiedZpBalance === null ? 'Unavailable' : `${formatZp(verifiedZpBalance)} ZP`}</span>
          <span>Maximum: {formatZp(maxConvertibleZp)} ZP</span>
        </div>
        {validAmount && (
          <p className="font-mono text-[10px] text-cyan-300">
            You will receive {formatZp(zapEquivalent)} ZAP
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => void handleConvert()}
        disabled={!validAmount || submitting || loading || !wallet}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-300/40 bg-cyan-400/10 px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-widest text-cyan-200 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ArrowDownUp size={14} className={submitting ? 'animate-pulse' : ''} />
        {submitting ? 'Converting securely…' : 'Convert ZP to ZAP'}
      </button>

      {error && <p role="alert" className="rounded-lg border border-red-400/25 bg-red-400/5 p-3 font-mono text-[10px] text-red-300">{error}</p>}
      {success && (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/5 p-3 font-mono text-[10px] text-emerald-300">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />{success}
        </p>
      )}

      <div className="flex items-start gap-2 border-t border-neon/10 pt-3">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-neon-500" />
        <p className="font-mono text-[9px] leading-relaxed text-neon-600">
          Conversions are processed atomically by the server. Only multiples of 1,000 ZP can be converted because ZAP uses whole-number units. Duplicate requests cannot credit the same conversion twice.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="label">Recent ZAP activity</p>
          <span className="font-mono text-[9px] text-neon-700">Latest 5</span>
        </div>
        {!wallet || wallet.transactions.length === 0 ? (
          <p className="border border-neon/10 px-3 py-4 text-center font-mono text-[9px] text-neon-700">No ZAP transactions yet</p>
        ) : (
          wallet.transactions.slice(0, 5).map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-3 border-b border-neon/10 py-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-[9px] uppercase text-neon-300">{entry.description || entry.source.replace(/_/g, ' ')}</p>
                <p className="mt-1 font-mono text-[8px] text-neon-700">
                  {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'Date unavailable'}
                </p>
              </div>
              <p className={`shrink-0 font-mono text-[10px] ${entry.entryType === 'debit' ? 'text-amber-300' : 'text-emerald-300'}`}>
                {entry.entryType === 'debit' ? '−' : '+'}{formatZp(entry.amount)} ZAP
              </p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
