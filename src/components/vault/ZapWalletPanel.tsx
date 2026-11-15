import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, CheckCircle2, Coins, RefreshCw, Wallet } from 'lucide-react';
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
  const parsedAmount = /^\d+$/.test(amountZp) ? Number(amountZp) : 0;
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
      setSuccess(`You converted ${formatZp(result.conversion.zpDebited)} ZP into ${result.conversion.zapCredited} ZAP.`);
      setAmountZp('1000');
      setPendingKey(null);
      setPendingAmount(null);
      await onConversionComplete();
    } catch (conversionError) {
      const message = conversionError instanceof Error ? conversionError.message : 'Conversion could not be completed.';
      await loadWallet();
      setError(message);
      await onConversionComplete();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-neon/20 bg-[#07130d] p-3">
          <div className="flex items-center gap-2 text-neon-500">
            <Coins size={14} />
            <p className="text-[9px] font-semibold uppercase tracking-wider">ZP points</p>
          </div>
          <p className="mt-3 break-all font-display text-xl font-bold text-neon-200">
            {verifiedZpBalance === null ? '—' : formatZp(verifiedZpBalance)}
          </p>
          <p className="mt-1 text-[9px] text-neon-700">Earned in ZORD</p>
        </div>

        <div className="rounded-xl border border-cyan-400/25 bg-[#06131a] p-3">
          <div className="flex items-center justify-between gap-1 text-cyan-300">
            <div className="flex items-center gap-2">
              <Wallet size={14} />
              <p className="text-[9px] font-semibold uppercase tracking-wider">ZAP wallet</p>
            </div>
            <button
              type="button"
              onClick={() => void loadWallet(true)}
              disabled={refreshing || loading}
              className="rounded-md p-1 text-cyan-400 hover:bg-cyan-300/10 disabled:opacity-40"
              aria-label="Refresh ZAP wallet"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
          <p className="mt-3 break-all font-display text-xl font-bold text-cyan-100">
            {loading ? '…' : wallet ? formatZp(wallet.balance) : '—'}
          </p>
          <p className="mt-1 text-[9px] text-cyan-700">{loading ? 'Loading balance' : wallet ? 'Available to use' : 'Balance unavailable'}</p>
        </div>
      </div>

      <div className="panel space-y-4 p-4">
        <div>
          <div className="flex items-center gap-2 text-cyan-300">
            <ArrowDownUp size={17} />
            <h2 className="title">Convert points to ZAP</h2>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-neon-600">
            Turn your earned ZP points into ZAP in a few simple steps.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-cyan-300/20 bg-cyan-300/5 px-3 py-3">
          <span className="text-[10px] text-neon-500">Conversion rate</span>
          <span className="text-xs font-bold text-cyan-200">1,000 ZP = 1 ZAP</span>
        </div>

        <div className="space-y-2">
          <label htmlFor="zp-conversion-amount" className="text-xs font-semibold text-neon-200">
            How many ZP do you want to convert?
          </label>
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
              className="min-w-0 flex-1 rounded-lg border border-neon/20 bg-black/30 px-3 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60 disabled:opacity-50"
              aria-describedby="zp-conversion-help"
            />
            <button
              type="button"
              onClick={() => setAmountZp(String(maxConvertibleZp || 1000))}
              disabled={submitting || maxConvertibleZp < 1000}
              className="rounded-lg border border-neon/20 px-4 text-xs font-semibold text-neon-300 transition hover:bg-neon/10 disabled:opacity-40"
            >
              Max
            </button>
          </div>
          <div id="zp-conversion-help" className="flex items-center justify-between gap-2 text-[10px] text-neon-700">
            <span>Available: {verifiedZpBalance === null ? '—' : `${formatZp(verifiedZpBalance)} ZP`}</span>
            <span>Whole ZAP only</span>
          </div>
          <div className="rounded-lg bg-black/20 px-3 py-3">
            <p className="text-[10px] text-neon-600">You will receive</p>
            <p className="mt-1 font-display text-lg font-bold text-cyan-200">
              {validAmount ? `${formatZp(zapEquivalent)} ZAP` : 'Enter an amount'}
            </p>
            {!validAmount && (
              <p className="mt-1 text-[9px] text-neon-700">
                Enter a multiple of 1,000 ZP. You need at least 1,000 ZP to convert.
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleConvert()}
          disabled={!validAmount || submitting || loading || !wallet}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-300 px-4 py-3 text-xs font-bold text-[#041016] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowDownUp size={15} className={submitting ? 'animate-pulse' : ''} />
          {submitting ? 'Converting…' : 'Convert ZP to ZAP'}
        </button>

        {error && (
          <p role="alert" className="rounded-lg border border-red-400/25 bg-red-400/5 p-3 text-[10px] leading-relaxed text-red-300">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/5 p-3 text-[10px] leading-relaxed text-emerald-300">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />{success}
          </p>
        )}
        <p className="text-[9px] leading-relaxed text-neon-700">
          Conversions are processed securely. The minimum conversion is 1,000 ZP, and ZAP is credited to your ZORD wallet.
        </p>
      </div>

      <div className="panel space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="title">ZAP activity</h2>
            <p className="mt-1 text-[10px] text-neon-700">Your latest wallet transactions</p>
          </div>
          <span className="rounded-full border border-neon/15 px-2 py-1 text-[9px] text-neon-600">Latest 5</span>
        </div>
        {!wallet || wallet.transactions.length === 0 ? (
          <div className="rounded-lg border border-neon/10 bg-black/20 px-3 py-6 text-center">
            <HistoryIcon />
            <p className="mt-2 text-xs text-neon-500">No ZAP activity yet</p>
            <p className="mt-1 text-[10px] text-neon-700">Your wallet transactions will show here.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {wallet.transactions.slice(0, 5).map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-3 border-b border-neon/10 py-3 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-xs capitalize text-neon-200">{entry.description || entry.source.replace(/_/g, ' ')}</p>
                  <p className="mt-1 text-[9px] text-neon-700">
                    {entry.createdAt && Number.isFinite(Date.parse(entry.createdAt)) ? new Date(entry.createdAt).toLocaleString() : 'Date unavailable'}
                  </p>
                </div>
                <p className={`shrink-0 font-display text-sm font-semibold ${entry.entryType === 'debit' ? 'text-amber-300' : 'text-emerald-300'}`}>
                  {entry.entryType === 'debit' ? '−' : '+'}{formatZp(entry.amount)} <span className="text-[10px]">ZAP</span>
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function HistoryIcon() {
  return <Coins size={20} className="mx-auto text-neon-700" />;
}
