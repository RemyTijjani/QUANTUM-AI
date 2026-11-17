import { Bot } from 'lucide-react';

interface CharacterCardProps {
  fixed: number;
  rate: string;
}

export default function CharacterCard({ fixed, rate }: CharacterCardProps) {
  const stats = [
    { label: 'Fragments online', value: `${fixed}/4` },
    { label: 'Mining rate', value: `${rate} ZP/s` },
    { label: 'Reward maturity', value: '6 hours' },
  ];

  return (
    <section className="panel min-w-0 p-3 min-[380px]:p-4 sm:p-5">
      <div className="flex min-w-0 items-center gap-3 min-[380px]:gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-neon/50 bg-neon/10 text-neon-400 shadow-glow">
          <Bot size={28} />
        </div>
        <div className="min-w-0">
          <p className="label">Entity profile</p>
          <h3 className="title mt-1 truncate">ZORD Entity #047</h3>
          <p className="break-words font-mono text-[10px] leading-relaxed text-neon-500 min-[380px]:text-[11px]">Autonomous fragment core // signal degraded</p>
        </div>
      </div>

      <p className="mt-4 break-words font-mono text-[11px] leading-relaxed text-neon-300/90 min-[380px]:text-xs">
        ZORD was scattered across the grid in four pieces. Restore fragments to bring the core online. Fragment mining is recorded by the trusted gameplay service, and earned ZP is released to your verified balance after the six-hour pending period.
      </p>

      <dl className="mt-5 grid grid-cols-1 min-[520px]:grid-cols-3 gap-2 border-t border-neon/15 pt-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-neon/15 bg-black/40 px-2 py-2.5 text-center">
            <dt className="font-mono text-[10px] uppercase tracking-wider text-neon-500">{stat.label}</dt>
            <dd className="mt-1 break-words font-display text-xs font-bold tabular-nums text-neon-300">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
