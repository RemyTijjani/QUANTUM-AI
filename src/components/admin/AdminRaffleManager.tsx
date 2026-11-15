import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { CalendarClock, CircleDollarSign, Gift, Plus, RefreshCw, Save, ShieldCheck, Trophy, Users } from 'lucide-react';
import {
  AdminApiError,
  listAdminRaffles,
  saveAdminRaffleDraft,
} from '@/lib/admin/adminApi';
import type { AdminCredentials, AdminRaffleDraftInput, AdminRaffleRecord } from '@/lib/admin/adminApi';

const money = (value: number | string, currency: string) => `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${currency}`;
const errorText = (error: unknown) => error instanceof AdminApiError ? error.message : 'Something went wrong. Please try again.';

export default function AdminRaffleManager({ creds }: { creds: AdminCredentials }) {
  const [raffles, setRaffles] = useState<AdminRaffleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [rewardType, setRewardType] = useState<'zap' | 'ton' | 'agent'>('zap');
  const [rewardCode, setRewardCode] = useState<'alpha' | 'overclock'>('alpha');
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

  const currency = rewardType === 'ton' ? 'TON' : rewardType === 'zap' ? 'ZAP' : 'AGENT';
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
    if (rewardType === 'agent' && (!Number.isInteger(amount) || amount < winners)) {
      setError('For Agent prizes, enter a whole number of agents equal to or greater than the winner count.'); return;
    }
    if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      setError('The closing date must be after the start date.'); return;
    }
    setSaving(true);
    try {
      await saveAdminRaffleDraft(creds, {
        title: title.trim(),
        description: description.trim(),
        rewardType,
        rewardCode: rewardType === 'agent' ? rewardCode : null,
        prizePoolAmount: amount,
        fundingSource: rewardType === 'ton' ? 'external' : rewardType === 'agent' ? 'agent_inventory' : fundingSource,
        minBetZap: minBet,
        entryMode,
        winnerCount: winners,
        winnerMethod,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      });
      setNotice('Draft saved. It is not visible to players and no prize funds have been reserved.');
      setTitle(''); setDescription(''); setPrizeAmount('100'); setMinimumBet('10'); setWinnerCount('1'); setStartsAt(''); setEndsAt('');
      setShowForm(false);
      await refresh();
    } catch (saveError) { setError(errorText(saveError)); }
    finally { setSaving(false); }
  };

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-cyan-300/20 bg-gradient-to-br from-cyan-400/10 via-black/50 to-neon/5 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-xl"><p className="text-[10px] uppercase tracking-[0.18em] text-cyan-300/80">Admin workspace</p><h2 className="mt-1 font-display text-xl font-bold text-neon-100">Raffle Manager</h2><p className="mt-2 text-xs leading-relaxed text-neon-400">Create a draft, choose the prize and entry rules, then review funding before publishing. Drafts are private and cannot accept entries.</p></div>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-300/10 text-cyan-200"><Trophy size={20}/></span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-black/30 p-3"><p className="text-[9px] text-neon-600">Total drafts & raffles</p><p className="mt-1 font-display text-xl text-neon-100">{raffles.length}</p></div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-3"><p className="text-[9px] text-neon-600">Drafts</p><p className="mt-1 font-display text-xl text-amber-200">{raffles.filter((item) => item.status === 'draft').length}</p></div>
          <div className="col-span-2 rounded-xl border border-white/10 bg-black/30 p-3 sm:col-span-1"><p className="text-[9px] text-neon-600">Live raffles</p><p className="mt-1 font-display text-xl text-emerald-200">{raffles.filter((item) => item.status === 'published').length}</p></div>
        </div>
      </div>

      {notice && <div role="status" className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-3 text-xs text-emerald-200"><ShieldCheck size={14} className="mr-2 inline"/>{notice}</div>}
      {error && <div role="alert" className="rounded-xl border border-red-400/25 bg-red-400/10 p-3 text-xs text-red-200">{error}</div>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-display text-sm font-semibold text-neon-200">Your raffles</h3><p className="mt-0.5 text-[10px] text-neon-600">Drafts stay private until funding is verified and you publish.</p></div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg border border-neon/20 p-2 text-neon-300 disabled:opacity-40" aria-label="Refresh raffle list"><RefreshCw size={14} className={loading ? 'animate-spin' : ''}/></button>
          <button type="button" onClick={() => { setShowForm((value) => !value); setError(''); }} className="flex items-center gap-2 rounded-lg bg-neon/15 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-neon-200 hover:bg-neon/25"><Plus size={14}/>{showForm ? 'Close form' : 'Create raffle'}</button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={(event) => void saveDraft(event)} className="space-y-5 rounded-2xl border border-neon/20 bg-black/35 p-4 sm:p-5">
          <div><p className="text-[10px] uppercase tracking-widest text-cyan-300">Step 1 of 3</p><h3 className="mt-1 text-base font-semibold text-neon-100">Raffle details</h3><p className="mt-1 text-[10px] text-neon-600">Start with a clear name and a short explanation players will understand.</p></div>
          <div className="space-y-3">
            <label className="block space-y-1"><span className="text-[10px] text-neon-400">Raffle title</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required placeholder="e.g. Weekend ZAP Giveaway" className="w-full rounded-xl border border-neon/20 bg-black/40 px-3 py-3 text-sm text-neon-100 outline-none focus:border-cyan-300/50"/></label>
            <label className="block space-y-1"><span className="text-[10px] text-neon-400">Description <span className="text-neon-700">(optional)</span></span><textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} placeholder="Tell players what they can win and any important details." className="w-full resize-y rounded-xl border border-neon/20 bg-black/40 px-3 py-3 text-xs leading-relaxed text-neon-100 outline-none focus:border-cyan-300/50"/></label>
          </div>

          <div className="border-t border-neon/10 pt-4"><p className="text-[10px] uppercase tracking-widest text-cyan-300">Step 2 of 3</p><h3 className="mt-1 text-base font-semibold text-neon-100">Choose the prize</h3></div>
          <div className="grid grid-cols-3 gap-2">
            {(['zap','ton','agent'] as const).map((type) => <button key={type} type="button" onClick={() => setRewardType(type)} className={`rounded-xl border px-2 py-3 text-center transition ${rewardType === type ? 'border-cyan-300/50 bg-cyan-300/10 text-cyan-100' : 'border-neon/15 bg-black/20 text-neon-500'}`}><Gift size={16} className="mx-auto mb-1"/><span className="text-[10px] font-semibold uppercase">{type}</span></button>)}
          </div>
          {rewardType === 'agent' && <label className="block space-y-1"><span className="text-[10px] text-neon-400">Agent to award</span><select value={rewardCode} onChange={(e) => setRewardCode(e.target.value as 'alpha' | 'overclock')} className="w-full rounded-xl border border-neon/20 bg-black/40 px-3 py-3 text-xs text-neon-100"><option value="alpha">ZORD Alpha Miner Agent</option><option value="overclock">ZORD Overclocked Core Agent</option></select></label>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1"><span className="text-[10px] text-neon-400">{rewardType === 'agent' ? 'Number of agents' : `Total prize pool (${currency})`}</span><input type="number" inputMode="decimal" min="0.00000001" step={rewardType === 'agent' ? '1' : 'any'} value={prizeAmount} onChange={(e) => setPrizeAmount(e.target.value)} required className="w-full rounded-xl border border-neon/20 bg-black/40 px-3 py-3 text-sm text-neon-100 outline-none focus:border-cyan-300/50"/></label>
            {rewardType !== 'ton' && rewardType !== 'agent' && <label className="block space-y-1"><span className="text-[10px] text-neon-400">Prize funding source</span><select value={fundingSource} onChange={(e) => setFundingSource(e.target.value as 'treasury' | 'external')} className="w-full rounded-xl border border-neon/20 bg-black/40 px-3 py-3 text-xs text-neon-100"><option value="treasury">ZORD treasury</option><option value="external">Externally verified ZAP</option></select></label>}
          </div>
          {rewardType === 'ton' && <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-[10px] leading-relaxed text-amber-200">TON prizes require an externally funded TON deposit and a configured player withdrawal process. This draft cannot be published until both are ready.</p>}
          {rewardType === 'zap' && fundingSource === 'external' && <p className="rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-3 text-[10px] leading-relaxed text-cyan-100">External ZAP must first be checked and confirmed in the Raffle Funding tab. The funding record and available reserve will be checked before publishing.</p>}
          {rewardType === 'agent' && <p className="rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-3 text-[10px] leading-relaxed text-cyan-100">Agent rewards will be reserved from the selected agent inventory before publishing. Each winner receives an individual agent entitlement.</p>}

          <div className="border-t border-neon/10 pt-4"><p className="text-[10px] uppercase tracking-widest text-cyan-300">Step 3 of 3</p><h3 className="mt-1 text-base font-semibold text-neon-100">Entry and winner rules</h3></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1"><span className="text-[10px] text-neon-400">Minimum bet (ZAP)</span><input type="number" min="0.00000001" step="any" value={minimumBet} onChange={(e) => setMinimumBet(e.target.value)} required className="w-full rounded-xl border border-neon/20 bg-black/40 px-3 py-3 text-sm text-neon-100"/></label>
            <label className="block space-y-1"><span className="text-[10px] text-neon-400">Number of winners</span><input type="number" min="1" max="100" step="1" value={winnerCount} onChange={(e) => setWinnerCount(e.target.value)} required className="w-full rounded-xl border border-neon/20 bg-black/40 px-3 py-3 text-sm text-neon-100"/></label>
          </div>
          <div className="space-y-2"><p className="text-[10px] text-neon-400">How entries are counted</p><label className="flex cursor-pointer items-start gap-3 rounded-xl border border-neon/15 bg-black/20 p-3"><input type="radio" checked={entryMode === 'one_bet_one_entry'} onChange={() => setEntryMode('one_bet_one_entry')} className="mt-0.5 accent-cyan-300"/><span><strong className="block text-xs text-neon-200">One bet = one ticket</strong><small className="mt-1 block text-[10px] text-neon-600">Any qualifying bet gives one chance, regardless of its size.</small></span></label><label className="flex cursor-pointer items-start gap-3 rounded-xl border border-neon/15 bg-black/20 p-3"><input type="radio" checked={entryMode === 'proportional'} onChange={() => setEntryMode('proportional')} className="mt-0.5 accent-cyan-300"/><span><strong className="block text-xs text-neon-200">More ZAP = more tickets</strong><small className="mt-1 block text-[10px] text-neon-600">Each minimum-bet amount gives one ticket. Example: 50 ZAP with a 10 ZAP minimum gives 5 tickets.</small></span></label></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1"><span className="text-[10px] text-neon-400">Winner selection</span><select value={winnerMethod} onChange={(e) => setWinnerMethod(e.target.value as 'random' | 'admin')} className="w-full rounded-xl border border-neon/20 bg-black/40 px-3 py-3 text-xs text-neon-100"><option value="random">Random draw</option><option value="admin">Admin selects winners</option></select></label>
            <div className="rounded-xl border border-neon/15 bg-black/20 p-3"><p className="flex items-center gap-1.5 text-[10px] text-neon-400"><Users size={12}/> Prize distribution</p><p className="mt-1 text-xs text-neon-200">Equal shares by default</p><p className="mt-1 text-[9px] text-neon-600">You can customize each winner's share when selecting winners.</p></div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1"><span className="flex items-center gap-1 text-[10px] text-neon-400"><CalendarClock size={12}/> Starts <span className="text-neon-700">(optional)</span></span><input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="w-full rounded-xl border border-neon/20 bg-black/40 px-3 py-3 text-xs text-neon-100"/></label>
            <label className="block space-y-1"><span className="flex items-center gap-1 text-[10px] text-neon-400"><CalendarClock size={12}/> Closes <span className="text-neon-700">(optional)</span></span><input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="w-full rounded-xl border border-neon/20 bg-black/40 px-3 py-3 text-xs text-neon-100"/></label>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-neon/10 pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-xl border border-neon/20 px-4 py-3 text-xs text-neon-400">Cancel</button>
            <button type="submit" disabled={saving} className="flex items-center justify-center gap-2 rounded-xl bg-cyan-300/15 px-5 py-3 text-xs font-bold uppercase tracking-wider text-cyan-100 hover:bg-cyan-300/25 disabled:opacity-40"><Save size={14}/>{saving ? 'Saving draft…' : 'Save as draft'}</button>
          </div>
          <p className="text-center text-[9px] leading-relaxed text-neon-700">Saving a draft does not reserve funds, publish it, charge players or send prizes.</p>
        </form>
      )}

      <div className="space-y-3">
        {loading ? <div className="py-8 text-center text-xs text-neon-600">Loading your raffle drafts…</div> : raffles.length === 0 ? <div className="rounded-xl border border-neon/15 bg-black/20 py-9 text-center"><CircleDollarSign size={25} className="mx-auto text-neon-600"/><p className="mt-2 text-xs text-neon-300">No raffles created yet</p><p className="mt-1 text-[10px] text-neon-600">Create your first draft to get started.</p></div> : raffles.map((raffle) => <article key={raffle.id} className="rounded-xl border border-neon/15 bg-black/25 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h4 className="text-sm font-semibold text-neon-200">{raffle.title}</h4><p className="mt-1 text-[10px] text-neon-600">{raffle.reward_type === 'agent' ? raffle.reward_code === 'alpha' ? 'ZORD Alpha Miner Agent' : 'ZORD Overclocked Core Agent' : money(raffle.prize_pool_amount, raffle.prize_currency)} · {raffle.winner_count} winner(s)</p></div><span className={`rounded-full border px-2.5 py-1 text-[9px] uppercase ${raffle.status === 'published' ? 'border-emerald-400/25 bg-emerald-400/5 text-emerald-200' : 'border-amber-400/25 bg-amber-400/5 text-amber-200'}`}>{raffle.status}</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-neon-500"><span>Minimum: {money(raffle.min_bet_zap, 'ZAP')}</span><span>{raffle.entry_mode === 'proportional' ? 'Proportional tickets' : 'One bet, one ticket'}</span></div></article>)}
      </div>
      <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3"><p className="text-[10px] font-semibold text-amber-200">Publishing is protected</p><p className="mt-1 text-[10px] leading-relaxed text-amber-100/70">A draft cannot go live until its complete prize pool is reserved and verified. TON drafts also need the TON funding wallet and withdrawal flow configured. Winner selection and prize delivery are separate controlled steps.</p></div>
    </section>
  );
}
