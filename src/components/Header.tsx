import { Trophy, User, Zap } from 'lucide-react';
import { formatZp } from '@/lib/format';

interface HeaderProps {
  zp: number;
  verifiedZpBalance: number | null;
  onOpenProfile: () => void;
  onOpenLeaderboard: () => void;
}

export default function Header({ zp, verifiedZpBalance, onOpenProfile, onOpenLeaderboard }: HeaderProps) {
  return (
    <header className="relative z-20 flex items-center justify-between gap-3 border-b border-neon/20 bg-obsidian/90 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)] backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onOpenProfile}
          aria-label="Open operative profile"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neon/50 bg-neon/10 text-neon-400 shadow-glow transition duration-200 hover:bg-neon/20 active:scale-95"
        >
          <User size={20} />
        </button>
        <div className="min-w-0">
          <h1 className="title glow-text leading-none">ZORD</h1>
          <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-neon-500">
            <span className="h-1.5 w-1.5 shrink-0 animate-soft-pulse rounded-full bg-neon shadow-glow" />
            <span className="truncate">AUTONOMOUS AGENT // GAME STATE PREVIEW</span>
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onOpenLeaderboard}
          aria-label="Open global leaderboard"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-neon/30 text-neon-400 transition duration-200 hover:border-neon/60 hover:bg-neon/10 active:scale-95"
        >
          <Trophy size={17} />
        </button>
        <div className="flex flex-col items-end gap-1">
          <div
            className="flex items-center gap-1.5 rounded-full border border-neon/50 bg-neon/10 px-3 py-1.5 text-neon-300 shadow-glow"
            aria-live="polite"
            aria-label="Game ZP balance"
          >
            <Zap size={14} className="fill-neon/40" />
            <span className="font-display text-sm font-bold tabular-nums">{formatZp(Number(zp) || 0)}</span>
            <span className="font-mono text-[10px] text-neon-500">GAME ZP</span>
          </div>
          <div
            className="rounded-full border border-sky-400/30 bg-sky-400/5 px-2.5 py-1 font-mono text-[9px] text-sky-200"
            aria-live="polite"
            aria-label="Verified server ZP balance"
            title="Server-recorded ZP rewards. Separate from the existing game balance."
          >
            VERIFIED ZP: {verifiedZpBalance === null ? '—' : formatZp(verifiedZpBalance)}
          </div>
        </div>
      </div>
    </header>
  );
}
