import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, RefreshCw, ShieldCheck, Loader2, ExternalLink } from 'lucide-react';
import {
  AdminApiError,
  confirmExternalZapFunding,
  listExternalZapFunding,
} from '@/lib/admin/adminApi';
import type { AdminCredentials, AdminExternalZapFundingRecord, AdminExternalZapFundingSummary } from '@/lib/admin/adminApi';

function formatZap(value: number | string) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 }).format(Number(value));
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function AdminExternalZapFunding({ creds }: { creds: AdminCredentials }) {
  const [summary, setSummary] = useState<AdminExternalZapFundingSummary | null>(null);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [checkedExternally, setCheckedExternally] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSummary(await listExternalZapFunding(creds));
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Could not load funding records.');
    } finally {
      setLoading(false);
    }
  }, [creds]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || Number(parsedAmount.toFixed(8)) !== parsedAmount) {
      setError('Enter a positive ZAP amount with up to 8 decimal places.');
      return;
    }
    if (reference.trim().length < 3 || reference.trim().length > 200) {
      setError('Enter a transaction reference between 3 and 200 characters.');
      return;
    }
    if (!checkedExternally) {
      setError('Confirm that you checked the deposit outside ZORD before continuing.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await confirmExternalZapFunding(creds, {
        amount: parsedAmount,
        transactionReference: reference.trim(),
      });
      setSuccess(`Confirmed ${formatZap(result.amount)} ZAP. Verified raffle reserve: ${formatZap(result.availableReserve)} ZAP.`);
      setAmount('');
      setReference('');
      setCheckedExternally(false);
      await refresh();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Could not confirm this deposit.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="panel p-4 border border-neon/20 space-y-3">
        <div className="flex items-center justify-between gap-3 border-b border-neon/20 pb-3">
          <div>
            <h2 className="text-xs uppercase tracking-widest text-neon-300 font-bold flex items-center gap-2">
              <ArrowDownToLine size={15} /> External ZAP funding
            </h2>
            <p className="text-[10px] text-neon-600 mt-1">Record deposits that have been independently checked outside ZORD.</p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading} className="p-2 border border-neon/30 text-neon-300 disabled:opacity-50" aria-label="Refresh funding records">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="border border-neon/20 bg-black/40 p-3">
            <p className="text-[10px] uppercase tracking-wider text-neon-600">Verified raffle reserve</p>
            <p className="text-2xl font-display font-bold text-neon-300 tabular-nums mt-1">{loading && !summary ? '...' : `${formatZap(summary?.availableReserve ?? 0)} ZAP`}</p>
            <p className="text-[10px] text-neon-600 mt-1">Separate from player wallets. Available for prize reservations.</p>
          </div>
          <div className="border border-amber-400/20 bg-amber-400/5 p-3">
            <p className="text-[10px] uppercase tracking-wider text-amber-300 flex items-center gap-1"><ShieldCheck size={12} /> Manual verification</p>
            <p className="text-[11px] text-neon-400 mt-2">Check the external deposit and transaction reference yourself before confirming. Confirmation immediately increases the raffle reserve.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 border-t border-neon/10 pt-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-[10px] uppercase tracking-wider text-neon-500">
              Deposit amount (ZAP)
              <input type="number" min="0.00000001" step="0.00000001" required value={amount} onChange={(e) => setAmount(e.target.value)} disabled={saving} placeholder="e.g. 250" className="w-full mt-1 bg-black/60 border border-neon/30 p-2 text-xs text-neon-200 normal-case" />
            </label>
            <label className="text-[10px] uppercase tracking-wider text-neon-500">
              Transaction reference
              <input type="text" minLength={3} maxLength={200} required value={reference} onChange={(e) => setReference(e.target.value)} disabled={saving} placeholder="External transfer reference / receipt ID" className="w-full mt-1 bg-black/60 border border-neon/30 p-2 text-xs text-neon-200 normal-case" />
            </label>
          </div>
          <label className="flex items-start gap-2 text-[11px] text-amber-200/90">
            <input type="checkbox" checked={checkedExternally} onChange={(e) => setCheckedExternally(e.target.checked)} disabled={saving} className="mt-0.5 accent-emerald-400" />
            <span>I have checked this deposit outside ZORD and confirm that the amount and transaction reference are correct.</span>
          </label>
          {error && <p role="alert" className="text-[11px] text-red-400 border-l-2 border-red-500/60 pl-2">{error}</p>}
          {success && <p role="status" className="text-[11px] text-emerald-300 border-l-2 border-emerald-500/60 pl-2">{success}</p>}
          <button type="submit" disabled={saving || loading || !checkedExternally} className="w-full sm:w-auto px-4 py-2 flex items-center justify-center gap-2 bg-neon/20 hover:bg-neon/30 border border-neon text-xs uppercase tracking-wider font-bold text-neon-200 disabled:opacity-40">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Confirming deposit...' : 'Confirm external deposit'}
          </button>
        </form>
      </section>

      <section className="panel p-4 border border-neon/20 space-y-3">
        <div className="flex items-center justify-between border-b border-neon/20 pb-2">
          <h3 className="text-xs uppercase tracking-widest text-neon-400 font-bold">Funding history</h3>
          <span className="text-[10px] text-neon-600">{summary?.funding.length ?? 0} records shown</span>
        </div>
        {loading && !summary ? (
          <p className="text-xs text-neon-600 py-6 text-center">Loading funding history...</p>
        ) : !summary?.funding.length ? (
          <p className="text-xs text-neon-600 py-6 text-center">No external ZAP deposits have been confirmed.</p>
        ) : (
          <div className="space-y-2">
            {summary.funding.map((item: AdminExternalZapFundingRecord) => (
              <div key={item.id} className="border border-neon/10 bg-black/30 p-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-neon-300 tabular-nums">{formatZap(item.amount)} ZAP</p>
                  <p className="text-[10px] text-neon-500 break-all mt-1">Reference: {item.transaction_reference}</p>
                  <p className="text-[10px] text-neon-600 mt-1">Confirmed by {item.confirmed_by}</p>
                </div>
                <p className="text-[10px] text-neon-600 sm:text-right">{formatDate(item.confirmed_at)}</p>
              </div>
            ))}
          </div>
        )}
      </section>
      <p className="text-[10px] text-neon-700 flex items-center gap-1"><ExternalLink size={11} /> External deposit verification is manual; ZORD records the Admin confirmation and does not independently inspect the external payment source.</p>
    </div>
  );
}
