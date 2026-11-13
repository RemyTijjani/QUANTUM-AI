import { useState } from 'react';
import {
  Activity,
  Bot,
  Check,
  Copy,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { AGENTS, AGENT_IDS } from '@/lib/game/config';
import type { AgentId } from '@/lib/game/config';
import { activeAgents } from '@/lib/game/state';
import type { GameState } from '@/lib/game/state';
import { formatRate, formatRemaining } from '@/lib/format';

type AgentRentalType = 'alpha_miner' | 'overclocked_core';

interface PaymentIntent {
  id: string;
  agentType: AgentRentalType;
  amountNano: string;
  currency: 'GRAM';
  network: 'mainnet';
  recipientAddress: string;
  paymentReference: string;
  expiresAt: string;
}

const RENTAL_OPTIONS: {
  id: AgentRentalType;
  title: string;
  description: string;
  price: string;
  rate: string;
}[] = [
  {
    id: 'alpha_miner',
    title: 'ZORD Alpha Miner Agent',
    description: 'Autonomous mining agent for steady ZP generation.',
    price: '1.5 GRAM',
    rate: '0.1 ZP / second',
  },
  {
    id: 'overclocked_core',
    title: 'ZORD Overclocked Core Agent',
    description: 'High-performance mining agent with an increased ZP rate.',
    price: '4.5 GRAM',
    rate: '0.3 ZP / second',
  },
];

function AgentRentalCheckout() {
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [busy, setBusy] = useState<'alpha_miner' | 'overclocked_core' | 'verify' | null>(null);
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState<'info' | 'success' | 'error'>('info');
  const [copied, setCopied] = useState<'address' | 'reference' | null>(null);
  const [activeUntil, setActiveUntil] = useState<string | null>(null);

  const createIntent = async (agentType: AgentRentalType) => {
    setBusy(agentType);
    setNotice('');
    setActiveUntil(null);
    try {
      const { data, error } = await supabase.functions.invoke('agent-rental-payments', {
        body: { action: 'create_intent', agentType },
      });
      if (error) throw new Error(error.message || 'Could not create a payment request.');
      if (!data?.success || !data?.intent?.id) {
        throw new Error(data?.error || 'The payment service returned an incomplete request.');
      }
      setIntent(data.intent as PaymentIntent);
      setNotice('Payment request created. No wallet transaction has been sent.');
      setNoticeKind('success');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not create a payment request.');
      setNoticeKind('error');
    } finally {
      setBusy(null);
    }
  };

  const verifyIntent = async () => {
    if (!intent) return;
    setBusy('verify');
    setNotice('');
    try {
      const { data, error } = await supabase.functions.invoke('agent-rental-payments', {
        body: { action: 'verify_payment', intentId: intent.id },
      });
      if (error) throw new Error(error.message || 'Payment verification could not be completed.');
      if (data?.pending) {
        setNotice(data.message || 'No matching mainnet payment has been indexed yet.');
        setNoticeKind('info');
      } else if (data?.success) {
        setActiveUntil(typeof data.expiresAt === 'string' ? data.expiresAt : null);
        setNotice(data.alreadyPaid ? 'This rental payment was already confirmed.' : 'Payment confirmed and rental recorded.');
        setNoticeKind('success');
      } else {
        throw new Error(data?.error || 'The payment has not been confirmed.');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Payment verification failed.');
      setNoticeKind('error');
    } finally {
      setBusy(null);
    }
  };

  const copyValue = async (kind: 'address' | 'reference', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied((current) => current === kind ? null : current), 1800);
    } catch {
      setNotice('Clipboard access is unavailable in this Telegram session.');
      setNoticeKind('error');
    }
  };

  return (
    <section className="panel space-y-4 border border-cyan-400/25 p-4">
      <div>
        <p className="label">Native coin · TON mainnet</p>
        <h2 className="title mt-1">Rent a mining agent</h2>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-neon-500">
          ZORD displays the native TON coin as GRAM. Both rentals run for 30 days.
          Working agents generate ZP only.
        </p>
      </div>

      <div className="grid gap-3">
        {RENTAL_OPTIONS.map((option) => (
          <article key={option.id} className="border border-neon/20 bg-black/30 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-xs font-bold text-neon-300">{option.title}</h3>
                <p className="mt-1 font-mono text-[10px] text-neon-600">{option.description}</p>
              </div>
              <span className="shrink-0 font-display text-sm font-bold text-cyan-300">{option.price}</span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 font-mono text-[10px] text-neon-400">
              <span>{option.rate}</span>
              <span>30 days</span>
            </div>
            <button
              type="button"
              className="btn-primary mt-3 w-full"
              disabled={busy !== null}
              onClick={() => void createIntent(option.id)}
            >
              {busy === option.id ? <LoaderCircle size={14} className="animate-spin" /> : null}
              Create payment request
            </button>
          </article>
        ))}
      </div>

      {intent && (
        <div className="space-y-3 border border-cyan-400/30 bg-cyan-400/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-display text-xs font-bold uppercase text-cyan-300">Payment request ready</p>
            <span className="font-mono text-[9px] uppercase text-amber-300">Pending</span>
          </div>
          <div>
            <p className="label">Exact amount</p>
            <p className="mt-1 font-display text-xl text-cyan-200">
              {intent.agentType === 'alpha_miner' ? '1.5' : '4.5'} GRAM
            </p>
            <p className="font-mono text-[9px] text-neon-600">TON mainnet · native coin · not a jetton</p>
          </div>
          <div>
            <p className="label">Treasury address</p>
            <p className="mt-1 break-all font-mono text-[10px] text-neon-300">{intent.recipientAddress}</p>
            <button type="button" className="btn-ghost mt-2 w-full" onClick={() => void copyValue('address', intent.recipientAddress)}>
              {copied === 'address' ? <Check size={13} /> : <Copy size={13} />}
              {copied === 'address' ? 'Address copied' : 'Copy address'}
            </button>
          </div>
          <div>
            <p className="label">Required payment comment / reference</p>
            <p className="mt-1 break-all font-mono text-[10px] text-cyan-200">{intent.paymentReference}</p>
            <button type="button" className="btn-ghost mt-2 w-full" onClick={() => void copyValue('reference', intent.paymentReference)}>
              {copied === 'reference' ? <Check size={13} /> : <Copy size={13} />}
              {copied === 'reference' ? 'Reference copied' : 'Copy reference'}
            </button>
          </div>
          <p className="font-mono text-[9px] leading-relaxed text-neon-600">
            Request expires: {new Date(intent.expiresAt).toLocaleString()}
          </p>
          <button type="button" className="btn-cyan w-full" disabled={busy !== null} onClick={() => void verifyIntent()}>
            {busy === 'verify' ? <LoaderCircle size={14} className="animate-spin" /> : null}
            Check mainnet payment
          </button>
          {activeUntil && (
            <p className="font-mono text-[10px] text-green-300">
              Rental recorded until {new Date(activeUntil).toLocaleString()}.
            </p>
          )}
        </div>
      )}

      {notice && (
        <p role="status" className={`font-mono text-[10px] leading-relaxed ${noticeKind === 'error' ? 'text-red-300' : noticeKind === 'success' ? 'text-green-300' : 'text-amber-300'}`}>
          {notice}
        </p>
      )}
      <p className="font-mono text-[9px] leading-relaxed text-amber-300">
        Creating a request does not send funds. Do not make a real transfer during this integration test.
        Wallet connection and verified ZP mining activation are separate steps.
      </p>
    </section>
  );
}

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

      <AgentRentalCheckout />

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
        <p className="font-mono text-[9px] leading-relaxed text-amber-300">Mining figures shown here are legacy game-state estimates, not a verified payout or withdrawable balance. Confirmed rentals are not yet connected to trusted ZP accrual. Working agents generate ZP only.</p>
      </section>

      <section className="space-y-3">
        <div><p className="label">Community protection tiers</p><h2 className="title mt-1">Rent a ZORD service</h2></div>
        {tiers.map(({ name, tier, icon: Icon, summary, features }) => <article key={name} className="panel space-y-3 border border-neon/25 p-4">
          <div className="flex items-center justify-between"><span className="font-mono text-[9px] uppercase tracking-widest text-cyan-300">{tier}</span><Icon size={19} className="text-neon-400" /></div>
          <div><h3 className="font-display text-base font-bold uppercase tracking-wider text-neon-300">{name}</h3><p className="mt-1 font-mono text-[10px] text-neon-500">{summary}</p></div>
          <ul className="space-y-1">{features.map(feature => <li key={feature} className="font-mono text-[10px] text-neon-400">• {feature}</li>)}</ul>
          <div className="border-t border-neon/15 pt-2 font-mono text-[9px] uppercase tracking-wider text-amber-300">Telegram bot provisioning pending</div>
        </article>)}
      </section>
    </div>
  );
}
