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
    <section className="panel space-y-4 border border-neon/20 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-neon/20 pb-3">
        <div>
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-neon-300">
            <Users size={15} /> Player Directory
          </h2>
          <p className="mt-1 text-[10px] text-neon-600">
            Read-only account lookup. Up to 50 most recent matches.
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-neon-500">
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
          className="min-w-0 flex-1 border border-neon/30 bg-black/50 px-3 py-2 text-xs text-neon-200 outline-none focus:border-neon"
        />
        <button
          type="submit"
          disabled={loading}
          className="flex items-center justify-center gap-2 border border-neon/50 bg-neon/10 px-4 py-2 text-[10px] uppercase tracking-wider text-neon-300 hover:bg-neon/20 disabled:opacity-50"
        >
          <Search size={13} /> Search
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => { setSearch(''); void loadPlayers(''); }}
          className="flex items-center justify-center gap-2 border border-neon/20 px-3 py-2 text-[10px] uppercase tracking-wider text-neon-500 hover:text-neon-300 disabled:opacity-50"
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
        <div className="py-10 text-center text-xs text-neon-500">Loading player directory…</div>
      ) : players.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-neon-600">
          <UserRound size={28} />
          <p className="text-xs">No matching player records found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-left">
            <thead>
              <tr className="border-b border-neon/20 text-[9px] uppercase tracking-wider text-neon-600">
                <th className="px-3 py-3 font-medium">Player</th>
                <th className="px-3 py-3 font-medium">Referral code</th>
                <th className="px-3 py-3 font-medium">Telegram ID</th>
                <th className="px-3 py-3 font-medium">Joined</th>
                <th className="px-3 py-3 font-medium">Economy</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => (
                <tr key={player.id} className="border-b border-neon/10 text-[11px] text-neon-300">
                  <td className="px-3 py-3">
                    <div className="font-semibold">{player.first_name || 'Unnamed player'}</div>
                    <div className="mt-1 text-[10px] text-neon-600">
                      {player.username ? `@${player.username}` : 'No username'}
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono">{player.referral_code}</td>
                  <td className="px-3 py-3 font-mono">{String(player.telegram_id)}</td>
                  <td className="px-3 py-3 text-neon-500">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays size={12} /> {dateLabel(player.created_at)}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <button type="button" onClick={() => setSelectedPlayer(player)} className="inline-flex items-center gap-1.5 border border-neon/30 px-2 py-1.5 text-[9px] uppercase tracking-wider text-neon-300 hover:bg-neon/10">
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
      <p className="text-[10px] text-neon-700">
        Player records are not modified from this directory. Account restrictions and economy adjustments are not enabled here.
      </p>
    </section>
  );
}
