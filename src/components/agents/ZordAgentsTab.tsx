import { Activity, Bot, Cpu, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { AGENTS, AGENT_IDS } from '@/lib/game/config';
import type { AgentId } from '@/lib/game/config';
import { activeAgents } from '@/lib/game/state';
import type { GameState } from '@/lib/game/state';
import { formatRate, formatRemaining } from '@/lib/format';

export default function ZordAgentsTab({ state }: { state: GameState }) {
  const now = Date.now();
  const running = activeAgents(state, now);
  const miningRate = running.reduce((sum, id) => sum + AGENTS[id].zpPerSec, 0);
  const tiers = [
    { name: 'Sentinel', tier: 'Tier 1', icon: ShieldCheck, summary: 'AI moderation and community protection.', features: ['Threat and spam monitoring', 'Community safety workflows', 'Configurable moderation rules'] },
    { name: 'Poly-Shield', tier: 'Tier 2', icon: Users, summary: 'Expanded multi-layer protection for Telegram communities.', features: ['All Sentinel capabilities', 'Advanced community defense', 'Expanded moderation controls'] },
    { name: 'Omini Glitch', tier: 'Tier 3', icon: Sparkles, summary: 'Full community intelligence and creative operations.', features: ['All Sentinel and Poly-Shield capabilities', 'AI content creation for Telegram groups and channels', 'Meme creation for community engagement'] },
  ];

  return (
    <div className="space-y-5 pb-3">
      <header className="panel space-y-2 border border-neon/30 bg-neon/5 p-4">
        <div className="flex items-center gap-2 text-neon-400"><Bot size={18} /><span className="label">ZORD autonomous services</span></div>
        <h1 className="title">ZORD Agents</h1>
        <p className="font-mono text-[11px] leading-relaxed text-neon-500">Community agents and mining operations share the ZORD platform. Each rented service tier will have isolated community settings and permissions.</p>
      </header>

      <section className="panel space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div><p className="label">Mining operations</p><h2 className="title mt-1">ZP agent activity</h2></div>
          <Activity size={18} className="text-neon-400" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="border border-neon/20 bg-black/40 p-3"><p className="label">Active miners</p><p className="mt-1 font-display text-xl text-neon-300">{running.length}</p></div>
          <div className="border border-neon/20 bg-black/40 p-3"><p className="label">Displayed rate</p><p className="mt-1 font-display text-xl text-neon-300">{formatRate(miningRate)} <span className="text-[10px]">ZP/s</span></p></div>
        </div>
        <div className="space-y-2">
          {AGENT_IDS.map((id: AgentId) => {
            const agent = AGENTS[id];
            const endsAt = state.agents[id];
            const isActive = endsAt > now;
            return <article key={id} className="flex items-start justify-between gap-3 border border-neon/15 bg-black/30 p-3">
              <div className="min-w-0"><p className="font-display text-xs font-bold text-neon-300">{agent.name}</p><p className="mt-1 font-mono text-[10px] leading-relaxed text-neon-600">{agent.summary}</p><p className="mt-2 font-mono text-[10px] text-cyan-300">{formatRate(agent.zpPerSec)} ZP/sec while active</p></div>
              <span className={`shrink-0 border px-2 py-1 font-mono text-[9px] uppercase ${isActive ? 'border-green-500/40 text-green-300' : 'border-neon/20 text-neon-600'}`}>{isActive ? formatRemaining(endsAt - now) : 'Inactive'}</span>
            </article>;
          })}
        </div>
        <p className="font-mono text-[9px] leading-relaxed text-amber-300">Mining figures shown here are legacy game-state estimates, not a verified payout or withdrawable balance. Agent rentals and real payments are not enabled yet. Working agents generate ZP only.</p>
      </section>

      <section className="space-y-3">
        <div><p className="label">Community protection tiers</p><h2 className="title mt-1">Rent a ZORD service</h2></div>
        {tiers.map(({ name, tier, icon: Icon, summary, features }) => <article key={name} className="panel space-y-3 border border-neon/25 p-4">
          <div className="flex items-center justify-between"><span className="font-mono text-[9px] uppercase tracking-widest text-cyan-300">{tier}</span><Icon size={19} className="text-neon-400" /></div>
          <div><h3 className="font-display text-base font-bold uppercase tracking-wider text-neon-300">{name}</h3><p className="mt-1 font-mono text-[10px] text-neon-500">{summary}</p></div>
          <ul className="space-y-1">{features.map(feature => <li key={feature} className="font-mono text-[10px] text-neon-400">• {feature}</li>)}</ul>
          <div className="border-t border-neon/15 pt-2 font-mono text-[9px] uppercase tracking-wider text-amber-300">Rental checkout and Telegram bot provisioning pending</div>
        </article>)}
      </section>
    </div>
  );
}
