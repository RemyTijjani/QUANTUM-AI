import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { CalendarClock, CircleDollarSign, Gift, Plus, RefreshCw, Save, ShieldCheck, Trophy, Users } from 'lucide-react';
import {
  AdminApiError,
  listAdminRaffles,
  saveAdminRaffleDraft,
  reserveAdminRafflePrize,
  publishAdminRaffle,
  closeAdminRaffle,
  selectAdminRaffleWinners,
  creditAdminRaffleWinner,
  creditAdminTonRaffleWinner,
} from '@/lib/admin/adminApi';
import type { AdminCredentials, AdminRaffleRecord } from '@/lib/admin/adminApi';

const money = (value: number | string, currency: string) => `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${currency === 'TON' ? 'Gram' : currency}`;
const errorText = (error: unknown) => error instanceof AdminApiError ? error.message : 'Something went wrong. Please try again.';
const countdownText = (target: string, now: number) => {
  const total = Math.max(0, Math.floor((new Date(target).getTime() - now) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${days ? `${days}d ` : ''}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};
const toLocalDateTime = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export default function AdminRaffleManager({ creds }: { creds: AdminCredentials }) {
  const [raffles, setRaffles] = useState<AdminRaffleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reservingId, setReservingId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [reservedIds, setReservedIds] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [clockNow, setClockNow] = useState(Date.now());
  const [closingId, setClosingId] = useState<string | null>(null);
  const [selectionId, setSelectionId] = useState<string | null>(null);
  const [creditingWinnerId, setCreditingWinnerId] = useState<string | null>(null);
  const [selectedWinnerIds, setSelectedWinnerIds] = useState<Record<string, string[]>>({});
  const [customWinnerShares, setCustomWinnerShares] = useState<Record<string, Record<string, string>>>({});
  const [raffleSearch, setRaffleSearch] = useState('');
  const [raffleStatusFilter, setRaffleStatusFilter] = useState('all');
  const visibleRaffles = raffles.filter((raffle) => {
    const term = raffleSearch.trim().toLowerCase();
    const matchesSearch = !term || raffle.title.toLowerCase().includes(term) || raffle.id.toLowerCase().includes(term);
    const matchesStatus = raffleStatusFilter === 'all' || raffle.status === raffleStatusFilter;
    return matchesSearch && matchesStatus;
  });
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [rewardType, setRewardType] = useState<'zap' | 'ton'>('zap');
  const [prizeAmount, setPrizeAmount] = useState('100');
  const [fundingSource, setFundingSource] = useState<'treasury' | 'external'>('external');
  const [minimumBet, setMinimumBet] = useState('10');
  const [entryMode, setEntryMode] = useState<'one_bet_one_entry' | 'proportional'>('one_bet_one_entry');
  const [winnerCount, setWinnerCount] = useState('1');
  const [winnerMethod, setWinnerMethod] = useState<'random' | 'admin'>('random');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setRaffles(await listAdminRaffles(creds)); }
    catch (loadError) { setError(errorText(loadError)); }
    finally { setLoading(false); }
  }, [creds]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const editDraft = (raffle: AdminRaffleRecord) => {
    setEditingId(raffle.id);
    setTitle(raffle.title);
    setDescription(raffle.description ?? '');
    setRewardType(raffle.reward_type);
    setPrizeAmount(String(raffle.prize_pool_amount));
    setFundingSource(raffle.funding_source === 'treasury' ? 'treasury' : 'external');
    setMinimumBet(String(raffle.min_bet_zap));
    setEntryMode(raffle.entry_mode);
    setWinnerCount(String(raffle.winner_count));
    setWinnerMethod(raffle.winner_method);
    setStartsAt(toLocalDateTime(raffle.starts_at));
    setEndsAt(toLocalDateTime(raffle.ends_at));
    setError('');
    setNotice('');
    setShowForm(true);
  };

  const currency = rewardType === 'ton' ? 'Gram' : 'ZAP';

  const reservePrize = async (raffle: AdminRaffleRecord) => {
    setError('');
    setNotice('');
    setReservingId(raffle.id);
    try {
      const result = await reserveAdminRafflePrize(creds, raffle.id);
      setReservedIds((current) => ({ ...current, [raffle.id]: true }));
      setNotice(
        result.alreadyReserved
          ? `This raffle's prize pool was already reserved: ${money(result.amount, result.currency)}.`
          : `Prize pool reserved: ${money(result.amount, result.currency)}. The funds are locked for this raffle; it has not been published.`,
      );
    } catch (reserveError) {
      setError(errorText(reserveError));
    } finally {
      setReservingId(null);
    }
  };

  const publishRaffle = async (raffle: AdminRaffleRecord) => {
    if (!window.confirm(`Publish "${raffle.title}" now? It will become visible to players. Publishing does not draw winners or send prizes.`)) return;
    setError('');
    setNotice('');
    setPublishingId(raffle.id);
    try {
      const result = await publishAdminRaffle(creds, raffle.id);
      if (result.status !== 'published') {
        setError('The server did not confirm that this raffle was published. Refresh the list before retrying.');
      } else {
        setNotice(`Published "${raffle.title}". It is now visible to players.`);
      }
      await refresh();
    } catch (publishError) {
      setError(errorText(publishError));
    } finally {
      setPublishingId(null);
    }
  };

  const closeRaffle = async (raffle: AdminRaffleRecord) => {
    if (!window.confirm(`Close "${raffle.title}" now? Players will no longer be able to enter. The raffle will show "Awaiting Result", and this action will be recorded.`)) return;
    setError('');
    setNotice('');
    setClosingId(raffle.id);
    try {
      const result = await closeAdminRaffle(creds, raffle.id);
      setNotice(result.alreadyClosed ? `"${raffle.title}" is already closed and awaiting its result.` : `Closed "${raffle.title}". It is now awaiting result.`);
      await refresh();
    } catch (closeError) {
      setError(errorText(closeError));
    } finally {
      setClosingId(null);
    }
  };

  const selectWinners = async (raffle: AdminRaffleRecord) => {
    const selected = selectedWinnerIds[raffle.id] ?? [];
    if (raffle.winner_method === 'admin' && selected.length !== raffle.winner_count) {
      setError(`Select exactly ${raffle.winner_count} eligible entrant(s).`);
      return;
    }
    const shareMap = customWinnerShares[raffle.id] ?? {};
    const enteredShares = selected.map((id) => shareMap[id]?.trim() ?? '');
    const hasAnyCustomShare = enteredShares.some((value) => value !== '');
    if (hasAnyCustomShare && enteredShares.some((value) => value === '' || !Number.isFinite(Number(value)) || Number(value) <= 0)) {
      setError('Enter a positive custom prize share for every selected winner, or leave all shares blank for equal distribution.');
      return;
    }
    const prizeShares = hasAnyCustomShare ? enteredShares.map(Number) : undefined;
    if (!window.confirm(raffle.winner_method === 'random'
      ? `Run the random draw for "${raffle.title}" now? Winners cannot be changed after selection.`
      : `Confirm these ${selected.length} winner(s) for "${raffle.title}"? Winners cannot be changed after selection.`)) return;
    setError(''); setNotice(''); setSelectionId(raffle.id);
    try {
      await selectAdminRaffleWinners(creds, raffle.id, raffle.winner_method === 'admin' ? selected : undefined, prizeShares);
      setNotice(`Winners selected for "${raffle.title}". Review each prize below and credit the ZAP or Gram rewards.`);
      setSelectedWinnerIds((current) => ({ ...current, [raffle.id]: [] }));
      setCustomWinnerShares((current) => ({ ...current, [raffle.id]: {} }));
      await refresh();
    } catch (selectionError) { setError(errorText(selectionError)); }
    finally { setSelectionId(null); }
  };

  const creditWinner = async (winnerId: string, raffleTitle: string, currency: 'TON' | 'ZAP') => {
    const isGram = currency === 'TON';
    const confirmation = isGram
      ? `Credit this winner's Gram prize for "${raffleTitle}" now? It will become withdrawable in their Gram balance.`
      : `Credit this winner's ZAP prize for "${raffleTitle}" now? It will be added to their ZAP wallet.`;
    if (!window.confirm(confirmation)) return;
    setError(''); setNotice(''); setCreditingWinnerId(winnerId);
    try {
      const result = isGram
        ? await creditAdminTonRaffleWinner(creds, winnerId)
        : await creditAdminRaffleWinner(creds, winnerId);
      setNotice(result.alreadyCredited
        ? 'This prize was already credited.'
        : isGram ? 'Gram prize credited to the winner’s withdrawable balance.' : 'ZAP prize credited successfully.');
      await refresh();
    } catch (creditError) { setError(errorText(creditError)); }
    finally { setCreditingWinnerId(null); }
  };

  const saveDraft = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (title.trim().length < 3) { setError('Give your raffle a title with at least 3 characters.'); return; }
    const amount = Number(prizeAmount);
    const minBet = Number(minimumBet);
    const winners = Number(winnerCount);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(minBet) || minBet <= 0 || !Number.isInteger(winners) || winners < 1 || winners > 100) {
      setError('Check the prize amount, minimum bet and number of winners.'); return;
    }
    if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      setError('The closing date must be after the start date.'); return;
    }
    setSaving(true);
    try {
      await saveAdminRaffleDraft(creds, {
        ...(editingId ? { id: editingId } : {}),
        title: title.trim(),
        description: description.trim(),
        rewardType,
        rewardCode: null,
        prizePoolAmount: amount,
        fundingSource: rewardType === 'ton' ? 'external' : fundingSource,
        minBetZap: minBet,
        entryMode,
        winnerCount: winners,
        winnerMethod,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      });
      setNotice(editingId ? 'Draft updated. It is still private and no prize funds have been reserved.' : 'Draft saved. It is not visible to players and no prize funds have been reserved.');
      setEditingId(null);
      setTitle(''); setDescription(''); setPrizeAmount('100'); setMinimumBet('10'); setWinnerCount('1'); setStartsAt(''); setEndsAt('');
      setShowForm(false);
      await refresh();
    } catch (saveError) { setError(errorText(saveError)); }
    finally { setSaving(false); }
  };

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-cyan-400/10 via-black/50 to-neon/5 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-xl"><p className="text-[10px] uppercase tracking-[0.18em] text-emerald-300">Admin workspace</p><h2 className="mt-1 font-display text-xl font-bold text-white">Raffle Manager</h2><p className="mt-2 text-xs leading-relaxed text-slate-300">Set up the raffle, save it privately, then reserve the full prize pool. Only a funded raffle can move on to publishing and player entries.</p></div>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/10 text-emerald-200"><Trophy size={20}/></span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-[#101a14] p-3"><p className="text-[9px] text-slate-400">Total drafts & raffles</p><p className="mt-1 font-display text-xl text-white">{raffles.length}</p></div>
          <div className="rounded-xl border border-white/10 bg-[#101a14] p-3"><p className="text-[9px] text-slate-400">Drafts</p><p className="mt-1 font-display text-xl text-amber-200">{raffles.filter((item) => item.status === 'draft').length}</p></div>
          <div className="col-span-2 rounded-xl border border-white/10 bg-[#101a14] p-3 sm:col-span-1"><p className="text-[9px] text-slate-400">Live raffles</p><p className="mt-1 font-display text-xl text-emerald-200">{raffles.filter((item) => item.status === 'published').length}</p></div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#101a14] p-3 sm:p-4"><h3 className="text-xs font-semibold text-white">How raffle setup works</h3><ol className="mt-3 grid gap-3 text-[10px] text-slate-300 sm:grid-cols-3"><li><span className="font-semibold text-amber-200">1. Save draft</span><p className="mt-1 text-slate-400">Keeps the raffle private. No funds are locked.</p></li><li><span className="font-semibold text-cyan-200">2. Reserve prize</span><p className="mt-1 text-slate-400">Locks the complete prize pool for this raffle.</p></li><li><span className="font-semibold text-emerald-200">3. Publish</span><p className="mt-1 text-slate-400">Makes the funded raffle available to players.</p></li></ol></div>\n\n      {notice && <div role="status" className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-3 text-xs text-emerald-200"><ShieldCheck size={14} className="mr-2 inline"/>{notice}</div>}
      {error && <div role="alert" className="rounded-xl border border-red-400/25 bg-red-400/10 p-3 text-xs text-red-200">{error}</div>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-display text-sm font-semibold text-slate-100">Your raffles</h3><p className="mt-0.5 text-[10px] text-slate-400">Drafts are private. Reserving locks the prize pool; publishing is a separate step.</p></div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg border border-white/10 p-2 text-emerald-300 disabled:opacity-40" aria-label="Refresh raffle list"><RefreshCw size={14} className={loading ? 'animate-spin' : ''}/></button>
          <button type="button" onClick={() => { setShowForm((value) => !value); setError(''); }} className="flex items-center gap-2 rounded-lg bg-emerald-400/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-100 hover:bg-emerald-400/15"><Plus size={14}/>{showForm ? 'Close form' : 'Create raffle'}</button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={(event) => void saveDraft(event)} className="space-y-5 rounded-2xl border border-white/10 bg-black/35 p-4 sm:p-5">
          <div><p className="text-[10px] uppercase tracking-widest text-emerald-300">Step 1 of 3</p><h3 className="mt-1 text-base font-semibold text-white">Raffle details</h3><p className="mt-1 text-[10px] text-slate-400">Start with a clear name and a short explanation players will understand.</p></div>
          <div className="space-y-3">
            <label className="block space-y-1"><span className="text-[10px] text-slate-300">Raffle title</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required placeholder="e.g. Weekend ZAP Giveaway" className="admin-field"/></label>
            <label className="block space-y-1"><span className="text-[10px] text-slate-300">Description <span className="text-slate-500">(optional)</span></span><textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} placeholder="Tell players what they can win and any important details." className="admin-field resize-y"/></label>
          </div>

          <div className="border-t border-white/10 pt-4"><p className="text-[10px] uppercase tracking-widest text-emerald-300">Step 2 of 3</p><h3 className="mt-1 text-base font-semibold text-white">Choose the prize</h3></div>
          <div className="grid grid-cols-2 gap-2">
            {(['zap','ton'] as const).map((type) => <button key={type} type="button" onClick={() => setRewardType(type)} className={`rounded-xl border px-3 py-3 text-center transition ${rewardType === type ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-[#101a14] text-slate-400'}`}><Gift size={16} className="mx-auto mb-1"/><span className="text-[10px] font-semibold uppercase">{type === 'ton' ? 'Gram' : 'ZAP'}</span></button>)}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1"><span className="text-[10px] text-slate-300">{`Total prize pool (${currency})`}</span><input type="number" inputMode="decimal" min="0.00000001" step="any" value={prizeAmount} onChange={(e) => setPrizeAmount(e.target.value)} required className="w-full rounded-xl border border-white/10 bg-[#0b120e] px-3 py-3 text-sm text-white outline-none focus:border-emerald-400/40"/></label>
            {rewardType === 'zap' && <label className="block space-y-1"><span className="text-[10px] text-slate-300">Where the ZAP prize comes from</span><select value={fundingSource} onChange={(e) => setFundingSource(e.target.value as 'treasury' | 'external')} className="admin-field text-xs"><option value="treasury">ZORD treasury (available funds)</option><option value="external">External deposit (Admin verified)</option></select></label>}
          </div>
          {rewardType === 'ton' && <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-[10px] leading-relaxed text-amber-200">Gram prizes are funded externally. The deposit must be verified, and the player withdrawal process must be ready before this raffle can be published.</p>}
          {rewardType === 'zap' && fundingSource === 'external' && <p className="rounded-xl border border-emerald-400/20 bg-cyan-300/5 p-3 text-[10px] leading-relaxed text-emerald-100">An Admin must verify and confirm the deposit in Raffle Funding first. The confirmed amount must cover this raffle's full prize pool before it can be published.</p>}

          <div className="border-t border-white/10 pt-4"><p className="text-[10px] uppercase tracking-widest text-emerald-300">Step 3 of 3</p><h3 className="mt-1 text-base font-semibold text-white">Entry and winner rules</h3></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1"><span className="text-[10px] text-slate-300">Minimum bet (ZAP)</span><input type="number" min="0.00000001" step="any" value={minimumBet} onChange={(e) => setMinimumBet(e.target.value)} required className="w-full rounded-xl border border-white/10 bg-[#0b120e] px-3 py-3 text-sm text-white"/></label>
            <label className="block space-y-1"><span className="text-[10px] text-slate-300">Number of winners</span><input type="number" min="1" max="100" step="1" value={winnerCount} onChange={(e) => setWinnerCount(e.target.value)} required className="w-full rounded-xl border border-white/10 bg-[#0b120e] px-3 py-3 text-sm text-white"/></label>
          </div>
          <div className="space-y-2"><p className="text-[10px] text-slate-300">How entries are counted</p><label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-[#101a14] p-3"><input type="radio" checked={entryMode === 'one_bet_one_entry'} onChange={() => setEntryMode('one_bet_one_entry')} className="mt-0.5 accent-cyan-300"/><span><strong className="block text-xs text-slate-100">One bet = one ticket</strong><small className="mt-1 block text-[10px] text-slate-400">Any qualifying bet gives one chance, regardless of its size.</small></span></label><label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-[#101a14] p-3"><input type="radio" checked={entryMode === 'proportional'} onChange={() => setEntryMode('proportional')} className="mt-0.5 accent-cyan-300"/><span><strong className="block text-xs text-slate-100">More ZAP = more tickets</strong><small className="mt-1 block text-[10px] text-slate-400">Each minimum-bet amount gives one ticket. Example: 50 ZAP with a 10 ZAP minimum gives 5 tickets.</small></span></label></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1"><span className="text-[10px] text-slate-300">Winner selection</span><select value={winnerMethod} onChange={(e) => setWinnerMethod(e.target.value as 'random' | 'admin')} className="w-full rounded-xl border border-white/10 bg-[#0b120e] px-3 py-3 text-xs text-white"><option value="random">Random draw</option><option value="admin">Admin selects winners</option></select></label>
            <div className="rounded-xl border border-white/10 bg-[#101a14] p-3"><p className="flex items-center gap-1.5 text-[10px] text-slate-300"><Users size={12}/> Prize distribution</p><p className="mt-1 text-xs text-slate-100">Equal shares by default</p><p className="mt-1 text-[9px] text-slate-400">You can customize each winner's share when selecting winners.</p></div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1"><span className="flex items-center gap-1 text-[10px] text-slate-300"><CalendarClock size={12}/> Starts <span className="text-slate-500">(optional)</span></span><input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="w-full rounded-xl border border-white/10 bg-[#0b120e] px-3 py-3 text-xs text-white"/></label>
            <label className="block space-y-1"><span className="flex items-center gap-1 text-[10px] text-slate-300"><CalendarClock size={12}/> Closes <span className="text-slate-500">(optional)</span></span><input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="w-full rounded-xl border border-white/10 bg-[#0b120e] px-3 py-3 text-xs text-white"/></label>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-white/10 pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-xl border border-white/10 px-4 py-3 text-xs text-slate-300">Cancel</button>
            <button type="submit" disabled={saving} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-400/10 px-5 py-3 text-xs font-bold uppercase tracking-wider text-emerald-100 hover:bg-emerald-400/15 disabled:opacity-40"><Save size={14}/>{saving ? 'Saving draft…' : editingId ? 'Update draft' : 'Save as draft'}</button>
          </div>
          <p className="text-center text-[9px] leading-relaxed text-slate-500">Saving only stores the setup privately. It does not lock funds, open entries, charge players or send prizes.</p>
        </form>
      )}

      <div className="space-y-3">
        {!loading && raffles.length > 0 && (
          <div className="grid gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:grid-cols-[1fr_200px]">
            <label className="block"><span className="mb-1 block text-[10px] text-slate-400">Search raffles</span><input value={raffleSearch} onChange={(event) => setRaffleSearch(event.target.value)} placeholder="Search by raffle title or ID" className="admin-field" /></label>
            <label className="block"><span className="mb-1 block text-[10px] text-slate-400">Filter by status</span><select value={raffleStatusFilter} onChange={(event) => setRaffleStatusFilter(event.target.value)} className="admin-field"><option value="all">All statuses ({raffles.length})</option><option value="draft">Draft</option><option value="published">Published</option><option value="closed">Awaiting Result</option><option value="drawn">Winners Selected</option><option value="settled">Settled</option><option value="cancelled">Cancelled</option></select></label>
          </div>
        )}
        {loading ? <div role="status" className="py-8 text-center text-xs text-slate-400">Loading your raffle drafts…</div> : raffles.length === 0 ? <div className="rounded-xl border border-white/10 bg-[#101a14] py-9 text-center"><CircleDollarSign size={25} className="mx-auto text-slate-400"/><p className="mt-2 text-xs text-emerald-300">No raffles created yet</p><p className="mt-1 text-[10px] text-slate-400">Create your first draft to get started.</p></div> : visibleRaffles.length === 0 ? <div className="rounded-xl border border-dashed border-white/15 py-9 text-center"><p className="text-xs font-semibold text-slate-200">No matching raffles</p><p className="mt-1 text-[10px] text-slate-400">Try another title or change the status filter.</p><button type="button" onClick={() => { setRaffleSearch(''); setRaffleStatusFilter('all'); }} className="mt-3 text-xs text-emerald-300">Clear search and filters</button></div> : visibleRaffles.map((raffle) => <article key={raffle.id} className="rounded-xl border border-white/10 bg-[#101a14] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h4 className="text-sm font-semibold text-slate-100">{raffle.title}</h4><p className="mt-1 text-[10px] text-slate-400">{money(raffle.prize_pool_amount, raffle.prize_currency)} · {raffle.winner_count} winner(s)</p></div><span className={`rounded-full border px-2.5 py-1 text-[9px] uppercase ${raffle.status === 'published' ? 'border-emerald-400/25 bg-emerald-400/5 text-emerald-200' : 'border-amber-400/25 bg-amber-400/5 text-amber-200'}`}>{raffle.status === 'drawn' ? 'Winners Selected' : raffle.status === 'settled' ? 'Settled' : raffle.status === 'closed' || (raffle.ends_at && clockNow >= new Date(raffle.ends_at).getTime()) ? 'Awaiting Result' : raffle.status === 'published' ? 'Scheduled / Live' : raffle.status}</span></div>{raffle.status === 'published' && <p className="mt-2 text-[10px] text-cyan-200">{raffle.starts_at && clockNow < new Date(raffle.starts_at).getTime() ? `Starts in ${countdownText(raffle.starts_at, clockNow)}` : raffle.ends_at && clockNow < new Date(raffle.ends_at).getTime() ? `Closes in ${countdownText(raffle.ends_at, clockNow)}` : raffle.ends_at ? 'Awaiting Result' : 'Open · no scheduled closing time'}</p>}<div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-slate-400"><span>Minimum: {money(raffle.min_bet_zap, 'ZAP')}</span><span>{raffle.entry_mode === 'proportional' ? 'Proportional tickets' : 'One bet, one ticket'}</span></div>{raffle.status === 'draft' && <div className="mt-3 flex flex-wrap gap-2">{reservedIds[raffle.id] ? <span role="status" className="rounded-lg border border-emerald-400/25 bg-emerald-400/5 px-3 py-2 text-[10px] font-semibold text-emerald-200">Prize reserved</span> : <button type="button" onClick={() => void reservePrize(raffle)} disabled={reservingId !== null || publishingId !== null} className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-[10px] font-semibold text-emerald-100 hover:bg-cyan-300/20 disabled:opacity-40">{reservingId === raffle.id ? 'Checking reserve…' : 'Lock prize funds'}</button>}<button type="button" onClick={() => void publishRaffle(raffle)} disabled={publishingId !== null || reservingId !== null} className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-40">{publishingId === raffle.id ? 'Publishing…' : 'Publish raffle'}</button><button type="button" onClick={() => editDraft(raffle)} disabled={!!reservedIds[raffle.id] || publishingId !== null} className="rounded-lg border border-white/10 px-3 py-2 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-40">Edit draft</button></div>}{raffle.status === 'published' && (!raffle.starts_at || clockNow >= new Date(raffle.starts_at).getTime()) && (!raffle.ends_at || clockNow < new Date(raffle.ends_at).getTime()) && <button type="button" onClick={() => void closeRaffle(raffle)} disabled={closingId !== null} className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[10px] font-semibold text-amber-100 disabled:opacity-40">{closingId === raffle.id ? 'Closing…' : 'Close raffle early'}</button>}
        {raffle.status === 'closed' && (raffle.winners?.length ?? 0) === 0 && <div className="mt-4 space-y-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
          <div><p className="text-xs font-semibold text-amber-100">Awaiting winner selection</p><p className="mt-1 text-[10px] text-slate-300">{raffle.entries?.length ?? 0} entries · select {raffle.winner_count} winner(s) using {raffle.winner_method === 'admin' ? 'Admin selection' : 'a weighted random draw'}.</p></div>
          {raffle.winner_method === 'admin' && <div className="max-h-56 space-y-2 overflow-y-auto">
            {(raffle.entries ?? []).map((entry) => {
              const selected = selectedWinnerIds[raffle.id] ?? [];
              const isChecked = selected.includes(entry.player_id);
              const label = entry.players?.username ? `@${entry.players.username}` : entry.players?.first_name || entry.player_id.slice(0, 8);
              return <label key={entry.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-black/20 p-2 text-[10px] text-slate-200">
                <input type="checkbox" checked={isChecked} disabled={!isChecked && selected.length >= raffle.winner_count} onChange={(event) => setSelectedWinnerIds((current) => ({ ...current, [raffle.id]: event.target.checked ? [...selected, entry.player_id] : selected.filter((id) => id !== entry.player_id) }))} className="accent-emerald-400"/>
                <span className="min-w-0 flex-1 truncate">{label}</span><span className="text-slate-500">{entry.ticket_count} ticket(s)</span>
              </label>;
            })}
          </div>}
          {raffle.winner_method === 'admin' && (selectedWinnerIds[raffle.id] ?? []).length > 0 && <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-2">
            <p className="text-[10px] font-semibold text-slate-200">Optional custom prize shares (leave all blank for equal shares)</p>
            {(selectedWinnerIds[raffle.id] ?? []).map((playerId, index) => {
              const entry = (raffle.entries ?? []).find((item) => item.player_id === playerId);
              const label = entry?.players?.username ? '@' + entry.players.username : entry?.players?.first_name || playerId.slice(0, 8);
              return <label key={playerId} className="flex items-center gap-2 text-[10px] text-slate-300"><span className="min-w-0 flex-1 truncate">{index + 1}. {label}</span><input type="number" min="0.00000001" step="any" placeholder="Equal" value={customWinnerShares[raffle.id]?.[playerId] ?? ''} onChange={(event) => setCustomWinnerShares((current) => ({ ...current, [raffle.id]: { ...(current[raffle.id] ?? {}), [playerId]: event.target.value } }))} className="w-28 rounded-lg border border-white/10 bg-[#0b120e] px-2 py-2 text-right text-[10px] text-white"/></label>;
            })}
          </div>}
          <button type="button" onClick={() => void selectWinners(raffle)} disabled={selectionId !== null || (raffle.winner_method === 'admin' && (selectedWinnerIds[raffle.id] ?? []).length !== raffle.winner_count)} className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[10px] font-semibold text-emerald-100 disabled:opacity-40">{selectionId === raffle.id ? 'Selecting…' : raffle.winner_method === 'random' ? 'Run random draw' : `Confirm ${raffle.winner_count} selected winner(s)`}</button>
        </div>}
        {(raffle.winners?.length ?? 0) > 0 && <div className="mt-4 space-y-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3">
          <p className="text-xs font-semibold text-emerald-100">Selected winners</p>
          {(raffle.winners ?? []).map((winner) => {
            const label = winner.players?.username ? `@${winner.players.username}` : winner.players?.first_name || winner.player_id.slice(0, 8);
            return <div key={winner.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/20 p-2">
              <div className="min-w-0"><p className="truncate text-[10px] font-semibold text-white">{label}</p><p className="mt-0.5 text-[10px] text-slate-400">{money(winner.prize_amount, winner.prize_currency)} · {winner.delivery_status}</p></div>
              {winner.delivery_status === 'pending' && <button type="button" onClick={() => void creditWinner(winner.id, raffle.title, winner.prize_currency)} disabled={creditingWinnerId !== null} className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-[10px] font-semibold text-emerald-100 disabled:opacity-40">{creditingWinnerId === winner.id ? 'Crediting…' : winner.prize_currency === 'TON' ? 'Credit Gram prize' : 'Credit ZAP prize'}</button>}
              {winner.delivery_status === 'credited' && <span className="text-[10px] font-semibold text-emerald-300">Credited</span>}
              {winner.delivery_status === 'withdrawable' && <span className="text-[10px] font-semibold text-emerald-300">Credited · Withdrawable</span>}
              {winner.delivery_status === 'delivered' && <span className="text-[10px] font-semibold text-emerald-300">Delivered</span>}
              {winner.delivery_status === 'failed' && <span className="text-[10px] font-semibold text-red-300">Delivery failed</span>}
            </div>;
          })}
        </div>}
      </article>)}
      </div>
      <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3"><p className="text-[10px] font-semibold text-amber-200">Publishing is protected</p><p className="mt-1 text-[10px] leading-relaxed text-amber-100/70">A raffle must have its full prize pool reserved and verified before it can go live. Gram prizes also require the funding wallet and player withdrawal process to be ready. Drawing winners and delivering prizes are separate Admin-controlled steps.</p></div>
    </section>
  );
}
