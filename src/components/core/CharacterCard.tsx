import { Bot } from 'lucide-react';

interface CharacterCardProps {
  fixed: number;
  rate: string;
  entityNumber: number | null;
}

export default function CharacterCard({ fixed, rate, entityNumber }: CharacterCardProps) {
  const stats = [
    { label: 'Fragments online', value: `${fixed}/4` },
    { label: 'Mining rate', value: `${rate} ZP/s` },
    { label: 'Reward maturity', value: '6h' },
  ];

  return (
    <section className="panel min-w-0 border border-neon/25 bg-black/35 p-3" aria-label="Entity profile">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-neon/50 bg-neon/10 text-neon-400 shadow-glow">
          <Bot size={23} />
        </div>
        <div className="min-w-0">
          <p className="label">Entity profile</p>
          <h3 className="title mt-1 truncate">ZORD Entity {entityNumber === null ? '—' : `#${String(entityNumber).padStart(8, '0')}`}</h3>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-1.5 border-t border-neon/15 pt-3">
        {stats.map((stat) => (
          <div key={stat.label} className="min-w-0 rounded-lg border border-neon/15 bg-black/40 px-1.5 py-2 text-center">
            <dt className="min-h-[2em] font-mono text-[8px] uppercase leading-tight tracking-wide text-neon-500">{stat.label}</dt>
            <dd className="mt-1 break-words font-display text-[11px] font-bold tabular-nums text-neon-300">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
