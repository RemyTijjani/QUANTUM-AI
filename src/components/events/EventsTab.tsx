import { CalendarDays, Clock3, Trophy, Sparkles } from 'lucide-react';

type EventCategory = 'Daily' | 'Weekly' | 'Monthly' | 'Special';

const categories: { label: EventCategory; description: string; icon: typeof CalendarDays }[] = [
  { label: 'Daily', description: 'Short activities and daily participation.', icon: Clock3 },
  { label: 'Weekly', description: 'Community competitions and weekly rankings.', icon: Trophy },
  { label: 'Monthly', description: 'Genesis events and milestone challenges.', icon: CalendarDays },
  { label: 'Special', description: 'Limited-time events announced by the team.', icon: Sparkles },
];

export default function EventsTab() {
  return (
    <div className="space-y-5 pb-4">
      <header className="panel border border-neon/30 bg-neon/5 p-4">
        <div className="flex items-center gap-2 text-neon-400">
          <CalendarDays size={18} />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">Community calendar</span>
        </div>
        <h1 className="mt-2 font-display text-xl font-bold tracking-wider text-neon-300">Events Hub</h1>
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-neon-600">
          Discover platform events, follow participation and track your event rewards.
        </p>
      </header>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-neon-400">Event channels</h2>
          <span className="border border-neon/20 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-neon-600">Coming online</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {categories.map(({ label, description, icon: Icon }) => (
            <article key={label} className="panel min-h-28 border border-neon/20 bg-black/40 p-3">
              <Icon size={17} className="text-neon-400" />
              <h3 className="mt-2 font-mono text-[11px] font-bold uppercase tracking-wider text-neon-300">{label} Events</h3>
              <p className="mt-1 font-mono text-[10px] leading-relaxed text-neon-700">{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel border border-neon/20 bg-black/40 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-neon-400">Active & upcoming</h2>
          <span className="font-mono text-[9px] uppercase text-neon-700">Live feed</span>
        </div>
        <div className="flex flex-col items-center py-9 text-center">
          <CalendarDays size={28} className="text-neon-700" />
          <p className="mt-3 font-mono text-[11px] text-neon-500">No events have been published yet.</p>
          <p className="mt-1 max-w-xs font-mono text-[10px] leading-relaxed text-neon-700">
            Published events will appear here with their schedule, objectives, participation rules and eligible rewards.
          </p>
        </div>
      </section>

      <section className="panel border border-neon/20 bg-black/40 p-4">
        <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-neon-400">Your event history</h2>
        <p className="py-6 text-center font-mono text-[10px] text-neon-700">Your joined and completed events will appear here.</p>
      </section>
    </div>
  );
}
