import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Search, RefreshCw, Users, CalendarDays, UserRound, Wallet } from 'lucide-react';
import AdminPlayerEconomyDetail from '@/components/admin/AdminPlayerEconomyDetail';
import { AdminApiError, listPlayers } from '@/lib/admin/adminApi';
import type { AdminCredentials, AdminPlayer } from '@/lib/admin/adminApi';

interface Props {
  creds: AdminCredentials;
}

const errorMessage = (error: unknown) =>
  error instanceof AdminApiError ? error.message : 'Could not load player records. Please try again.';

const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
};

export default function AdminPlayerManager({ creds }: Props) {
  const [players, setPlayers] = useState<AdminPlayer[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<AdminPlayer | null>(null);

  const loadPlayers = useCallback(async (term: string) => {
    setLoading(true);
    setError('');
    try {
      setPlayers(await listPlayers(creds, term));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [creds]);

  useEffect(() => {
    void loadPlayers('');
  }, [loadPlayers]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadPlayers(search.trim());
  };

  return (
    <section className="space-y-5 rounded-2xl border border-white/10 bg-[#111a14] p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Users size={17} className="text-emerald-300" /> Player management
          </h2>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-400">
            Find a registered player and open their economy details. This directory is read-only.
          </p>
        </div>
        <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium text-slate-300" aria-live="polite">
          {loading ? 'Loading players…' : `${players.length} ${players.length === 1 ? 'player' : 'players'} shown`}
        </span>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="admin-player-search">Search players</label>
        <input
          id="admin-player-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          maxLength={64}
          placeholder="Search by name, username, referral code or Telegram ID"
          className="admin-field min-w-0 flex-1"
        />
        <button
          type="submit"
          disabled={loading}
          className="flex items-center justify-center gap-2 border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-[10px] uppercase tracking-wider text-emerald-300 hover:bg-emerald-400/15 disabled:opacity-50"
        >
          <Search size={13} /> Search players
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => { setSearch(''); void loadPlayers(''); }}
          className="flex items-center justify-center gap-2 border border-white/10 px-3 py-2 text-[10px] uppercase tracking-wider text-slate-400 hover:text-emerald-300 disabled:opacity-50"
          aria-label="Refresh player list"
        >
          <RefreshCw size={13} /> Clear
        </button>
      </form>
      <p className="-mt-2 text-[10px] leading-relaxed text-slate-500">Search checks the player name, username, referral code and Telegram ID. Up to 50 recent matches are shown.</p>

      {error && (
        <div role="alert" className="flex flex-col gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-3 text-[11px] text-red-200 sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => void loadPlayers(search.trim())} disabled={loading} className="self-start rounded-lg border border-red-300/20 px-3 py-1.5 text-red-100 hover:bg-red-400/10 disabled:opacity-50 sm:self-auto">Try again</button>
        </div>
      )}

      {loading ? (
        <div role="status" className="flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] py-12 text-center text-xs text-slate-400">
          <RefreshCw size={18} className="animate-spin text-emerald-300" />
          Loading player directory…
        </div>
      ) : players.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-12 text-center text-slate-400">
          <span className="rounded-full bg-white/5 p-3"><UserRound size={24} /></span>
          <div>
            <p className="text-sm font-semibold text-slate-200">{search.trim() ? 'No players match that search' : 'No player records yet'}</p>
            <p className="mt-1 max-w-sm text-xs text-slate-400">{search.trim() ? 'Check the spelling or try a Telegram ID, username, first name, or referral code.' : 'Player accounts will appear here when they join ZORD.'}</p>
          </div>
          {search.trim() && <button type="button" onClick={() => { setSearch(''); void loadPlayers(''); }} className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-400/15">Clear search and show all players</button>}
        </div>
      ) : (
        <>
        <div className="hidden overflow-x-auto rounded-xl border border-white/10 md:block">
          <table className="w-full min-w-[680px] border-collapse text-left">
            <caption className="sr-only">Player directory search results</caption>
            <thead className="bg-white/[0.03]">
              <tr className="border-b border-white/10 text-[9px] uppercase tracking-wider text-slate-400">
                <th className="px-3 py-3 font-medium">Player</th>
                <th className="px-3 py-3 font-medium">Referral code</th>
                <th className="px-3 py-3 font-medium">Telegram ID</th>
                <th className="px-3 py-3 font-medium">Joined</th>
                <th className="px-3 py-3 font-medium">Economy</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => (
                <tr key={player.id} className="border-b border-white/10 text-[11px] text-emerald-200 transition-colors hover:bg-white/[0.025]">
                  <td className="px-3 py-3">
                    <div className="font-semibold">{player.first_name || 'Unnamed player'}</div>
                    <div className="mt-1 text-[10px] text-slate-400">
                      {player.username ? `@${player.username}` : 'No username'}
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono">{player.referral_code}</td>
                  <td className="px-3 py-3 font-mono">{String(player.telegram_id)}</td>
                  <td className="px-3 py-3 text-slate-400">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays size={12} /> {dateLabel(player.created_at)}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <button type="button" onClick={() => setSelectedPlayer(player)} className="inline-flex items-center gap-1.5 border border-white/10 px-2 py-1.5 text-[9px] uppercase tracking-wider text-emerald-300 hover:bg-emerald-400/10">
                      <Wallet size={11} /> View economy
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-2 md:hidden">
          {players.map((player) => (
            <article key={player.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-emerald-200">{player.first_name || 'Unnamed player'}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-400">{player.username ? `@${player.username}` : 'No username'}</p>
                </div>
                <button type="button" onClick={() => setSelectedPlayer(player)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-2 text-[10px] font-medium text-emerald-200 hover:bg-emerald-400/15">
                  <Wallet size={12} /> View economy
                </button>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-white/10 pt-3 text-[10px]">
                <div><dt className="text-slate-500">Referral code</dt><dd className="mt-0.5 break-all font-mono text-slate-200">{player.referral_code || '—'}</dd></div>
                <div><dt className="text-slate-500">Telegram ID</dt><dd className="mt-0.5 break-all font-mono text-slate-200">{String(player.telegram_id)}</dd></div>
                <div className="col-span-2"><dt className="text-slate-500">Joined</dt><dd className="mt-0.5 text-slate-300">{dateLabel(player.created_at)}</dd></div>
              </dl>
            </article>
          ))}
        </div>
        </>
      )}
      {selectedPlayer && (
        <AdminPlayerEconomyDetail
          creds={creds}
          playerId={selectedPlayer.id}
          playerLabel={selectedPlayer.first_name || selectedPlayer.username || selectedPlayer.referral_code}
        />
      )}
      <p className="text-[10px] text-slate-500">
        This directory does not change player accounts or balances. Economy details are available for inspection only; account restrictions and manual adjustments are not enabled here.
      </p>
    </section>
  );
}
