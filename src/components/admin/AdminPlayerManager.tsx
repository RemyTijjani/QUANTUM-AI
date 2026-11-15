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
    <section className="rounded-2xl border border-white/10 bg-[#111a14] p-4 shadow-sm space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-3">
        <div>
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-300">
            <Users size={15} /> Player Directory
          </h2>
          <p className="mt-1 text-[10px] text-slate-400">
            Read-only account lookup. Up to 50 most recent matches.
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-slate-400">
          {loading ? 'Loading records…' : `${players.length} record${players.length === 1 ? '' : 's'} shown`}
        </span>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="admin-player-search">Search players</label>
        <input
          id="admin-player-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          maxLength={64}
          placeholder="Search username, first name, referral code, or Telegram ID"
          className="min-w-0 flex-1 border border-white/10 bg-[#0b120e] px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-400/40"
        />
        <button
          type="submit"
          disabled={loading}
          className="flex items-center justify-center gap-2 border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-[10px] uppercase tracking-wider text-emerald-300 hover:bg-emerald-400/15 disabled:opacity-50"
        >
          <Search size={13} /> Search
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => { setSearch(''); void loadPlayers(''); }}
          className="flex items-center justify-center gap-2 border border-white/10 px-3 py-2 text-[10px] uppercase tracking-wider text-slate-400 hover:text-emerald-300 disabled:opacity-50"
          aria-label="Refresh player list"
        >
          <RefreshCw size={13} /> Reset
        </button>
      </form>

      {error && (
        <div role="alert" className="border-l-2 border-red-500/60 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-xs text-slate-400">Loading player directory…</div>
      ) : players.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-slate-400">
          <UserRound size={28} />
          <p className="text-xs">No matching player records found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-left">
            <thead>
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
                <tr key={player.id} className="border-b border-white/10 text-[11px] text-emerald-300">
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
                      <Wallet size={11} /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selectedPlayer && (
        <AdminPlayerEconomyDetail
          creds={creds}
          playerId={selectedPlayer.id}
          playerLabel={selectedPlayer.first_name || selectedPlayer.username || selectedPlayer.referral_code}
        />
      )}
      <p className="text-[10px] text-slate-500">
        Player records are not modified from this directory. Account restrictions and economy adjustments are not enabled here.
      </p>
    </section>
  );
}
