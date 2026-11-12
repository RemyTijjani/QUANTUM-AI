import { useEffect, useState } from 'react';
import { History, Wallet, RefreshCw } from 'lucide-react';
import { AdminApiError, getPlayerEconomy } from '@/lib/admin/adminApi';
import type { AdminCredentials, AdminPlayerEconomyDetail } from '@/lib/admin/adminApi';

interface Props {
  creds: AdminCredentials;
  playerId: string;
  playerLabel: string;
}

const amount = (value: number | string | null | undefined) => {
  if (value === null || value === undefined) return '—';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString() : String(value);
};

const dateLabel = (value: string | null) => {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
};

export default function AdminPlayerEconomyDetail({ creds, playerId, playerLabel }: Props) {
  const [detail, setDetail] = useState<AdminPlayerEconomyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setDetail(await getPlayerEconomy(creds, playerId));
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Could not load economy details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [creds, playerId]);

  return (
    <section className="mt-4 space-y-4 border border-neon/30 bg-black/30 p-4" aria-label={`Economy details for ${playerLabel}`}>
      <div className="flex items-center justify-between gap-3 border-b border-neon/20 pb-3">
        <div>
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-neon-300">
            <Wallet size={14} /> Player Economy
          </h3>
          <p className="mt-1 text-[10px] text-neon-600">{playerLabel}</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="flex items-center gap-2 border border-neon/30 px-3 py-2 text-[10px] text-neon-400 disabled:opacity-50">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {loading ? (
        <p className="py-6 text-center text-xs text-neon-500">Loading economy records…</p>
      ) : error ? (
        <p role="alert" className="border-l-2 border-red-500/60 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="border border-neon/15 p-3">
              <p className="text-[9px] uppercase tracking-wider text-neon-600">Current ZP</p>
              <p className="mt-1 text-lg font-bold text-neon-200">{amount(detail?.economy?.zp_balance)}</p>
            </div>
            <div className="border border-neon/15 p-3">
              <p className="text-[9px] uppercase tracking-wider text-neon-600">Lifetime ZP</p>
              <p className="mt-1 text-lg font-bold text-neon-200">{amount(detail?.economy?.lifetime_zp)}</p>
            </div>
            <div className="border border-neon/15 p-3">
              <p className="text-[9px] uppercase tracking-wider text-neon-600">Pending kickback</p>
              <p className="mt-1 text-lg font-bold text-neon-200">{amount(detail?.economy?.pending_kickback)}</p>
            </div>
          </div>

          {!detail?.economy && (
            <p className="text-[11px] text-amber-300">No player_economy record exists for this player yet.</p>
          )}
          <p className="text-[10px] text-neon-600">ZAP balance is not present in the supplied player_economy schema, so no ZAP balance is displayed here.</p>

          <div className="space-y-2">
            <h4 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-neon-400">
              <History size={13} /> Recent ledger entries (up to 50)
            </h4>
            {detail?.ledger.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] border-collapse text-left">
                  <thead><tr className="border-b border-neon/20 text-[9px] uppercase text-neon-600">
                    <th className="px-2 py-2">Type</th><th className="px-2 py-2">Amount</th><th className="px-2 py-2">Balance after</th><th className="px-2 py-2">Reference</th><th className="px-2 py-2">Date</th>
                  </tr></thead>
                  <tbody>
                    {detail.ledger.map((entry) => (
                      <tr key={entry.id} className="border-b border-neon/10 text-[10px] text-neon-300">
                        <td className="px-2 py-2">{entry.transaction_type}</td>
                        <td className="px-2 py-2 font-mono">{amount(entry.amount)}</td>
                        <td className="px-2 py-2 font-mono">{amount(entry.balance_after)}</td>
                        <td className="max-w-[150px] truncate px-2 py-2">{entry.reference_id || entry.description || '—'}</td>
                        <td className="px-2 py-2 text-neon-600">{dateLabel(entry.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="py-4 text-center text-[11px] text-neon-600">No ledger entries found.</p>}
          </div>
        </>
      )}
      <p className="text-[9px] text-neon-700">Read-only view. No balances or ledger entries can be edited from this panel.</p>
    </section>
  );
}
