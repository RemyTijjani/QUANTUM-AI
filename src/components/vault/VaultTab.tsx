import { useEffect, useState } from 'react';
import { ArrowDownLeft, Coins, History, Wallet } from 'lucide-react';
import { formatZp } from '@/lib/format';
import type { VerifiedLedgerEntry } from '@/lib/economy/verifiedEconomy';
import { supabase } from '@/lib/supabase';
import TonWalletConnection from './TonWalletConnection';
import ZapWalletPanel from './ZapWalletPanel';

export default function VaultTab({
  verifiedZpBalance,
  transactions,
  onRefreshVerifiedEconomy,
  onWalletStatusChange,
}: {
  verifiedZpBalance: number | null;
  transactions: VerifiedLedgerEntry[];
  onRefreshVerifiedEconomy: () => Promise<void> | void;
  onWalletStatusChange?: (connected: boolean) => void;
}) {
  const [history, setHistory] = useState<VerifiedLedgerEntry[]>(transactions);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyUnavailable, setHistoryUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadCompleteHistory() {
      setHistoryLoading(true);
      setHistoryUnavailable(false);
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (sessionError || !token) throw new Error('Session unavailable');

        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/player-history`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${token}`,
              apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
            cache: 'no-store',
          },
        );
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok || !body || typeof body !== 'object' ||
            !Array.isArray((body as { transactions?: unknown }).transactions)) {
          throw new Error('Complete history unavailable');
        }

        const loaded = (body as { transactions: VerifiedLedgerEntry[] }).transactions;
        if (!cancelled) {
          setHistory(loaded);
          setHistoryUnavailable(false);
        }
      } catch {
        if (!cancelled) {
          setHistory(transactions);
          setHistoryUnavailable(true);
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }

    void loadCompleteHistory();
    return () => { cancelled = true; };
  }, [transactions]);

  return (
    <div className="w-full min-w-0 space-y-4 pb-6">
      <header className="flex items-center gap-2 py-1">
        <Wallet size={18} className="text-neon-400" />
        <h1 className="font-display text-2xl font-bold tracking-wide text-white">Vault</h1>
      </header>

      <ZapWalletPanel
        verifiedZpBalance={verifiedZpBalance}
        onWalletChanged={onRefreshVerifiedEconomy}
      />

      <section className="panel min-w-0 space-y-3 p-4">
        <div className="flex items-center gap-2">
          <ArrowDownLeft size={16} className="text-neon-400" />
          <div>
            <h2 className="title">Gram wallet</h2>
          </div>
        </div>
        <TonWalletConnection onWalletStatusChange={onWalletStatusChange} />
      </section>

      <details className="panel group space-y-0 p-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History size={16} className="text-neon-400" />
            <h2 className="title">ZP activity</h2>
          </div>
          <span className="flex items-center gap-2 text-[10px] text-neon-600">
            {history.length} records
            <span aria-hidden="true" className="transition-transform group-open:rotate-180">⌄</span>
          </span>
        </summary>
        <div className="mt-3 border-t border-neon/10 pt-2">
          <p className="mb-2 text-[10px] text-neon-600">
            {historyLoading
              ? 'Loading your complete ZP history…'
              : historyUnavailable
                ? 'Showing available recent history. Complete archive history could not be reached.'
                : 'Complete history loaded from your private archive and live ledger.'}
          </p>
          <div className="flex items-center gap-2">
            <History size={16} className="text-neon-400" />
            <div>
              <h2 className="title">ZP activity</h2>
            </div>
          </div>
          {history.length === 0 ? (
            <div className="rounded-lg border border-neon/10 bg-black/20 px-3 py-6 text-center">
              <Coins size={20} className="mx-auto mb-2 text-neon-700" />
              <p className="text-xs text-neon-500">{verifiedZpBalance === null ? 'ZP activity is loading or temporarily unavailable' : 'No ZP activity yet'}</p>
              <p className="mt-1 text-[10px] text-neon-700">Verified point movements will appear here.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {history.map((entry) => {
                const positive = entry.amount >= 0;
                const dateLabel = entry.createdAt && Number.isFinite(Date.parse(entry.createdAt))
                  ? new Date(entry.createdAt).toLocaleString()
                  : 'Date unavailable';
                const typeLabel = entry.transactionType.replace(/_/g, ' ');
                return (
                  <article key={entry.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-neon/10 py-3 last:border-0">
                    <div className="min-w-0">
                      <p className="truncate text-xs capitalize text-neon-200">{typeLabel}</p>
                      {entry.description && <p className="mt-1 truncate text-[10px] text-neon-700">{entry.description}</p>}
                      <p className="mt-1 text-[9px] text-neon-700">{dateLabel}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`font-display text-sm font-semibold ${positive ? 'text-emerald-300' : 'text-amber-300'}`}>
                        {positive ? '+' : ''}{formatZp(entry.amount)} <span className="text-[10px]">ZP</span>
                      </p>
                      <p className="mt-1 text-[9px] text-neon-700">Balance {formatZp(entry.balanceAfter)}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </details>

    </div>
  );
}
