import { Bot } from 'lucide-react';

interface CharacterCardProps {
  fixed: number;
  lifetimeZp: string;
  rate: string;
}

export default function CharacterCard({ fixed, lifetimeZp, rate }: CharacterCardProps) {
  const stats = [
    { label: 'Fragments', value: `${fixed}/4` },
    { label: 'Game lifetime ZP', value: lifetimeZp },
    { label: 'Estimated ZP / sec', value: rate },
  ];

  return (
    <section className="panel p-5">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-neon/50 bg-neon/10 text-neon-400 shadow-glow">
          <Bot size={28} />
        </div>
        <div className="min-w-0">
          <p className="label">Entity profile</p>
          <h3 className="title mt-1 truncate">ZORD Entity #047</h3>
          <p className="font-mono text-[11px] text-neon-500">Autonomous fragment core // signal degraded</p>
        </div>
      </div>

      <p className="mt-4 font-mono text-xs leading-relaxed text-neon-300/90">
        ZORD was scattered across the grid in four pieces. Restore fragments to advance the local game simulation.
        These game-state estimates do not credit the verified ZP economy.
      </p>

      <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-neon/15 pt-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-neon/15 bg-black/40 px-2 py-2.5 text-center">
            <dt className="font-mono text-[10px] uppercase tracking-wider text-neon-500">{stat.label}</dt>
            <dd className="mt-1 truncate font-display text-xs font-bold tabular-nums text-neon-300">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
