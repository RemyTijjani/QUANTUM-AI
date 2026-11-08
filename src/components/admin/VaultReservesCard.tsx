import { useState, FormEvent } from 'react';
import { Cpu, Coins, Edit2, Loader2 } from 'lucide-react';
import { formatZp } from '@/lib/format';
import { AdminApiError } from '@/lib/admin/adminApi';
import type { AdminVaultReserves } from '@/lib/admin/adminApi';

interface VaultReservesCardProps {
  reserves: AdminVaultReserves;
  refreshing: boolean;
  onSave: (reserves: AdminVaultReserves) => Promise<void>;
}

export default function VaultReservesCard({ reserves, refreshing, onSave }: VaultReservesCardProps) {
  const [editing, setEditing] = useState(false);
  const [tonDraft, setTonDraft] = useState('');
  const [zpDraft, setZpDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const startEditing = () => {
    setTonDraft(String(reserves.tonReserve));
    setZpDraft(String(reserves.zpReserve));
    setError('');
    setEditing(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onSave({ tonReserve: Number(tonDraft), zpReserve: Number(zpDraft) });
      setEditing(false);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Could not save reserves. Please try again.');
    }
    setSaving(false);
  };

  return (
    <div className="panel p-4 border border-neon/20 bg-neon/5 space-y-4">
      <div className="flex items-center justify-between border-b border-neon/20 pb-2">
        <h2 className="text-xs uppercase tracking-widest text-neon-400 font-bold flex items-center gap-2">
          <Coins size={14} /> Vault Reserves
        </h2>
        {!editing && (
          <button
            type="button"
            onClick={startEditing}
            disabled={refreshing}
            className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-neon-500 transition hover:text-neon-300 disabled:opacity-50"
          >
            <Edit2 size={12} /> Edit
          </button>
        )}
      </div>

      {editing ? (
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-neon-500 uppercase">TON Reserve</label>
            <input
              type="number"
              min={0}
              step="0.0001"
              value={tonDraft}
              onChange={(e) => setTonDraft(e.target.value)}
              required
              disabled={saving}
              className="w-full mt-1 bg-black/60 border border-neon/30 p-2 text-xs text-neon-300 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="text-[11px] text-neon-500 uppercase">ZP Reserve</label>
            <input
              type="number"
              min={0}
              step={1}
              value={zpDraft}
              onChange={(e) => setZpDraft(e.target.value)}
              required
              disabled={saving}
              className="w-full mt-1 bg-black/60 border border-neon/30 p-2 text-xs text-neon-300 disabled:opacity-50"
            />
          </div>
          {error && (
            <p role="alert" className="sm:col-span-2 text-[11px] text-red-400 border-l-2 border-red-500/50 pl-2">{error}</p>
          )}
          <div className="sm:col-span-2 flex gap-2">
            <button type="submit" disabled={saving} className="flex-1 py-2 flex items-center justify-center gap-2 bg-neon/20 hover:bg-neon/30 border border-neon text-xs uppercase tracking-wider font-bold disabled:opacity-60">
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? 'Saving...' : 'Save Reserves'}
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="flex-1 py-2 border border-neon/30 text-xs uppercase tracking-wider text-neon-500 hover:text-neon-300 disabled:opacity-50">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-2 text-neon-500 mb-1">
              <Coins size={14} /> <span className="text-[11px] uppercase tracking-wider">TON Reserve</span>
            </div>
            <p className="text-2xl font-display font-bold text-neon-300 tabular-nums">
              {refreshing ? '...' : reserves.tonReserve.toLocaleString(undefined, { maximumFractionDigits: 4 })}
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2 text-neon-500 mb-1">
              <Cpu size={14} /> <span className="text-[11px] uppercase tracking-wider">ZP Reserve</span>
            </div>
            <p className="text-2xl font-display font-bold text-neon-300 tabular-nums">
              {refreshing ? '...' : formatZp(reserves.zpReserve)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
