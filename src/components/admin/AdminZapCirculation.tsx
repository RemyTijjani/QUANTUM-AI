import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Activity, ArrowLeftRight, Coins, RefreshCw, Search, TrendingDown, TrendingUp, Users } from 'lucide-react';
import {
  AdminApiError,
  getZapCirculation,
} from '@/lib/admin/adminApi';
import type { AdminZapCirculationData } from '@/lib/admin/adminApi';

interface Props { creds: { username: string; password: string } }

function amount(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  try { return BigInt(String(value)).toLocaleString(); }
  catch { const n = Number(value); return Number.isFinite(n) ? n.toLocaleString() : String(value); }
}
function dateLabel(value: string | null): string {
  if (!value) return 'No activity';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export default function AdminZapCirculation({ creds }: Props) {
  const [data, setData] = useState<AdminZapCirculationData | null>(null);
  const [search, setSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [playerOffset, setPlayerOffset] = useState(0);
  const [ledgerOffset, setLedgerOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (term: string, nextPlayerOffset: number, nextLedgerOffset: number) => {
    setLoading(true);
    setError('');
    try {
      setData(await getZapCirculation(creds, {
        search: term,
        playerOffset: nextPlayerOffset,
        ledgerOffset: nextLedgerOffset,
      }));
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Could not load ZAP circulation.');
    } finally {
      setLoading(false);
    }
  }, [creds]);

  useEffect(() => { void load('', 0, 0); }, [load]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const term = search.trim();
    setActiveSearch(term);
    setPlayerOffset(0);
    void load(term, 0, ledgerOffset);
  };

  const refresh = () => void load(activeSearch, playerOffset, ledgerOffset);
  const summary = data?.summary;

  return (
    <section className="space-y-4 rounded-2xl border border-cyan-400/20 bg-[#0d1719] p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-cyan-100"><Coins size={17} className="text-cyan-300"/> ZAP circulation & ledger</h2>
          <p className="mt-1 text-[11px] text-slate-400">Read-only treasury-wide ZAP accounting from the verified wallet ledger.</p>
        </div>
        <button type="button" onClick={refresh} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[10px] text-slate-300 disabled:opacity-50"><RefreshCw size={12} className={loading ? 'animate-spin' : ''}/> Refresh</button>
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-400/20 bg-red-500/10 p-3 text-xs text-red-200">{error}</p>}

      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-3">
          <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-cyan-200"><Coins size={12}/> ZAP held now</p>
          <p className="mt-2 break-all font-display text-xl font-bold text-white">{loading && !summary ? '…' : amount(summary?.totalHeld)}</p>
        </div>
        <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/5 p-3">
          <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-emerald-200"><TrendingUp size={12}/> Lifetime earned</p>
          <p className="mt-2 break-all font-display text-xl font-bold text-white">{loading && !summary ? '…' : amount(summary?.lifetimeEarned)}</p>
        </div>
        <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-3">
          <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-amber-200"><TrendingDown size={12}/> Lifetime spent</p>
          <p className="mt-2 break-all font-display text-xl font-bold text-white">{loading && !summary ? '…' : amount(summary?.lifetimeSpent)}</p>
        </div>
        <div className="rounded-xl border border-violet-300/20 bg-violet-300/5 p-3">
          <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-violet-200"><ArrowLeftRight size={12}/> Transfers</p>
          <p className="mt-2 font-display text-xl font-bold text-white">{loading && !summary ? '…' : amount(summary?.transferCount)}</p>
          <p className="mt-1 text-[9px] text-violet-200/70">{amount(summary?.transferredAmount)} ZAP moved</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-slate-400">
        <span className="inline-flex items-center gap-1.5"><Users size={12}/> {amount(summary?.playersHolding)} players holding ZAP</span>
        <span>{amount(summary?.totalPlayers)} registered players</span>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-xs font-semibold text-slate-100">Player ZAP balances</h3>
          <p className="mt-1 text-[10px] text-slate-500">Search by username, name, referral code or Telegram ID. Results are sorted by current balance.</p>
        </div>
        <form onSubmit={submitSearch} className="flex flex-col gap-2 sm:flex-row">
          <input value={search} onChange={event => setSearch(event.target.value)} maxLength={64} placeholder="Search ZORD players…" className="admin-field min-w-0 flex-1"/>
          <button type="submit" disabled={loading} className="inline-flex items-center justify-center gap-2 border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-[10px] font-semibold text-cyan-100 disabled:opacity-50"><Search size={12}/> Search</button>
          <button type="button" disabled={loading} onClick={() => {setSearch('');setActiveSearch('');setPlayerOffset(0);void load('',0,ledgerOffset);}} className="border border-white/10 px-3 py-2 text-[10px] text-slate-400 disabled:opacity-50">Clear</button>
        </form>
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead className="bg-white/[0.03]"><tr className="border-b border-white/10 text-[9px] uppercase tracking-wider text-slate-400">
              <th className="px-3 py-3">Player</th><th className="px-3 py-3">Referral code</th><th className="px-3 py-3">Current ZAP</th><th className="px-3 py-3">Lifetime earned</th><th className="px-3 py-3">Lifetime spent</th><th className="px-3 py-3">Last activity</th>
            </tr></thead>
            <tbody>
              {data?.players.map(player => <tr key={player.player_id} className="border-b border-white/5 text-[10px] text-slate-200">
                <td className="px-3 py-3"><span className="font-semibold">{player.first_name || 'Unnamed player'}</span><span className="mt-1 block text-slate-500">{player.username ? '@'+player.username : 'No username'}</span></td>
                <td className="px-3 py-3 font-mono">{player.referral_code || '—'}</td>
                <td className="px-3 py-3 font-mono text-cyan-200">{amount(player.balance)}</td>
                <td className="px-3 py-3 font-mono text-emerald-200">{amount(player.lifetime_earned)}</td>
                <td className="px-3 py-3 font-mono text-amber-200">{amount(player.lifetime_spent)}</td>
                <td className="px-3 py-3 text-slate-400">{dateLabel(player.last_activity)}</td>
              </tr>)}
              {!loading && (data?.players.length ?? 0)===0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-slate-500">No matching player records.</td></tr>}
              {loading && !data && <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-slate-500">Loading ZAP accounts…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
          <span>{data ? `Showing ${data.playerCount===0?0:playerOffset+1}–${playerOffset+(data.players.length)} of ${data.playerCount}` : '—'}</span>
          <div className="flex gap-2">
            <button type="button" disabled={loading || playerOffset===0} onClick={() => {const n=Math.max(0,playerOffset-50);setPlayerOffset(n);void load(activeSearch,n,ledgerOffset);}} className="rounded border border-white/10 px-3 py-1.5 disabled:opacity-30">Previous</button>
            <button type="button" disabled={loading || !data || playerOffset+data.players.length>=data.playerCount} onClick={() => {const n=playerOffset+50;setPlayerOffset(n);void load(activeSearch,n,ledgerOffset);}} className="rounded border border-white/10 px-3 py-1.5 disabled:opacity-30">Next</button>
          </div>
        </div>
      </div>

      <div className="space-y-3 border-t border-white/10 pt-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><h3 className="flex items-center gap-2 text-xs font-semibold text-slate-100"><Activity size={13} className="text-cyan-300"/> Complete ZAP ledger history</h3><p className="mt-1 text-[10px] text-slate-500">Every verified credit and debit, newest first. Browse in pages of 100.</p></div>
          <span className="text-[10px] text-slate-400">{amount(data?.ledgerCount)} records</span>
        </div>
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead className="bg-white/[0.03]"><tr className="border-b border-white/10 text-[9px] uppercase tracking-wider text-slate-400">
              <th className="px-3 py-3">Player</th><th className="px-3 py-3">Type / source</th><th className="px-3 py-3">Amount</th><th className="px-3 py-3">Balance after</th><th className="px-3 py-3">Reference</th><th className="px-3 py-3">Date</th>
            </tr></thead>
            <tbody>
              {data?.ledger.map(entry => <tr key={entry.id} className="border-b border-white/5 text-[10px] text-slate-300">
                <td className="px-3 py-3">{entry.player_name}</td>
                <td className="px-3 py-3"><span className={entry.entry_type==='credit'?'text-emerald-300':'text-amber-300'}>{entry.entry_type}</span><span className="mt-1 block text-slate-500">{entry.source}</span></td>
                <td className="px-3 py-3 font-mono">{entry.entry_type==='credit'?'+':'−'}{amount(entry.amount)} ZAP</td>
                <td className="px-3 py-3 font-mono">{amount(entry.balance_after)}</td>
                <td className="max-w-[180px] truncate px-3 py-3 text-slate-500" title={entry.source_reference}>{entry.description || entry.source_reference}</td>
                <td className="px-3 py-3 text-slate-500">{dateLabel(entry.created_at)}</td>
              </tr>)}
              {!loading && (data?.ledger.length ?? 0)===0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-slate-500">No ZAP ledger entries yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
          <span>{data ? `Showing ${data.ledgerCount===0?0:ledgerOffset+1}–${ledgerOffset+data.ledger.length} of ${data.ledgerCount}` : '—'}</span>
          <div className="flex gap-2">
            <button type="button" disabled={loading || ledgerOffset===0} onClick={() => {const n=Math.max(0,ledgerOffset-100);setLedgerOffset(n);void load(activeSearch,playerOffset,n);}} className="rounded border border-white/10 px-3 py-1.5 disabled:opacity-30">Newer</button>
            <button type="button" disabled={loading || !data || ledgerOffset+data.ledger.length>=data.ledgerCount} onClick={() => {const n=ledgerOffset+100;setLedgerOffset(n);void load(activeSearch,playerOffset,n);}} className="rounded border border-white/10 px-3 py-1.5 disabled:opacity-30">Older</button>
          </div>
        </div>
      </div>
      <p className="text-[9px] text-slate-500">Administrative reporting only. This screen cannot credit, debit, edit or withdraw ZAP.</p>
    </section>
  );
}
