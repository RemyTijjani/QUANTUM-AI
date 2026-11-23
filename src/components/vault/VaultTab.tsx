import { useEffect, useState } from 'react';
import { ArrowDownLeft, Coins, History, Wallet } from 'lucide-react';
import { formatZp } from '@/lib/format';
import type { VerifiedLedgerEntry } from '@/lib/economy/verifiedEconomy';
import { supabase } from '@/lib/supabase';
import TonWalletConnection from './TonWalletConnection';
import ZapWalletPanel from './ZapWalletPanel';

type OtherHistoryItem = {
  table: string;
  id: string;
  occurredAt: string | null;
  record: Record<string, unknown>;
};

const OTHER_HISTORY_LABELS: Record<string, string> = {
  fragment_mining_accruals: 'Fragment mining accrual',
  fragment_mining_rewards: 'Fragment reward',
  gameplay_action_events: 'Gameplay action',
  creator_ops_submissions: 'Creator Ops submission',
  x_follow_submissions: 'X Follow submission',
  game_event_participation_audit: 'Game participation review',
  raffle_entries: 'Raffle entry',
  raffle_winners: 'Raffle prize',
  daily_uplink_claims: 'Daily Uplink claim',
  share_uplink_mission_claims: 'Share Uplink claim',
  telegram_mission_claims: 'Telegram mission claim',
  agent_rental_zp_accruals: 'Agent rental accrual',
  agent_rental_payment_intents: 'Agent rental payment',
  player_agent_rentals: 'Mining agent rental',
  expedition_objective_progress: 'Expedition objective',
  expedition_trusted_evidence: 'Expedition evidence',
  expedition_participations: 'Expedition participation',
  expedition_reward_issuances: 'Expedition reward',
  expedition_team_members: 'Expedition team membership',
  game_event_participations: 'Game participation',
  briefing_attempts: 'Briefing attempt',
  briefing_progress: 'Briefing progress',
  briefing_reward_issuances: 'Briefing reward',
};

function otherHistorySummary(item: OtherHistoryItem): string {
  const record = item.record;
  const parts: string[] = [];
  const status = record.status ?? record.delivery_status ?? record.membership_status;
  if (typeof status === 'string') parts.push(status.replace(/_/g, ' '));
  const detail = record.action_type ?? record.action ?? record.service ?? record.platform ?? record.agent_type;
  if (typeof detail === 'string') parts.push(detail.replace(/_/g, ' '));
  const amount = record.amount ?? record.reward_zp ?? record.reward_amount ?? record.prize_amount ?? record.stake_zap;
  if (typeof amount === 'number' || typeof amount === 'string') {
    const currency = record.reward_currency ?? record.prize_currency ??
      (record.stake_zap !== undefined ? 'ZAP' : 'ZP');
    parts.push(`${amount} ${typeof currency === 'string' ? currency : ''}`.trim());
  }
  if (typeof record.score === 'number') parts.push(`Score ${record.score}`);
  if (typeof record.passed === 'boolean') parts.push(record.passed ? 'Passed' : 'Not passed');
  return parts.length ? parts.join(' · ') : 'Activity recorded';
}

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
  const [otherHistory, setOtherHistory] = useState<OtherHistoryItem[]>([]);

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
        const otherLoaded = Array.isArray((body as { otherHistory?: unknown }).otherHistory)
          ? (body as { otherHistory: OtherHistoryItem[] }).otherHistory
          : [];
        if (!cancelled) {
          setOtherHistory(otherLoaded);
          const merged = new Map(loaded.map((entry) => [entry.id, entry]));
          for (const entry of transactions) merged.set(entry.id, entry);
          setHistory(Array.from(merged.values()).sort((a, b) => {
            const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
            const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
            return bTime - aTime || b.id.localeCompare(a.id);
          }));
          setHistoryUnavailable(false);
        }
      } catch {
        if (!cancelled) {
          setHistory(transactions);
          setOtherHistory([]);
          setHistoryUnavailable(true);
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }

    void loadCompleteHistory();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setHistory((current) => {
      const merged = new Map(current.map((entry) => [entry.id, entry]));
      for (const entry of transactions) merged.set(entry.id, entry);
      return Array.from(merged.values()).sort((a, b) => {
        const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
        const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
        return bTime - aTime || b.id.localeCompare(a.id);
      });
    });
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
                : 'Complete history of ZP activities'}
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

      <details className="panel group space-y-0 p-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History size={16} className="text-neon-400" />
            <h2 className="title">Other activity history</h2>
          </div>
          <span className="flex items-center gap-2 text-[10px] text-neon-600">
            {otherHistory.length} records
            <span aria-hidden="true" className="transition-transform group-open:rotate-180">⌄</span>
          </span>
        </summary>
        <div className="mt-3 border-t border-neon/10 pt-3">
          <p className="mb-2 text-[10px] text-neon-600">
            {historyLoading
              ? 'Loading your other activity history…'
              : historyUnavailable
                ? 'Other activity history is temporarily unavailable.'
                : 'Activity history from your live records and verified private archive.'}
          </p>
          {otherHistory.length === 0 ? (
            <div className="rounded-lg border border-neon/10 bg-black/20 px-3 py-5 text-center">
              <p className="text-xs text-neon-500">{historyLoading ? 'Loading activity…' : 'No other activity records yet'}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {otherHistory.map((item) => (
                <article key={`${item.table}:${item.id}`} className="border-b border-neon/10 py-3 last:border-0">
                  <p className="text-xs capitalize text-neon-200">
                    {OTHER_HISTORY_LABELS[item.table] ?? item.table.replace(/_/g, ' ')}
                  </p>
                  <p className="mt-1 text-[10px] capitalize text-neon-500">{otherHistorySummary(item)}</p>
                  <p className="mt-1 text-[9px] text-neon-700">
                    {item.occurredAt && Number.isFinite(Date.parse(item.occurredAt))
                      ? new Date(item.occurredAt).toLocaleString()
                      : 'Date unavailable'}
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>
      </details>

    </div>
  );
}
