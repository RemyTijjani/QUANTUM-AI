import { Cpu, ShieldCheck } from 'lucide-react';

export default function ZordAgentsTab() {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="pointer-events-none absolute inset-0 bg-obsidian/60 backdrop-blur-xl" />
      <div className="pointer-events-none absolute inset-0 scan-bars opacity-30" />

      <div className="relative z-10 flex flex-col items-center text-center">
        <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-2xl border border-neon/40 bg-neon/10 shadow-glow">
          <Cpu size={40} className="text-neon-400 animate-soft-pulse" />
        </div>

        <div className="mb-2 flex items-center gap-2">
          <ShieldCheck size={16} className="text-neon-500" />
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-neon-500">Classified</span>
        </div>

        <h2 className="glow-text font-display text-2xl font-bold uppercase tracking-[0.14em] text-neon-300 sm:text-3xl">
          ZORD AGENTS
        </h2>
        <p className="glow-text mt-1 font-display text-lg font-bold uppercase tracking-[0.2em] text-neon-400 sm:text-xl">
          Coming Soon
        </p>

        <p className="mt-6 max-w-xs font-mono text-[12px] leading-relaxed text-neon-500">
          Total Group Dominion protocols are currently compiling. Autonomous moderation intelligence launching soon.
        </p>

        <div className="mt-8 flex items-center gap-2 rounded-full border border-neon/20 bg-black/40 px-4 py-2">
          <span className="h-1.5 w-1.5 animate-soft-pulse rounded-full bg-neon shadow-glow" />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-neon-500">
            Deployment in progress
          </span>
        </div>
      </div>
    </div>
  );
}
