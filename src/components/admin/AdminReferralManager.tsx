import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Clock3, Coins, History, Loader2, RefreshCw, Save, ShieldAlert, Users } from 'lucide-react';
import { formatZp } from '@/lib/format';
import { AdminApiError, getReferralManagement, saveReferralKickbackBudget, setReferralKickbackAccountStatus } from '@/lib/admin/adminApi';
import type { AdminCredentials, AdminReferralManagement } from '@/lib/admin/adminApi';

export default function AdminReferralManager({ creds }: { creds: AdminCredentials }) {
  const [data, setData] = useState<AdminReferralManagement | null>(null);
  const [budgetInput, setBudgetInput] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyPlayer, setBusyPlayer] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await getReferralManagement(creds);
      setData(next);
      setBudgetInput(String(next.budget.monthlyBudgetZp));
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Could not load referral management.');
    } finally {
      setLoading(false);
    }
  }, [creds]);

  useEffect(() => { void refresh(); }, [refresh]);

  const players = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.players ?? []).filter((player) => !term ||
      [player.username, player.first_name, player.referral_code].some((value) => value?.toLowerCase().includes(term)));
  }, [data, search]);

  const saveBudget = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(budgetInput);
    if (!Number.isFinite(amount) || amount < 0 || Number(amount.toFixed(6)) !== amount) {
      setError('Enter a non-negative ZP amount with up to 6 decimal places.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const updated = await saveReferralKickbackBudget(creds, amount);
      setNotice('Monthly referral budget saved. Eligible verified kickbacks were allocated against the updated budget.');
      await refresh();
      setData((current) => current ? { ...current, budget: updated } : current);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Could not save the monthly budget.');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (playerId: string, status: 'active' | 'held' | 'suspended') => {
    const player = players.find((item) => item.id === playerId);
    const label = player?.username || player?.first_name || player?.referral_code || 'this player';
    const reason = status === 'active' ? '' : window.prompt(`Why should the referral account for ${label} be ${status}?`, '');
    if (status !== 'active' && reason === null) return;
    setBusyPlayer(playerId);
    setError('');
    setNotice('');
    try {
      await setReferralKickbackAccountStatus(creds, playerId, status, reason ?? '');
      setNotice(`Referral account set to ${status}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Could not update this referral account.');
    } finally {
      setBusyPlayer(null);
    }
  };

  const budget = data?.budget;
  const summary = budget?.summary;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-emerald-400/20 bg-[#111a14] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Coins size={16} className="text-emerald-300" /> Monthly kickback budget</h3>
            <p className="mt-1 text-[11px] text-slate-400">Budget period: {budget?.monthStart ?? 'Loading...'}</p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh</button>
        </div>
        <form onSubmit={saveBudget} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-400">Set this month's budget (ZP)</span>
            <input type="number" min="0" step="0.000001" value={budgetInput} onChange={(event) => setBudgetInput(event.target.value)} disabled={loading || saving} className="admin-field" placeholder="Enter monthly ZP budget" />
          </label>
          <button type="submit" disabled={loading || saving || !budgetInput.trim()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-400/15 px-4 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {saving ? 'Saving...' : 'Save budget'}</button>
        </form>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">The budget controls how much verified referral kickback can be allocated this month. Saving it does not directly credit player balances. The system allocates eligible rewards in order; claims remain player-initiated.</p>
      </section>

      {error && <p role="alert" className="border-l-2 border-red-500/60 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">{error}</p>}
      {notice && <p role="status" className="border-l-2 border-emerald-400/60 bg-emerald-400/5 px-3 py-2 text-[11px] text-emerald-200">{notice}</p>}

      {loading && !data ? <p className="py-10 text-center text-xs text-slate-400">Loading referral operations...</p> : data && (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Metric icon={Coins} label="Monthly budget" value={formatZp(budget?.monthlyBudgetZp ?? 0)} />
            <Metric icon={Activity} label="Allocated" value={formatZp(budget?.allocatedZp ?? 0)} />
            <Metric icon={ShieldAlert} label="Remaining" value={formatZp(budget?.remainingBudgetZp ?? 0)} />
            <Metric icon={Users} label="Verified referrals" value={data.referralStats.total.toLocaleString()} />
            <Metric icon={Clock3} label="Pending hold" value={formatZp(summary?.pendingZp ?? 0)} />
            <Metric icon={Coins} label="Verified, unfunded" value={formatZp(summary?.verifiedUnfundedZp ?? 0)} />
            <Metric icon={Activity} label="Claimable" value={formatZp(summary?.claimableZp ?? 0)} />
            <Metric icon={History} label="Lifetime claimed" value={formatZp(summary?.claimedZp ?? 0)} />
          </div>

          <section className="rounded-2xl border border-white/10 bg-[#111a14] p-4">
            <h3 className="text-sm font-semibold text-white">Kickback rules</h3>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Rule label="Direct referral" value={`${(data.rates.directRate * 100).toFixed(2)}%`} />
              <Rule label="Second level" value={`${(data.rates.secondLevelRate * 100).toFixed(2)}%`} />
              <Rule label="Overclock multiplier" value={`${data.rates.overclockMultiplier}×`} />
              <Rule label="Verification hold" value={`${data.rates.pendingHours} hours`} />
            </div>
            <p className="mt-3 text-[10px] text-slate-500">These are the active backend rules. They are displayed here for transparency and are not editable from this screen.</p>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#111a14] p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Users size={15} className="text-emerald-300" /> Referral accounts</h3>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, username or referral code..." className="admin-field mt-3" />
            <div className="mt-3 space-y-2">
              {players.length === 0 ? <p className="py-6 text-center text-xs text-slate-500">No matching player accounts.</p> : players.map((player) => (
                <div key={player.id} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[#0b120e] p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-100">{player.first_name || player.username || 'ZORD player'} {player.username ? `· @${player.username}` : ''}</p>
                    <p className="mt-1 font-mono text-[10px] text-slate-500">{player.referral_code} · {player.referralCount} recruits · {player.levelOneCount} direct</p>
                    {player.reason && <p className="mt-1 text-[10px] text-amber-300">Reason: {player.reason}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-md border px-2 py-1 text-[9px] uppercase tracking-wide ${player.status === 'active' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : player.status === 'held' ? 'border-amber-400/30 bg-amber-400/10 text-amber-200' : 'border-red-400/30 bg-red-400/10 text-red-300'}`}>{player.status}</span>
                    <select aria-label={`Referral status for ${player.referral_code}`} value={player.status} disabled={busyPlayer === player.id} onChange={(event) => void changeStatus(player.id, event.target.value as 'active' | 'held' | 'suspended')} className="admin-field min-w-32 py-2">
                      <option value="active">Active</option><option value="held">Hold rewards</option><option value="suspended">Suspend rewards</option>
                    </select>
                    {busyPlayer === player.id && <Loader2 size={14} className="animate-spin text-emerald-300" />}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px] text-slate-500">Showing up to 200 newest players. Holding pauses eligible rewards; suspension stops new kickback generation. Reactivating releases held entries back into the verification flow.</p>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#111a14] p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><History size={15} className="text-emerald-300" /> Recent kickback entries</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[10px]">
                <thead className="text-slate-500"><tr><th className="px-2 py-2">Recipient</th><th className="px-2 py-2">Level</th><th className="px-2 py-2">Amount</th><th className="px-2 py-2">Allocated</th><th className="px-2 py-2">Claimed</th><th className="px-2 py-2">Status</th></tr></thead>
                <tbody className="divide-y divide-white/5">{data.entries.map((entry) => <tr key={entry.id}><td className="px-2 py-2 text-slate-200">{entry.recipientLabel}</td><td className="px-2 py-2 text-slate-400">L{entry.referral_level}</td><td className="px-2 py-2 tabular-nums text-slate-200">{formatZp(Number(entry.amount))} ZP</td><td className="px-2 py-2 tabular-nums text-emerald-300">{formatZp(Number(entry.allocated_amount))}</td><td className="px-2 py-2 tabular-nums text-slate-400">{formatZp(Number(entry.claimed_amount))}</td><td className="px-2 py-2 capitalize text-slate-300">{entry.status}</td></tr>)}</tbody>
              </table>
              {data.entries.length === 0 && <p className="py-8 text-center text-xs text-slate-500">No kickback entries have been generated yet.</p>}
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#111a14] p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><History size={15} className="text-emerald-300" /> Budget change history</h3>
            <div className="mt-3 space-y-2">{data.history.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 py-2 text-[10px]"><span className="text-slate-400">{new Date(item.created_at).toLocaleString()} · {item.admin_username}</span><span className="tabular-nums text-slate-200">{formatZp(Number(item.old_budget_zp))} → <strong className="text-emerald-300">{formatZp(Number(item.new_budget_zp))} ZP</strong></span></div>)}</div>
            {data.history.length === 0 && <p className="py-6 text-center text-xs text-slate-500">No budget changes recorded yet.</p>}
          </section>
        </>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Coins; label: string; value: string }) {
  return <div className="rounded-xl border border-white/10 bg-[#111a14] p-3"><div className="flex items-center gap-2 text-slate-400"><Icon size={13} /><span className="text-[9px] uppercase tracking-wider">{label}</span></div><p className="mt-2 text-lg font-semibold tabular-nums text-emerald-300">{value}</p><p className="text-[9px] text-slate-500">ZP where applicable</p></div>;
}
function Rule({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-white/10 bg-[#0b120e] p-3"><p className="text-[9px] uppercase tracking-wider text-slate-500">{label}</p><p className="mt-1 text-base font-semibold text-emerald-200">{value}</p></div>;
}
