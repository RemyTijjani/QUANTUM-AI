import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Compass,
  Gift,
  Radio,
  ShieldAlert,
  Sparkles,
  Target,
} from 'lucide-react';

export type EngagementView = 'missions' | 'streaks' | 'mystery' | 'briefings' | 'expeditions';

const VIEWS: { id: EngagementView; label: string; icon: typeof Target }[] = [
  { id: 'missions', label: 'Missions', icon: Target },
  { id: 'streaks', label: 'Streaks', icon: CalendarDays },
  { id: 'mystery', label: 'Mystery', icon: Gift },
  { id: 'briefings', label: 'Briefings', icon: Radio },
  { id: 'expeditions', label: 'Expeditions', icon: Compass },
];

export default function Stage6EngagementHub({
  active,
  onChange,
}: {
  active: EngagementView;
  onChange: (view: EngagementView) => void;
}) {
  return (
    <>
      <nav aria-label="Mission experiences" className="grid grid-cols-5 gap-1 rounded-xl border border-neon/20 bg-black/30 p-1">
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-current={active === id ? 'page' : undefined}
            className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 font-mono text-[8px] uppercase tracking-wide transition ${
              active === id
                ? 'border border-neon/40 bg-neon/10 text-neon-200'
                : 'border border-transparent text-neon-600 hover:bg-neon/5 hover:text-neon-400'
            }`}
          >
            <Icon size={15} />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </nav>

      {active === 'streaks' && <DailyStreakScreen />}
      {active === 'mystery' && <MysteryDiscoveryScreen />}
      {active === 'briefings' && <BriefingsScreen />}
      {active === 'expeditions' && <ExpeditionsScreen />}
    </>
  );
}

function FeatureHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: typeof Target;
}) {
  return (
    <div className="panel space-y-3 border border-neon/25 bg-gradient-to-br from-neon/10 via-black/50 to-cyan-500/5 p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-neon/30 bg-neon/10 text-neon-300">
          <Icon size={18} />
        </span>
        <div>
          <p className="label">{eyebrow}</p>
          <h2 className="title mt-1">{title}</h2>
        </div>
      </div>
      <p className="font-mono text-[10px] leading-relaxed text-neon-500">{description}</p>
    </div>
  );
}

function ServiceNotice({ title }: { title: string }) {
  return (
    <div className="panel flex items-start gap-3 border border-amber-400/25 bg-amber-400/5 p-3">
      <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-300" />
      <div>
        <p className="font-mono text-[10px] font-bold uppercase text-amber-200">{title}</p>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-neon-600">
          This experience is being prepared. It will become active only after its trusted service and reward rules are connected. Nothing here can currently issue or change ZP.
        </p>
      </div>
    </div>
  );
}

function DailyStreakScreen() {
  const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  return (
    <section className="space-y-3">
      <FeatureHeader
        eyebrow="Retention protocol"
        title="Daily Streaks"
        description="Build a consistent activity streak, track your milestones and view eligible rewards once the trusted streak service is live."
        icon={CalendarDays}
      />
      <div className="panel space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div><p className="label">Current streak</p><p className="mt-1 font-display text-3xl text-neon-200">— <span className="text-xs text-neon-600">days</span></p></div>
          <div className="text-right"><p className="label">Best streak</p><p className="mt-1 font-display text-xl text-cyan-200">—</p></div>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {days.map((day) => (
            <div key={day} className="rounded-lg border border-neon/15 bg-black/30 px-1 py-3 text-center">
              <p className="font-mono text-[8px] text-neon-600">{day}</p>
              <div className="mx-auto mt-2 flex h-7 w-7 items-center justify-center rounded-full border border-neon/20 text-neon-700"><Clock3 size={12} /></div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-neon/10 pt-3 font-mono text-[9px] text-neon-600">
          <span>Activity calendar</span><span>Awaiting trusted sync</span>
        </div>
      </div>
      <div className="panel space-y-3 p-4">
        <div className="flex items-center justify-between"><p className="label">Streak milestones</p><Sparkles size={15} className="text-cyan-300" /></div>
        {['First milestone', 'Consistency milestone', 'Long-run milestone'].map((label) => (
          <div key={label} className="flex items-center gap-3 border-b border-neon/10 pb-3 last:border-0 last:pb-0">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-neon/20 text-neon-700"><CheckCircle2 size={15} /></span>
            <div className="min-w-0 flex-1"><p className="font-mono text-[10px] text-neon-300">{label}</p><p className="mt-1 font-mono text-[8px] text-neon-700">Milestone conditions and rewards pending approval</p></div>
            <span className="font-mono text-[8px] uppercase text-amber-300">Locked</span>
          </div>
        ))}
      </div>
      <ServiceNotice title="Streak tracking is not active yet" />
    </section>
  );
}

function MysteryDiscoveryScreen() {
  return (
    <section className="space-y-3">
      <FeatureHeader
        eyebrow="Discovery protocol"
        title="Mystery Discovery"
        description="A daily discovery experience for uncovering eligible rewards and collectibles. The reward pool and odds will be published before this feature opens."
        icon={Gift}
      />
      <div className="panel relative overflow-hidden border border-violet-400/25 bg-gradient-to-br from-violet-500/10 via-black/50 to-cyan-500/5 p-5 text-center">
        <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-3xl border border-violet-300/30 bg-violet-400/10 text-violet-200 shadow-[0_0_35px_rgba(167,139,250,0.12)]">
          <Gift size={42} strokeWidth={1.3} />
        </div>
        <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.25em] text-violet-300">Unknown signal detected</p>
        <h3 className="mt-2 font-display text-lg font-bold uppercase tracking-wider text-neon-200">Discovery chamber</h3>
        <p className="mx-auto mt-2 max-w-xs font-mono text-[10px] leading-relaxed text-neon-600">Your discovery slot and eligibility will appear here when the server-side schedule is enabled.</p>
        <button type="button" disabled className="mt-5 w-full cursor-not-allowed rounded-lg border border-violet-300/20 bg-violet-300/5 px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-widest text-violet-300/50">
          Discovery offline
        </button>
      </div>
      <div className="panel space-y-2 p-4">
        <p className="label">Possible discovery categories</p>
        <div className="grid grid-cols-2 gap-2">
          {['ZP rewards', 'Core materials', 'Temporary boosts', 'Collectibles'].map((item) => (
            <div key={item} className="border border-neon/15 bg-black/30 p-3 font-mono text-[9px] text-neon-500">{item}</div>
          ))}
        </div>
        <p className="font-mono text-[8px] leading-relaxed text-neon-700">Categories are illustrative only. Final contents, eligibility, quantities and probabilities must be configured and disclosed before activation.</p>
      </div>
      <ServiceNotice title="No discovery can be opened or claimed yet" />
    </section>
  );
}

function BriefingsScreen() {
  return (
    <section className="space-y-3">
      <FeatureHeader
        eyebrow="Operations intelligence"
        title="Intelligence Briefings"
        description="Read official ZORD announcements, mission intelligence, tactical guidance and time-sensitive community assignments."
        icon={Radio}
      />
      <div className="panel space-y-3 p-4">
        <div className="flex items-center justify-between"><p className="label">Latest transmissions</p><span className="rounded-full border border-neon/20 px-2 py-1 font-mono text-[8px] uppercase text-neon-600">Live feed pending</span></div>
        <div className="py-8 text-center">
          <Radio size={26} className="mx-auto text-neon-700" />
          <h3 className="mt-3 font-display text-xs font-bold uppercase tracking-wider text-neon-300">No published briefings</h3>
          <p className="mx-auto mt-2 max-w-xs font-mono text-[9px] leading-relaxed text-neon-700">When operations publishes a briefing, its title, full message, publication time and any linked mission will appear here.</p>
        </div>
      </div>
      <ServiceNotice title="Briefing feed is awaiting its trusted content source" />
    </section>
  );
}

function ExpeditionsScreen() {
  return (
    <section className="space-y-3">
      <FeatureHeader
        eyebrow="Special operations"
        title="Expeditions"
        description="A dedicated space for time-limited objectives, coordinated player activities and verified expedition outcomes."
        icon={Compass}
      />
      <div className="panel space-y-3 p-4">
        <div className="flex items-center justify-between"><p className="label">Available expeditions</p><span className="font-mono text-[8px] uppercase text-neon-700">0 published</span></div>
        <div className="py-8 text-center">
          <Compass size={28} className="mx-auto text-neon-700" />
          <h3 className="mt-3 font-display text-xs font-bold uppercase tracking-wider text-neon-300">No active expeditions</h3>
          <p className="mx-auto mt-2 max-w-xs font-mono text-[9px] leading-relaxed text-neon-700">New expeditions will appear here after they are published by operations. Progress and completion will be verified by the server.</p>
        </div>
      </div>
      <ServiceNotice title="Expedition service is not active yet" />
    </section>
  );
}
