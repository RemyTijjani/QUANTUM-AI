import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock3, LoaderCircle, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import {
  AdminApiError,
  listAdminTonWithdrawals,
  reviewAdminTonWithdrawal,
} from '@/lib/admin/adminApi';
import type { AdminCredentials, AdminTonWithdrawal, AdminTonWithdrawalAction } from '@/lib/admin/adminApi';
import { nanoTonToTon } from '@/lib/economy/tonWallet';

const errorText = (error: unknown) => error instanceof AdminApiError ? error.message : 'Something went wrong. Please try again.';
const shortAddress = (value: string) => value.length > 24 ? value.slice(0, 12) + '…' + value.slice(-8) : value;

export default function AdminTonWithdrawals({ creds }: { creds: AdminCredentials }) {
  const [requests, setRequests] = useState<AdminTonWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [hashes, setHashes] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRequests(await listAdminTonWithdrawals(creds));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [creds]);

  useEffect(() => { void refresh(); }, [refresh]);

  const act = async (request: AdminTonWithdrawal, action: AdminTonWithdrawalAction) => {
    setWorkingId(request.id);
    setError('');
    setNotice('');
    try {
      if (action === 'paid') {
        const hash = (hashes[request.id] ?? '').trim();
        if (hash.length < 32 || hash.length > 200 || /\s/.test(hash)) {
          setError('Enter the transaction hash/reference from the completed TON transfer (32–200 characters, no spaces).');
          return;
        }
      }
      const result = await reviewAdminTonWithdrawal(creds, {
        requestId: request.id,
        action,
        note: notes[request.id] ?? '',
        ...(action === 'paid' ? { transactionHash: hashes[request.id] } : {}),
      });
      const messages: Record<AdminTonWithdrawalAction, string> = {
        approve: 'Withdrawal approved. The TON remains reserved until payment is recorded.',
        reject: 'Withdrawal rejected. The reserved TON has been returned to the player’s available balance.',
        processing: 'Withdrawal moved to processing. Complete the transfer outside ZORD before marking it paid.',
        paid: 'Payment recorded. The reserved TON has been settled in the player ledger.',
      };
      setNotice(messages[action]);
      await refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setWorkingId(null);
    }
  };

  const pending = requests.filter((request) => request.status === 'pending').length;
  const approved = requests.filter((request) => request.status === 'approved').length;
  const processing = requests.filter((request) => request.status === 'processing').length;

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-cyan-300/20 bg-gradient-to-br from-cyan-400/10 via-black/50 to-neon/5 p-4">
        <p className="text-[10px] uppercase tracking-[0.18em] text-cyan-300/80">Admin workspace</p>
        <h2 className="mt-1 font-display text-xl font-bold text-neon-100">TON withdrawals</h2>
        <p className="mt-2 text-xs leading-relaxed text-neon-400">Review player requests, approve or reject them, then record the transaction after an external TON transfer is completed.</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-white/10 bg-black/30 p-3"><p className="text-[9px] text-neon-600">Pending</p><p className="mt-1 font-display text-xl text-amber-200">{pending}</p></div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-3"><p className="text-[9px] text-neon-600">Approved</p><p className="mt-1 font-display text-xl text-cyan-200">{approved}</p></div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-3"><p className="text-[9px] text-neon-600">Processing</p><p className="mt-1 font-display text-xl text-violet-200">{processing}</p></div>
        </div>
      </div>

      {notice && <div role="status" className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-3 text-xs text-emerald-200"><ShieldCheck size={14} className="mr-2 inline"/>{notice}</div>}
      {error && <div role="alert" className="rounded-xl border border-red-400/25 bg-red-400/10 p-3 text-xs text-red-200">{error}</div>}

      <div className="flex items-center justify-between gap-3">
        <div><h3 className="text-sm font-semibold text-neon-200">Open requests</h3><p className="mt-1 text-[10px] text-neon-600">Oldest requests appear first.</p></div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg border border-neon/20 p-2 text-neon-300 disabled:opacity-40" aria-label="Refresh TON withdrawals"><RefreshCw size={14} className={loading ? 'animate-spin' : ''}/></button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-xs text-neon-600"><LoaderCircle size={15} className="animate-spin"/>Loading withdrawal requests…</div>
      ) : requests.length === 0 ? (
        <div className="rounded-xl border border-neon/15 bg-black/20 py-9 text-center"><CheckCircle2 size={24} className="mx-auto text-emerald-300"/><p className="mt-2 text-xs text-neon-300">No open withdrawal requests</p><p className="mt-1 text-[10px] text-neon-600">New verified player requests will appear here.</p></div>
      ) : requests.map((request) => {
        const playerName = request.username ? '@' + request.username : request.first_name || 'Player';
        const amount = nanoTonToTon(request.amount_nano);
        return (
          <article key={request.id} className="space-y-3 rounded-2xl border border-neon/15 bg-black/30 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><p className="text-sm font-semibold text-neon-100">{playerName}</p><p className="mt-1 text-[9px] text-neon-600">Telegram ID: {request.telegram_id}</p></div>
              <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300/20 bg-cyan-300/5 px-2 py-1 text-[9px] capitalize text-cyan-200"><Clock3 size={10}/>{request.status}</span>
            </div>
            <div className="rounded-xl border border-neon/10 bg-black/30 p-3">
              <p className="font-display text-2xl font-bold text-white">{amount} <span className="text-xs font-normal text-neon-500">TON</span></p>
              <p className="mt-2 break-all font-mono text-[10px] text-neon-300">Payout wallet: {shortAddress(request.wallet_address)}</p>
              <p className="mt-1 text-[9px] text-neon-700">Requested {new Date(request.created_at).toLocaleString()}</p>
            </div>
            <label className="block space-y-1"><span className="text-[10px] text-neon-500">Admin note <span className="text-neon-700">(optional)</span></span><textarea rows={2} maxLength={1000} value={notes[request.id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Add a note for the audit record…" className="w-full resize-y rounded-lg border border-neon/15 bg-black/40 px-3 py-2 text-xs text-neon-100 outline-none focus:border-cyan-300/40"/></label>

            {request.status === 'pending' && <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={workingId !== null} onClick={() => void act(request, 'approve')} className="flex items-center justify-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2.5 text-[10px] font-semibold text-emerald-200 disabled:opacity-40">{workingId === request.id ? <LoaderCircle size={13} className="animate-spin"/> : <CheckCircle2 size={13}/>}Approve</button>
              <button type="button" disabled={workingId !== null} onClick={() => void act(request, 'reject')} className="flex items-center justify-center gap-2 rounded-lg border border-red-400/25 bg-red-400/10 px-3 py-2.5 text-[10px] font-semibold text-red-200 disabled:opacity-40"><XCircle size={13}/>Reject and return funds</button>
            </div>}

            {request.status === 'approved' && <div className="space-y-2">
              <p className="text-[10px] leading-relaxed text-amber-200">Next, arrange the TON transfer to the payout wallet using your external wallet. Only mark it paid after the transfer is confirmed.</p>
              <button type="button" disabled={workingId !== null} onClick={() => void act(request, 'processing')} className="w-full rounded-lg border border-violet-400/25 bg-violet-400/10 px-3 py-2.5 text-[10px] font-semibold text-violet-200 disabled:opacity-40">{workingId === request.id ? 'Updating…' : 'Move to processing'}</button>
            </div>}

            {request.status === 'processing' && <div className="space-y-2">
              <p className="text-[10px] leading-relaxed text-amber-200">After sending TON externally, enter its transaction hash below. ZORD does not send the transfer automatically.</p>
              <input value={hashes[request.id] ?? ''} onChange={(event) => setHashes((current) => ({ ...current, [request.id]: event.target.value }))} maxLength={200} placeholder="TON transaction hash / reference" className="w-full rounded-lg border border-neon/15 bg-black/40 px-3 py-2 font-mono text-[10px] text-neon-100 outline-none focus:border-cyan-300/40"/>
              <button type="button" disabled={workingId !== null} onClick={() => void act(request, 'paid')} className="w-full rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2.5 text-[10px] font-semibold text-emerald-200 disabled:opacity-40">{workingId === request.id ? 'Recording…' : 'Mark as paid'}</button>
            </div>}
          </article>
        );
      })}

      <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-[10px] leading-relaxed text-amber-200">Important: ZORD records approvals and transaction references. It does not hold a private key or automatically send TON. Rejecting a request releases its reserved amount back to the player.</p>
    </section>
  );
}
