import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { BadgeCheck, Clock3, Gift, Info, RefreshCw, Ticket, Trophy, Wallet } from 'lucide-react';

type Raffle = {
  id: string;
  title: string;
  description: string;
  reward_type: 'ton' | 'zap' | 'agent';
  reward_code: string | null;
  prize_pool_amount: number | string;
  prize_currency: 'TON' | 'ZAP' | 'AGENT';
  min_bet_zap: number | string;
  entry_mode: 'one_bet_one_entry' | 'proportional';
  winner_count: number;
  winner_method: 'random' | 'admin';
  status: string;
  starts_at: string | null;
  ends_at: string | null;
};
type Entry = { id: string; raffle_id: string; stake_zap: number | string; ticket_count: number; created_at: string };
type WalletResponse = { balance?: number | string };
const number = (value: number | string | null | undefined) => Number(value ?? 0);
const fmt = (value: number | string) => number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
const rewardLabel = (raffle: Raffle) => raffle.reward_type === 'agent'
  ? raffle.reward_code === 'alpha' ? 'ZORD Alpha Miner Agent' : 'ZORD Overclocked Core Agent'
  : `${fmt(raffle.prize_pool_amount)} ${raffle.prize_currency}`;

export default function RafflesScreen() {
  const [raffles, setRaffles] = useState<Raffle[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [selected, setSelected] = useState<Raffle | null>(null);
  const [stake, setStake] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const refresh = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError('');
    const [raffleResult, walletResult] = await Promise.all([
      supabase.functions.invoke('raffle-actions', { method: 'GET' }),
      supabase.functions.invoke('zap-wallet', { method: 'GET' }),
    ]);
    if (raffleResult.error || !raffleResult.data?.success) {
      setError(raffleResult.data?.error || raffleResult.error?.message || 'We could not load raffles. Please try again.');
    } else {
      setRaffles(Array.isArray(raffleResult.data.raffles) ? raffleResult.data.raffles : []);
      setEntries(Array.isArray(raffleResult.data.myEntries) ? raffleResult.data.myEntries : []);
    }
    if (!walletResult.error && walletResult.data?.wallet) {
      const wallet = walletResult.data.wallet as WalletResponse;
      setBalance(number(wallet.balance));
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const entriesByRaffle = useMemo(() => entries.reduce<Record<string, Entry[]>>((map, entry) => {
    (map[entry.raffle_id] ??= []).push(entry);
    return map;
  }, {}), [entries]);

  const previewTickets = selected && Number(stake) >= number(selected.min_bet_zap)
    ? selected.entry_mode === 'one_bet_one_entry' ? 1 : Math.floor(Number(stake) / number(selected.min_bet_zap))
    : 0;

  const enter = async () => {
    if (!selected || submitting || !Number.isFinite(Number(stake)) || Number(stake) < number(selected.min_bet_zap)) return;
    setSubmitting(true);
    setError('');
    setSuccess('');
    const { data, error: requestError } = await supabase.functions.invoke('raffle-actions', {
      body: { action: 'enter', raffleId: selected.id, stakeZap: stake, idempotencyKey: crypto.randomUUID() },
    });
    setSubmitting(false);
    if (requestError || !data?.success) {
      setError(data?.error || requestError?.message || 'Your entry could not be completed. No entry was confirmed.');
      return;
    }
    setSuccess(`Entry confirmed! You received ${data.entry.ticketCount} ticket(s).`);
    setSelected(null);
    setStake('');
    await refresh(true);
  };

  const openRaffle = (raffle: Raffle) => {
    setSelected(raffle);
    setStake(String(raffle.min_bet_zap));
    setError('');
    setSuccess('');
  };

  const statusText = (raffle: Raffle) => {
    if (raffle.starts_at && Date.now() < new Date(raffle.starts_at).getTime()) return 'Starts soon';
    if (raffle.ends_at) return `Closes ${new Date(raffle.ends_at).toLocaleString()}`;
    return 'Open for entries';
  };

  return (
    <section className="space-y-4 pb-4">
      <div className="rounded-2xl border border-cyan-300/20 bg-gradient-to-br from-cyan-400/10 via-black/60 to-neon/5 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-300/80">Play · Enter · Win</p>
            <h2 className="mt-1 font-display text-xl font-bold text-neon-100">Raffles</h2>
            <p className="mt-2 max-w-sm text-xs leading-relaxed text-neon-400">Use ZAP to enter active draws. Check the prize, minimum entry and ticket rules before you confirm.</p>
          </div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-300/10 text-cyan-200"><Trophy size={20}/></span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <p className="flex items-center gap-1.5 text-[10px] text-neon-500"><Wallet size={12}/> Your ZAP balance</p>
            <p className="mt-1 font-display text-lg text-cyan-200">{balance === null ? '—' : fmt(balance)} <span className="text-[10px]">ZAP</span></p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <p className="flex items-center gap-1.5 text-[10px] text-neon-500"><Ticket size={12}/> Your entries</p>
            <p className="mt-1 font-display text-lg text-neon-100">{entries.length}</p>
          </div>
        </div>
      </div>

      {success && <div role="status" className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-3 text-xs text-emerald-200"><BadgeCheck size={15} className="mr-2 inline"/> {success}</div>}
      {error && !selected && <div role="alert" className="rounded-xl border border-red-400/25 bg-red-400/10 p-3 text-xs text-red-200">{error}</div>}

      <div className="flex items-center justify-between gap-3">
        <div><h3 className="font-display text-sm font-semibold text-neon-200">Available raffles</h3><p className="mt-0.5 text-[10px] text-neon-600">Only published raffles appear here.</p></div>
        <button type="button" onClick={() => void refresh(true)} disabled={refreshing || loading} aria-label="Refresh raffles" className="rounded-lg border border-neon/20 p-2 text-neon-300 disabled:opacity-40"><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''}/></button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-neon/15 bg-black/20 py-10 text-center text-xs text-neon-500">Loading available raffles…</div>
      ) : error && raffles.length === 0 ? (
        <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-center"><p className="text-xs text-red-200">{error}</p><button type="button" onClick={() => void refresh()} className="mt-3 rounded-lg border border-neon/30 px-4 py-2 text-xs text-neon-200">Try again</button></div>
      ) : raffles.length === 0 ? (
        <div className="rounded-xl border border-neon/15 bg-black/20 px-5 py-10 text-center">
          <Gift size={28} className="mx-auto text-neon-500"/>
          <p className="mt-3 text-sm font-semibold text-neon-200">No raffles are open right now</p>
          <p className="mt-1 text-xs leading-relaxed text-neon-600">Check back soon. New raffles will appear here when the Admin publishes them.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {raffles.map((raffle) => {
            const mine = entriesByRaffle[raffle.id] ?? [];
            const tickets = mine.reduce((sum, entry) => sum + entry.ticket_count, 0);
            return (
              <article key={raffle.id} className="overflow-hidden rounded-2xl border border-neon/20 bg-black/35">
                <div className="border-b border-neon/10 bg-gradient-to-r from-neon/5 to-transparent p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="text-[9px] uppercase tracking-widest text-cyan-300">Prize pool</p><h4 className="mt-1 break-words font-display text-lg font-bold text-neon-100">{rewardLabel(raffle)}</h4></div>
                    <span className="shrink-0 rounded-full border border-emerald-400/25 bg-emerald-400/5 px-2.5 py-1 text-[9px] text-emerald-200">Open</span>
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-neon-200">{raffle.title}</h3>
                  {raffle.description && <p className="mt-1 text-xs leading-relaxed text-neon-500">{raffle.description}</p>}
                </div>
                <div className="grid grid-cols-2 gap-2 p-4">
                  <div className="rounded-lg bg-white/[0.03] p-2.5"><p className="text-[9px] text-neon-600">Minimum entry</p><p className="mt-1 text-xs font-semibold text-neon-200">{fmt(raffle.min_bet_zap)} ZAP</p></div>
                  <div className="rounded-lg bg-white/[0.03] p-2.5"><p className="text-[9px] text-neon-600">Winners</p><p className="mt-1 text-xs font-semibold text-neon-200">{raffle.winner_count}</p></div>
                  <div className="rounded-lg bg-white/[0.03] p-2.5"><p className="text-[9px] text-neon-600">Entry rule</p><p className="mt-1 text-[10px] text-neon-300">{raffle.entry_mode === 'one_bet_one_entry' ? 'One bet = one ticket' : 'More ZAP = more tickets'}</p></div>
                  <div className="rounded-lg bg-white/[0.03] p-2.5"><p className="text-[9px] text-neon-600">Your tickets</p><p className="mt-1 text-xs font-semibold text-cyan-200">{tickets}</p></div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neon/10 px-4 py-3">
                  <span className="flex items-center gap-1.5 text-[9px] text-neon-600"><Clock3 size={12}/>{statusText(raffle)}</span>
                  <button type="button" onClick={() => openRaffle(raffle)} className="rounded-lg bg-neon/15 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-neon-200 transition hover:bg-neon/25">Enter raffle</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/80 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="raffle-entry-title">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-cyan-300/30 bg-[#07100d] p-4 shadow-2xl sm:p-5">
            <div className="flex items-start justify-between gap-3"><div><p className="text-[9px] uppercase tracking-widest text-cyan-300">Entry details</p><h3 id="raffle-entry-title" className="mt-1 text-lg font-semibold text-neon-100">{selected.title}</h3></div><button type="button" onClick={() => setSelected(null)} className="rounded-lg border border-neon/20 px-3 py-1.5 text-xs text-neon-400">Close</button></div>
            <div className="rounded-xl border border-neon/15 bg-black/30 p-3"><p className="text-[9px] text-neon-600">Prize pool</p><p className="mt-1 font-display text-lg text-cyan-200">{rewardLabel(selected)}</p></div>
            <label className="block space-y-1.5"><span className="text-xs text-neon-300">How much ZAP would you like to enter with?</span><input type="number" inputMode="decimal" min={selected.min_bet_zap} step="any" value={stake} onChange={(event) => setStake(event.target.value)} className="w-full rounded-xl border border-neon/25 bg-black/50 px-3 py-3 text-sm text-neon-100 outline-none focus:border-cyan-300/60"/><span className="block text-[10px] text-neon-600">Minimum: {fmt(selected.min_bet_zap)} ZAP · Your balance: {balance === null ? 'unavailable' : `${fmt(balance)} ZAP`}</span></label>
            <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-3"><div className="flex items-center justify-between text-xs"><span className="text-neon-500">Tickets you'll receive</span><strong className="text-cyan-200">{previewTickets}</strong></div><p className="mt-1 text-[9px] leading-relaxed text-neon-600">{selected.entry_mode === 'one_bet_one_entry' ? 'Every qualifying bet gives one ticket.' : `Every ${fmt(selected.min_bet_zap)} ZAP gives one ticket. Any remainder does not add a ticket.`}</p></div>
            {error && <p role="alert" className="rounded-lg border border-red-400/20 bg-red-400/5 p-2 text-xs text-red-200">{error}</p>}
            <div className="flex items-start gap-2 text-[10px] leading-relaxed text-amber-200/80"><Info size={14} className="mt-0.5 shrink-0"/>Your entry stake goes to the platform treasury and does not increase this prize pool. Entries cannot be refunded after confirmation.</div>
            <button type="button" onClick={() => void enter()} disabled={submitting || previewTickets < 1 || (balance !== null && Number(stake) > balance)} className="w-full rounded-xl bg-cyan-300/15 py-3 text-xs font-bold uppercase tracking-wider text-cyan-100 transition hover:bg-cyan-300/25 disabled:cursor-not-allowed disabled:opacity-40">{submitting ? 'Confirming entry…' : `Confirm entry · ${stake || '0'} ZAP`}</button>
          </div>
        </div>
      )}
    </section>
  );
}
