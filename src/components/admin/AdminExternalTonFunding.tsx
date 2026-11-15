import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, RefreshCw, ShieldCheck, Loader2, Copy, Check } from 'lucide-react';
import {
  AdminApiError,
  confirmExternalTonFunding,
  listExternalTonFunding,
} from '@/lib/admin/adminApi';
import type { AdminCredentials, AdminExternalTonFundingRecord, AdminExternalTonFundingSummary } from '@/lib/admin/adminApi';

function formatTon(value: number | string) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 9 }).format(Number(value));
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function AdminExternalTonFunding({ creds }: { creds: AdminCredentials }) {
  const [summary, setSummary] = useState<AdminExternalTonFundingSummary | null>(null);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [checkedExternally, setCheckedExternally] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSummary(await listExternalTonFunding(creds));
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Could not load Gram funding records.');
    } finally {
      setLoading(false);
    }
  }, [creds]);

  useEffect(() => { void refresh(); }, [refresh]);

  const copyAddress = async () => {
    if (!summary?.walletAddress) return;
    try {
      await navigator.clipboard.writeText(summary.walletAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Could not copy the wallet address. Select and copy it manually.');
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || Number(parsedAmount.toFixed(9)) !== parsedAmount) {
      setError('Enter a positive Gram amount with up to 9 decimal places.');
      return;
    }
    if (reference.trim().length < 32 || reference.trim().length > 200) {
      setError('Enter the Gram transaction hash/reference (32–200 characters).');
      return;
    }
    if (!checkedExternally) {
      setError('Confirm that you checked the transaction outside ZORD before continuing.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await confirmExternalTonFunding(creds, {
        amount: parsedAmount,
        transactionReference: reference.trim(),
      });
      setSuccess(`Confirmed ${formatTon(result.amount)} Gram. Verified raffle reserve: ${formatTon(result.availableReserve)} Gram.`);
      setAmount('');
      setReference('');
      setCheckedExternally(false);
      await refresh();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Could not confirm this Gram deposit.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-[#111a14] p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <h2 className="text-xs uppercase tracking-widest text-emerald-300 font-bold flex items-center gap-2">
              <ArrowDownToLine size={15} /> External Gram raffle funding
            </h2>
            <p className="text-[10px] text-slate-400 mt-1">Use this wallet only for Gram raffle prize deposits.</p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading} className="p-2 border border-white/10 text-emerald-300 disabled:opacity-50" aria-label="Refresh Gram funding records">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          </button>
        </div>

        <div className="border border-white/10 bg-[#0b120e] p-3 space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-slate-400">Designated Gram funding wallet</p>
          <p className="text-xs text-slate-100 break-all select-all">{summary?.walletAddress ?? 'Loading wallet address...'}</p>
          <button type="button" onClick={() => void copyAddress()} disabled={!summary?.walletAddress} className="px-3 py-2 border border-white/10 text-emerald-300 text-[10px] uppercase tracking-wider flex items-center gap-2 disabled:opacity-40">
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Address copied' : 'Copy wallet address'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="border border-white/10 bg-[#0b120e] p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Verified raffle Gram reserve</p>
            <p className="text-2xl font-display font-bold text-emerald-300 tabular-nums mt-1">{loading && !summary ? '...' : `${formatTon(summary?.availableReserve ?? 0)} Gram`}</p>
            <p className="text-[10px] text-slate-400 mt-1">Separate from player wallets. Used only for reserved raffle prizes.</p>
          </div>
          <div className="border border-amber-400/20 bg-amber-400/5 p-3">
            <p className="text-[10px] uppercase tracking-wider text-amber-300 flex items-center gap-1"><ShieldCheck size={12} /> Check before confirming</p>
            <p className="text-[11px] text-slate-300 mt-2">On TON Explorer, verify the transaction succeeded, sent TON to the exact wallet above, and has the amount you enter. Check the transaction hash has not already been used.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 border-t border-emerald-400/40/10 pt-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-[10px] uppercase tracking-wider text-slate-400">
              Deposit amount (Gram)
              <input type="number" min="0.000000001" step="0.000000001" required value={amount} onChange={(e) => setAmount(e.target.value)} disabled={saving} placeholder="e.g. 10.5" className="w-full mt-1 bg-[#080e0a] border border-white/10 p-2 text-xs text-slate-100 normal-case" />
            </label>
            <label className="text-[10px] uppercase tracking-wider text-slate-400">
              Gram transaction hash / reference
              <input type="text" minLength={32} maxLength={200} required value={reference} onChange={(e) => setReference(e.target.value)} disabled={saving} placeholder="Paste transaction hash" className="w-full mt-1 bg-[#080e0a] border border-white/10 p-2 text-xs text-slate-100 normal-case" />
            </label>
          </div>
          <label className="flex items-start gap-2 text-[11px] text-amber-200/90">
            <input type="checkbox" checked={checkedExternally} onChange={(e) => setCheckedExternally(e.target.checked)} disabled={saving} className="mt-0.5 accent-emerald-400" />
            <span>I personally checked this successful Gram deposit on-chain, confirmed the destination wallet and amount, and verified that this transaction hash has not been recorded before.</span>
          </label>
          {error && <p role="alert" className="text-[11px] text-red-400 border-l-2 border-red-500/60 pl-2">{error}</p>}
          {success && <p role="status" className="text-[11px] text-emerald-300 border-l-2 border-emerald-500/60 pl-2">{success}</p>}
          <button type="submit" disabled={saving || loading || !summary?.walletAddress || !checkedExternally} className="w-full sm:w-auto px-4 py-2 flex items-center justify-center gap-2 bg-emerald-400/15 hover:bg-emerald-400/20 border border-emerald-400/40 text-xs uppercase tracking-wider font-bold text-slate-100 disabled:opacity-40">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Confirming deposit...' : 'Confirm verified Gram deposit'}
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#111a14] p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-white/10 pb-2">
          <h3 className="text-xs uppercase tracking-widest text-slate-300 font-bold">Gram funding history</h3>
          <span className="text-[10px] text-slate-400">{summary?.funding.length ?? 0} records shown</span>
        </div>
        {loading && !summary ? (
          <p className="text-xs text-slate-400 py-6 text-center">Loading Gram funding history...</p>
        ) : !summary?.funding.length ? (
          <p className="text-xs text-slate-400 py-6 text-center">No external Gram deposits have been confirmed.</p>
        ) : (
          <div className="space-y-2">
            {summary.funding.map((item: AdminExternalTonFundingRecord) => (
              <div key={item.id} className="border border-emerald-400/40/10 bg-[#101a14] p-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-emerald-300 tabular-nums">{formatTon(item.amount)} Gram</p>
                  <p className="text-[10px] text-slate-400 break-all mt-1">Transaction: {item.transaction_reference}</p>
                  <p className="text-[10px] text-slate-400 mt-1">Confirmed by {item.confirmed_by}</p>
                </div>
                <p className="text-[10px] text-slate-400 sm:text-right">{formatDate(item.confirmed_at)}</p>
              </div>
            ))}
          </div>
        )}
      </section>
      <p className="text-[10px] text-slate-500">Single-Admin verification: ZORD records the Admin's confirmation and audit details. It does not independently inspect the TON blockchain. Only confirm after checking the transaction externally.</p>
    </div>
  );
}
