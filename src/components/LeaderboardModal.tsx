import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import Modal from '@/components/Modal';
import { fetchZapLeaderboard } from '@/lib/economy/zapWallet';
import type { ZapLeaderboard } from '@/lib/economy/zapWallet';
import { formatZp } from '@/lib/format';

interface LeaderboardModalProps {
  onClose: () => void;
}

const RANK_TONE = ['text-amber-300', 'text-neon-300', 'text-cyan-300'];

export default function LeaderboardModal({ onClose }: LeaderboardModalProps) {
  const [leaderboard, setLeaderboard] = useState<ZapLeaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchZapLeaderboard()
      .then((result) => { if (active) setLeaderboard(result); })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load rankings.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const entries = leaderboard?.entries ?? [];
  const meIsListed = entries.some((entry) => entry.isYou);

  return (
    <Modal title="ZAP Activity Ranking" onClose={onClose}>
      <div className="mb-4 rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-3">
        <p className="font-mono text-[9px] uppercase tracking-wider text-cyan-500">Your verified ranking</p>
        {loading ? (
          <p className="mt-2 font-display text-xl text-cyan-200">Loading…</p>
        ) : leaderboard ? (
          <div className="mt-1 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
            <p className="font-display text-2xl font-bold text-cyan-100">#{leaderboard.me.rank}</p>
            <p className="font-mono text-xs tabular-nums text-cyan-200">{formatZp(Number(leaderboard.me.rankingEarned))} net ZAP</p>
          </div>
        ) : (
          <p className="mt-2 font-mono text-xs text-red-300">Ranking unavailable</p>
        )}
      </div>

      {loading && <p className="py-8 text-center font-mono text-xs text-neon-500">Loading leaderboard…</p>}
      {error && <p role="alert" className="py-4 text-center font-mono text-xs text-red-300">{error}</p>}
      {!loading && !error && entries.length === 0 && (
        <p className="py-8 text-center font-mono text-xs text-neon-500">No leaderboard entries yet.</p>
      )}

      {!loading && !error && entries.length > 0 && (
        <ol className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.rank} className={`flex min-w-0 items-center gap-2 sm:gap-3 rounded-lg border px-3 py-3 ${entry.isYou ? 'border-cyan-300/60 bg-cyan-300/10 shadow-glow' : 'border-neon/15 bg-black/40'}`}>
              <span className={`w-12 shrink-0 whitespace-nowrap font-display text-sm font-bold tabular-nums ${RANK_TONE[entry.rank - 1] ?? 'text-neon-600'}`}>
                {entry.rank <= 3 ? <Trophy size={16} className="inline" /> : `#${entry.rank}`}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-neon-200">{entry.name}</span>
              <span className="shrink-0 whitespace-nowrap font-mono text-xs tabular-nums text-cyan-200">{formatZp(Number(entry.rankingEarned))} ZAP</span>
            </li>
          ))}
          {!meIsListed && leaderboard?.me && (
            <li className="flex min-w-0 items-center gap-2 sm:gap-3 rounded-lg border border-cyan-300/60 bg-cyan-300/10 px-3 py-3">
              <span className="w-12 shrink-0 whitespace-nowrap font-display text-sm font-bold tabular-nums text-cyan-200">#{leaderboard.me.rank}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-cyan-100">{leaderboard.me.name}</span>
              <span className="shrink-0 whitespace-nowrap font-mono text-xs tabular-nums text-cyan-200">{formatZp(Number(leaderboard.me.rankingEarned))} ZAP</span>
            </li>
          )}
        </ol>
      )}

      <p className="mt-4 text-center font-mono text-[9px] leading-relaxed text-neon-600">
        Ranked by net ZAP activity. Rankings refresh periodically as the leaderboard evolves.
      </p>
    </Modal>
  );
}
