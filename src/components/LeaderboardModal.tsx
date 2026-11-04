import { Trophy } from 'lucide-react';
import { RIVALS } from '@/lib/game/config';
import { formatZp } from '@/lib/format';
import Modal from '@/components/Modal';

interface LeaderboardModalProps {
  lifetimeZp: number;
  onClose: () => void;
}

interface Entry {
  name: string;
  zp: number;
  isYou: boolean;
}

const RANK_TONE = ['text-amber-300', 'text-neon-300', 'text-cyan-300'];

export default function LeaderboardModal({ lifetimeZp, onClose }: LeaderboardModalProps) {
  const entries: Entry[] = [
    ...RIVALS.map((rival) => ({ ...rival, isYou: false })),
    { name: 'OPERATIVE-047 (ZORD)', zp: lifetimeZp, isYou: true },
  ].sort((a, b) => b.zp - a.zp);

  return (
    <Modal title="Global Leaderboard" onClose={onClose}>
      <ol className="space-y-2">
        {entries.map((entry, index) => {
          const rank = index + 1;
          return (
            <li
              key={entry.name}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
                entry.isYou ? 'border-neon/70 bg-neon/15 shadow-glow' : 'border-neon/15 bg-black/40'
              }`}
            >
              <span className={`w-7 font-display text-sm font-bold tabular-nums ${RANK_TONE[index] ?? 'text-neon-600'}`}>
                {rank <= 3 ? <Trophy size={16} className="inline" /> : `#${rank}`}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-neon-300">{entry.name}</span>
              <span className="font-mono text-xs tabular-nums text-neon-400">{formatZp(entry.zp)} ZP</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-wider text-neon-600">
        Ranked by lifetime ZP
      </p>
    </Modal>
  );
}
