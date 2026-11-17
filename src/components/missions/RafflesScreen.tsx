import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { BadgeCheck, Clock3, Gift, Info, RefreshCw, Ticket, Trophy, Wallet } from 'lucide-react';

type Raffle = {
  id: string;
  title: string;
  description: string;
  reward_type: 'ton' | 'zap';
  reward_code: string | null;
  prize_pool_amount: number | string;
  prize_currency: 'TON' | 'ZAP';
  min_bet_zap: number | string;
  entry_mode: 'one_bet_one_entry' | 'proportional';
  winner_count: number;
  winner_method: 'random' | 'admin';
  status: string;
  starts_at: string | null;
  ends_at: string | null;
};
type Entry = { id: string; raffle_id: string; stake_zap: number | string; ticket_count: number; created_at: string };
type RaffleHistory = { id: string; title: string; status: string; prize_pool_amount: number | string; prize_currency: 'TON' | 'ZAP' | 'AGENT'; closed_at: string | null; drawn_at: string | null; myPrize: null | { id: string; prize_amount: number | string; prize_currency: 'TON' | 'ZAP' | 'AGENT'; reward_code: string | null; selection_method: 'random' | 'admin'; selected_at: string; delivery_status: 'pending' | 'credited' | 'withdrawable' | 'delivered' | 'failed' } };
type WalletResponse = { balance?: number | string };
const number = (value: number | string | null | undefined) => Number(value ?? 0);
const fmt = (value: number | string, currency: 'TON' | 'ZAP' | 'AGENT' = 'ZAP') => number(value).toLocaleString(undefined, { maximumFractionDigits: currency === 'TON' ? 9 : 8 });
const currencyLabel = (currency: 'TON' | 'ZAP' | 'AGENT') => currency === 'TON' ? 'Gram' : currency;
const rewardLabel = (raffle: Raffle) => `${fmt(raffle.prize_pool_amount, raffle.prize_currency)} ${currencyLabel(raffle.prize_currency)}`;
const countdownText = (target: string, now: number) => {
  const total = Math.max(0, Math.floor((new Date(target).getTime() - now) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${days ? `${days}d ` : ''}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export default function RafflesScreen() {
  const [raffles, setRaffles] = useState<Raffle[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [raffleHistory, setRaffleHistory] = useState<RaffleHistory[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [selected, setSelected] = useState<Raffle | null>(null);
  const [stake, setStake] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [clockNow, setClockNow] = useState(Date.now());

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
      setRaffleHistory(Array.isArray(raffleResult.data.myRaffleHistory) ? raffleResult.data.myRaffleHistory : []);
    }
    if (!walletResult.error && walletResult.data?.wallet) {
      const wallet = walletResult.data.wallet as WalletResponse;
      setBalance(number(wallet.balance));
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const entriesByRaffle = useMemo(() => entries.reduce<Record<string, Entry[]>>((map, entry) => {
    (map[entry.raffle_id] ??= []).push(entry);
    return map;
  }, {}), [entries]);

  const stakeAmount = Number(stake);
  const validStake = selected !== null && stake.trim() !== '' && Number.isFinite(stakeAmount) && stakeAmount >= number(selected.min_bet_zap);
  const previewTickets = selected && validStake
    ? selected.entry_mode === 'one_bet_one_entry' ? 1 : Math.floor(stakeAmount / number(selected.min_bet_zap))
    : 0;
  const insufficientBalance = balance !== null && validStake && stakeAmount > balance;
  const balanceAfterEntry = balance !== null && validStake ? Math.max(0, balance - stakeAmount) : null;

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

  const raffleState = (raffle: Raffle): 'upcoming' | 'open' | 'closed' => {
    const now = Date.now();
    if (raffle.status === 'closed' || (raffle.ends_at && now >= new Date(raffle.ends_at).getTime())) return 'closed';
    if (raffle.starts_at && now < new Date(raffle.starts_at).getTime()) return 'upcoming';
    return raffle.status === 'published' ? 'open' : 'closed';
  };


  const statusText = (raffle: Raffle) => {
    const state = raffleState(raffle);
    if (state === 'upcoming' && raffle.starts_at) return `Starts in ${countdownText(raffle.starts_at, clockNow)}`;
    if (state === 'closed') return 'Awaiting Result';
    if (raffle.ends_at) return `Closes in ${countdownText(raffle.ends_at, clockNow)}`;
    return 'Open for entries';
  };

  return (
    <section className="space-y-4 pb-4">
      <div className="min-w-0 rounded-2xl border border-cyan-300/20 bg-gradient-to-br from-cyan-400/10 via-black/60 to-neon/5 p-3 sm:p-5">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-300/80">Play · Enter · Win</p>
            <h2 className="mt-1 font-display text-xl font-bold text-neon-100">Raffles</h2>
            <p className="mt-2 max-w-sm text-xs leading-relaxed text-neon-400">Enter with ZAP, receive tickets according to the raffle rules, and follow the draw until winners are announced. Review the entry cost and raffle rules before confirming.</p>
          </div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-300/10 text-cyan-200"><Trophy size={20}/></span>
        </div>
        <div className="mt-4 grid grid-cols-1 min-[380px]:grid-cols-2 gap-2">
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

      <div className="rounded-xl border border-neon/15 bg-black/25 p-3">
        <h3 className="text-xs font-semibold text-neon-200">How raffles work</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <div className="flex gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-300/10 text-[10px] font-bold text-cyan-200">1</span><p className="text-[10px] leading-relaxed text-neon-500">Choose an open raffle and check its prize pool and minimum ZAP entry.</p></div>
          <div className="flex gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-300/10 text-[10px] font-bold text-cyan-200">2</span><p className="text-[10px] leading-relaxed text-neon-500">Confirm your ZAP stake. Your ticket count follows that raffle's entry rule.</p></div>
          <div className="flex gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-300/10 text-[10px] font-bold text-cyan-200">3</span><p className="text-[10px] leading-relaxed text-neon-500">When entries close, the draw is completed and winners are announced.</p></div>
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
              <article key={raffle.id} className="min-w-0 overflow-hidden rounded-2xl border border-neon/20 bg-black/35">
                <div className="border-b border-neon/10 bg-gradient-to-r from-neon/5 to-transparent p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="text-[9px] uppercase tracking-widest text-cyan-300">Prize pool</p><h4 className="mt-1 break-words font-display text-lg font-bold text-neon-100">{rewardLabel(raffle)}</h4></div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[9px] ${raffleState(raffle) === 'open' ? 'border-emerald-400/25 bg-emerald-400/5 text-emerald-200' : raffleState(raffle) === 'upcoming' ? 'border-cyan-300/25 bg-cyan-300/5 text-cyan-200' : 'border-neon/20 bg-white/5 text-neon-500'}`}>{raffleState(raffle) === 'open' ? 'Open' : raffleState(raffle) === 'upcoming' ? 'Upcoming' : 'Awaiting Result'}</span>
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-neon-200">{raffle.title}</h3>
                  {raffle.description && <p className="mt-1 text-xs leading-relaxed text-neon-500">{raffle.description}</p>}
                </div>
                <div className="grid grid-cols-2 gap-2 p-3 sm:p-4">
                  <div className="rounded-lg bg-white/[0.03] p-2.5"><p className="text-[9px] text-neon-600">Minimum entry</p><p className="mt-1 text-xs font-semibold text-neon-200">{fmt(raffle.min_bet_zap)} ZAP</p></div>
                  <div className="rounded-lg bg-white/[0.03] p-2.5"><p className="text-[9px] text-neon-600">Number of winners</p><p className="mt-1 text-xs font-semibold text-neon-200">{raffle.winner_count}</p></div>
                  <div className="rounded-lg bg-white/[0.03] p-2.5"><p className="text-[9px] text-neon-600">How tickets are counted</p><p className="mt-1 text-[10px] text-neon-300">{raffle.entry_mode === 'one_bet_one_entry' ? 'Each qualifying entry = 1 ticket' : 'Each ' + fmt(raffle.min_bet_zap) + ' ZAP = 1 ticket'}</p></div>
                  <div className="rounded-lg bg-white/[0.03] p-2.5"><p className="text-[9px] text-neon-600">Your tickets</p><p className="mt-1 text-xs font-semibold text-cyan-200">{tickets}</p></div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neon/10 px-4 py-3">
                  <span className="flex items-center gap-1.5 text-[9px] text-neon-600"><Clock3 size={12}/>{statusText(raffle)}</span>
                  <button type="button" onClick={() => openRaffle(raffle)} disabled={raffleState(raffle) !== 'open'} className="min-h-11 rounded-lg bg-neon/15 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-neon-200 transition hover:bg-neon/25 disabled:cursor-not-allowed disabled:opacity-35">{raffleState(raffle) === 'upcoming' ? 'Starts soon' : raffleState(raffle) === 'closed' ? 'Awaiting Result' : 'Enter raffle'}</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div><h3 className="text-sm font-semibold text-neon-100">Your raffle history</h3><p className="mt-1 text-[10px] text-neon-600">Entries you have made, including the ZAP stake and tickets recorded.</p></div>
          <span className="rounded-full border border-neon/20 bg-white/[0.03] px-2.5 py-1 text-[10px] text-neon-400">{entries.length} entr{entries.length === 1 ? 'y' : 'ies'}</span>
        </div>
        {entries.length === 0 ? (
          <div className="rounded-xl border border-neon/15 bg-black/20 p-4 text-center">
            <Ticket size={22} className="mx-auto text-neon-500"/>
            <p className="mt-2 text-xs font-semibold text-neon-200">No raffle entries yet</p>
            <p className="mt-1 text-[10px] text-neon-600">When you enter a raffle, your stake and ticket details will appear here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {[...entries].sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((entry) => {
              const raffle = raffles.find((item) => item.id === entry.raffle_id);
              const result = raffleHistory.find((item) => item.id === entry.raffle_id);
              const prize = result?.myPrize;
              const outcome = prize
                ? 'Winner'
                : result?.status === 'drawn' || result?.status === 'settled'
                  ? 'Draw complete · not selected'
                  : result?.status === 'cancelled'
                    ? 'Raffle cancelled'
                    : result?.status === 'closed'
                      ? 'Awaiting Result'
                      : 'Result pending';
              const delivery = prize?.delivery_status === 'credited' ? 'Prize credited'
                : prize?.delivery_status === 'withdrawable' ? 'Ready to withdraw'
                : prize?.delivery_status === 'delivered' ? 'Prize delivered'
                : prize?.delivery_status === 'failed' ? 'Contact Admin about prize'
                : prize ? 'Prize pending' : '';
              return (
                <article key={entry.id} className="space-y-2 rounded-xl border border-neon/15 bg-black/25 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-neon-200">{result?.title ?? raffle?.title ?? 'Raffle entry'}</p>
                      <p className="mt-1 text-[10px] text-neon-600">{new Date(entry.created_at).toLocaleString()}</p>
                      <p className="mt-1 text-[10px] text-neon-500">{fmt(entry.stake_zap)} ZAP staked</p>
                    </div>
                    <div className="shrink-0 rounded-lg bg-cyan-300/5 px-3 py-2 text-right">
                      <p className="text-[9px] text-neon-600">Tickets</p>
                      <p className="text-sm font-bold text-cyan-200">{entry.ticket_count}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neon/10 pt-2">
                    <span className={`text-[10px] font-semibold ${prize ? 'text-emerald-300' : 'text-neon-400'}`}>{outcome}</span>
                    {prize && <span className="text-[10px] font-semibold text-emerald-200">{fmt(prize.prize_amount, prize.prize_currency)} {currencyLabel(prize.prize_currency)}{prize.reward_code ? ` · ${prize.reward_code === 'alpha' ? 'Alpha Miner' : 'Overclocked Core'}` : ''}</span>}
                  </div>
                  {delivery && <p className="text-[10px] text-neon-500">{delivery}</p>}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {selected && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center overflow-y-auto bg-black/80 p-2 sm:items-center sm:p-3" role="dialog" aria-modal="true" aria-labelledby="raffle-entry-title">
          <div className="my-auto w-full max-w-md space-y-4 rounded-2xl border border-cyan-300/30 bg-[#07100d] p-3 shadow-2xl sm:p-5">
            <div className="flex items-start justify-between gap-3"><div><p className="text-[9px] uppercase tracking-widest text-cyan-300">Entry details</p><h3 id="raffle-entry-title" className="mt-1 text-lg font-semibold text-neon-100">{selected.title}</h3></div><button type="button" onClick={() => setSelected(null)} className="rounded-lg border border-neon/20 px-3 py-1.5 text-xs text-neon-400">Close</button></div>
            <div className="rounded-xl border border-neon/15 bg-black/30 p-3"><p className="text-[9px] text-neon-600">Prize pool</p><p className="mt-1 font-display text-lg text-cyan-200">{rewardLabel(selected)}</p><p className="mt-1 text-[10px] text-neon-500">{selected.winner_count} winner(s)</p></div>
            <label className="block space-y-1.5"><span className="text-xs text-neon-300">Your entry stake</span><div className="relative"><input type="number" inputMode="decimal" min={selected.min_bet_zap} step="any" value={stake} onChange={(event) => setStake(event.target.value)} className="w-full rounded-xl border border-neon/25 bg-black/50 px-3 py-3 pr-16 text-sm text-neon-100 outline-none focus:border-cyan-300/60"/><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neon-500">ZAP</span></div><span className="block text-[10px] text-neon-600">Minimum entry: {fmt(selected.min_bet_zap)} ZAP</span></label>
            <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-2">
              <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-3"><p className="text-[9px] text-neon-600">You will spend</p><p className="mt-1 text-base font-bold text-cyan-200">{validStake ? fmt(stakeAmount) : '—'} ZAP</p></div>
              <div className="rounded-xl border border-neon/15 bg-black/30 p-3"><p className="text-[9px] text-neon-600">Estimated balance after</p><p className="mt-1 text-base font-bold text-neon-200">{balanceAfterEntry === null ? 'Unavailable' : `${fmt(balanceAfterEntry)} ZAP`}</p></div>
            </div>
            <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-3"><div className="flex items-center justify-between text-xs"><span className="text-neon-500">Tickets you will receive</span><strong className="text-cyan-200">{previewTickets}</strong></div><p className="mt-1 text-[9px] leading-relaxed text-neon-600">{selected.entry_mode === 'one_bet_one_entry' ? 'This raffle gives one ticket for each qualifying entry.' : `Every ${fmt(selected.min_bet_zap)} ZAP earns one ticket. Any amount left over does not earn an extra ticket.`}</p></div>
            {insufficientBalance && <p role="alert" className="rounded-lg border border-red-400/20 bg-red-400/5 p-2 text-[10px] text-red-200">Your balance is too low for this entry. Reduce the stake or add ZAP before continuing.</p>}
            {balance === null && <p className="text-[10px] text-amber-200/80">Your current balance could not be loaded. The server will verify your balance before accepting an entry.</p>}
            {error && <p role="alert" className="rounded-lg border border-red-400/20 bg-red-400/5 p-2 text-xs text-red-200">{error}</p>}
            <div className="flex items-start gap-2 text-[10px] leading-relaxed text-amber-200/80"><Info size={14} className="mt-0.5 shrink-0"/>Your ZAP stake is transferred to the platform treasury; it does not add to the displayed prize pool. Confirmed entries cannot be refunded. Only continue if you understand and accept this.</div>
            <button type="button" onClick={() => void enter()} disabled={submitting || !validStake || previewTickets < 1 || insufficientBalance} className="min-h-12 w-full rounded-xl bg-cyan-300/15 py-3 text-xs font-bold uppercase tracking-wider text-cyan-100 transition hover:bg-cyan-300/25 disabled:cursor-not-allowed disabled:opacity-40">{submitting ? 'Confirming entry…' : `Confirm and spend ${fmt(stakeAmount)} ZAP`}</button>
          </div>
        </div>
      )}
    </section>
  );
}
