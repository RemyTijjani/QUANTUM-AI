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
  const [requestSearch, setRequestSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('open');

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
    if (action === 'approve' && !window.confirm('Approve this withdrawal? The requested Gram will remain reserved until payment is recorded.')) return;
    if (action === 'reject' && !window.confirm('Reject this withdrawal? The reserved Gram will be returned to the player’s available balance.')) return;
    if (action === 'paid' && !window.confirm('Record this withdrawal as paid? Only continue after you have confirmed the external Gram transfer succeeded.')) return;
    setWorkingId(request.id);
    setError('');
    setNotice('');
    try {
      if (action === 'paid') {
        const hash = (hashes[request.id] ?? '').trim();
        if (hash.length < 32 || hash.length > 200 || /\s/.test(hash)) {
          setError('Enter the transaction hash/reference from the completed Gram transfer (32–200 characters, no spaces).');
          return;
        }
      }
      await reviewAdminTonWithdrawal(creds, {
        requestId: request.id,
        action,
        note: notes[request.id] ?? '',
        ...(action === 'paid' ? { transactionHash: hashes[request.id] } : {}),
      });
      const messages: Record<AdminTonWithdrawalAction, string> = {
        approve: 'Withdrawal approved. The Gram remains reserved until payment is recorded.',
        reject: 'Withdrawal rejected. The reserved Gram has been returned to the player’s available balance.',
        processing: 'Withdrawal moved to processing. Complete the transfer outside ZORD before marking it paid.',
        paid: 'Payment recorded. The reserved Gram has been settled in the player ledger.',
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
  const visibleRequests = requests.filter((request) => {
    const term = requestSearch.trim().toLowerCase();
    const playerLabel = `${request.username ?? ''} ${request.first_name ?? ''} ${request.telegram_id}`.toLowerCase();
    const matchesSearch = !term || playerLabel.includes(term) || request.wallet_address.toLowerCase().includes(term);
    const isOpen = ['pending', 'approved', 'processing'].includes(request.status);
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'open' ? isOpen : request.status === statusFilter);
    return matchesSearch && matchesStatus;
  });

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-cyan-400/10 via-black/50 to-neon/5 p-4">
        <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-300">Admin workspace</p>
        <h2 className="mt-1 font-display text-xl font-bold text-white">Gram withdrawals</h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-300">Review player requests, approve or reject them, then record the transaction after an external Gram transfer is completed.</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-white/10 bg-[#101a14] p-3"><p className="text-[9px] text-slate-400">Pending</p><p className="mt-1 font-display text-xl text-amber-200">{pending}</p></div>
          <div className="rounded-xl border border-white/10 bg-[#101a14] p-3"><p className="text-[9px] text-slate-400">Approved</p><p className="mt-1 font-display text-xl text-emerald-200">{approved}</p></div>
          <div className="rounded-xl border border-white/10 bg-[#101a14] p-3"><p className="text-[9px] text-slate-400">Processing</p><p className="mt-1 font-display text-xl text-violet-200">{processing}</p></div>
        </div>
      </div>

      {notice && <div role="status" className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-3 text-xs text-emerald-200"><ShieldCheck size={14} className="mr-2 inline"/>{notice}</div>}
      {error && <div role="alert" className="rounded-xl border border-red-400/25 bg-red-400/10 p-3 text-xs text-red-200">{error}</div>}

      <div className="flex items-center justify-between gap-3">
        <div><h3 className="text-sm font-semibold text-slate-100">Open requests</h3><p className="mt-1 text-[10px] text-slate-400">Oldest requests appear first.</p></div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg border border-white/10 p-2 text-emerald-300 disabled:opacity-40" aria-label="Refresh Gram withdrawals"><RefreshCw size={14} className={loading ? 'animate-spin' : ''}/></button>
      </div>

      {!loading && requests.length > 0 && (
        <div className="grid gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:grid-cols-[1fr_200px]">
          <label className="block"><span className="mb-1 block text-[10px] text-slate-400">Search requests</span><input value={requestSearch} onChange={(event) => setRequestSearch(event.target.value)} placeholder="Player name, Telegram ID or wallet address" className="admin-field" /></label>
          <label className="block"><span className="mb-1 block text-[10px] text-slate-400">Filter by status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="admin-field"><option value="open">Open requests ({pending + approved + processing})</option><option value="all">All statuses ({requests.length})</option><option value="pending">Pending ({pending})</option><option value="approved">Approved ({approved})</option><option value="processing">Processing ({processing})</option><option value="paid">Paid</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></select></label>
        </div>
      )}

      {loading ? (
        <div role="status" className="flex items-center justify-center gap-2 py-10 text-xs text-slate-400"><LoaderCircle size={15} className="animate-spin"/>Loading withdrawal requests…</div>
      ) : requests.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#101a14] py-9 text-center"><CheckCircle2 size={24} className="mx-auto text-emerald-300"/><p className="mt-2 text-xs text-emerald-300">No withdrawal requests</p><p className="mt-1 text-[10px] text-slate-400">New verified player requests will appear here.</p></div>
      ) : visibleRequests.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 py-9 text-center"><p className="text-xs font-semibold text-slate-200">No matching requests</p><p className="mt-1 text-[10px] text-slate-400">Try another search or status filter.</p><button type="button" onClick={() => { setRequestSearch(''); setStatusFilter('all'); }} className="mt-3 text-xs text-emerald-300">Clear search and filters</button></div>
      ) : visibleRequests.map((request) => {
        const playerName = request.username ? '@' + request.username : request.first_name || 'Player';
        const amount = nanoTonToTon(request.amount_nano);
        return (
          <article key={request.id} className="space-y-3 rounded-2xl border border-white/10 bg-[#101a14] p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><p className="text-sm font-semibold text-white">{playerName}</p><p className="mt-1 text-[9px] text-slate-400">Telegram ID: {request.telegram_id}</p></div>
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-cyan-300/5 px-2 py-1 text-[9px] capitalize text-emerald-200"><Clock3 size={10}/>{request.status}</span>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#101a14] p-3">
              <p className="font-display text-2xl font-bold text-white">{amount} <span className="text-xs font-normal text-slate-400">Gram</span></p>
              <p className="mt-2 break-all font-mono text-[10px] text-emerald-300">Payout wallet: {shortAddress(request.wallet_address)}</p>
              <p className="mt-1 text-[9px] text-slate-500">Requested {new Date(request.created_at).toLocaleString()}</p>
            </div>
            <label className="block space-y-1"><span className="text-[10px] text-slate-400">Admin note <span className="text-slate-500">(optional)</span></span><textarea rows={2} maxLength={1000} value={notes[request.id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Add a note for the audit record…" className="admin-field resize-y"/></label>

            {request.status === 'pending' && <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={workingId !== null} onClick={() => void act(request, 'approve')} className="flex items-center justify-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2.5 text-[10px] font-semibold text-emerald-200 disabled:opacity-40">{workingId === request.id ? <LoaderCircle size={13} className="animate-spin"/> : <CheckCircle2 size={13}/>}Approve</button>
              <button type="button" disabled={workingId !== null} onClick={() => void act(request, 'reject')} className="flex items-center justify-center gap-2 rounded-lg border border-red-400/25 bg-red-400/10 px-3 py-2.5 text-[10px] font-semibold text-red-200 disabled:opacity-40"><XCircle size={13}/>Reject and return funds</button>
            </div>}

            {request.status === 'approved' && <div className="space-y-2">
              <p className="text-[10px] leading-relaxed text-amber-200">Next, arrange the Gram transfer to the payout wallet using your external wallet. Only mark it paid after the transfer is confirmed.</p>
              <button type="button" disabled={workingId !== null} onClick={() => void act(request, 'processing')} className="w-full rounded-lg border border-violet-400/25 bg-violet-400/10 px-3 py-2.5 text-[10px] font-semibold text-violet-200 disabled:opacity-40">{workingId === request.id ? 'Updating…' : 'Move to processing'}</button>
            </div>}

            {request.status === 'processing' && <div className="space-y-2">
              <p className="text-[10px] leading-relaxed text-amber-200">After sending Gram externally, enter its transaction hash below. ZORD does not send the transfer automatically.</p>
              <input value={hashes[request.id] ?? ''} onChange={(event) => setHashes((current) => ({ ...current, [request.id]: event.target.value }))} maxLength={200} placeholder="Gram transaction hash / reference" className="admin-field font-mono text-xs"/>
              <button type="button" disabled={workingId !== null} onClick={() => void act(request, 'paid')} className="w-full rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2.5 text-[10px] font-semibold text-emerald-200 disabled:opacity-40">{workingId === request.id ? 'Recording…' : 'Mark as paid'}</button>
            </div>}
          </article>
        );
      })}

      <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-[10px] leading-relaxed text-amber-200">Important: ZORD records approvals and transaction references. It does not hold a private key or automatically send Gram. Rejecting a request releases its reserved amount back to the player.</p>
    </section>
  );
}
