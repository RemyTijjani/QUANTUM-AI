import { useEffect, useState } from 'react';
import {
  Bot,
  Cpu,
  LoaderCircle,
  Shield,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { AGENTS, AGENT_IDS } from '@/lib/game/config';
import type { AgentId } from '@/lib/game/config';
import { activeAgents } from '@/lib/game/state';
import type { GameState } from '@/lib/game/state';
import TemporaryRewardPanel from './TemporaryRewardPanel';
import { formatRate, formatRemaining } from '@/lib/format';
import {
  encodeTonCommentPayload,
  getTonConnectUI,
  loadTonConnectUI,
} from '@/lib/ton-connect';
import type { TonConnectWallet } from '@/lib/ton-connect';

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

interface ActiveAgentRental {
  agentType: AgentRentalType;
  startsAt: string;
  expiresAt: string;
  ratePerSecond: number;
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
  const [busy, setBusy] = useState<'alpha_miner' | 'overclocked_core' | 'send' | 'verify' | null>(null);
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState<'info' | 'success' | 'error'>('info');
  const [activeUntil, setActiveUntil] = useState<string | null>(null);
  const [activeRentals, setActiveRentals] = useState<ActiveAgentRental[]>([]);
  const [rentalSummaryLoading, setRentalSummaryLoading] = useState(true);
  const [rentalSummaryError, setRentalSummaryError] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletNetwork, setWalletNetwork] = useState<string | null>(null);
  const [walletReady, setWalletReady] = useState(false);
  const [walletError, setWalletError] = useState('');
  const [sendAttempted, setSendAttempted] = useState(false);
  const [transactionSubmitted, setTransactionSubmitted] = useState(false);

  // Hard safety lock: Preview must never initiate a real TON transfer.
  // Do not replace this with an environment flag; enabling payments requires
  // separate explicit approval and a reviewed release process.
  const paymentsEnabled = false;
  // Preview backend checkout creation and read-only-until-confirmed payment
  // verification are enabled. Confirmed on-chain payments activate rentals.
  // Real wallet transfers remain locked until separately approved.
  const rentalBackendActionsEnabled = true;

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    const initializeWallet = async () => {
      try {
        const ui = await loadTonConnectUI();
        if (!mounted) return;
        const syncWallet = (wallet: TonConnectWallet | null) => {
          if (!mounted) return;
          setWalletAddress(wallet?.account.address ?? null);
          setWalletNetwork(wallet?.account.chain ?? null);
        };

        syncWallet(ui.wallet);
        unsubscribe = ui.onStatusChange(syncWallet);
        setWalletReady(true);
        setWalletError('');
      } catch (error) {
        if (!mounted) return;
        setWalletReady(false);
        setWalletError(error instanceof Error ? error.message : 'TON Connect could not be initialized.');
      }
    };

    void initializeWallet();
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadActiveRentals = async () => {
      setRentalSummaryLoading(true);
      setRentalSummaryError(false);
      try {
        const { data, error } = await supabase.functions.invoke('player-economy', {
          method: 'GET',
        });
        if (error || !data?.success) {
          throw new Error(data?.error || error?.message || 'Could not load verified rental status.');
        }
        if (mounted) {
          setActiveRentals(Array.isArray(data.activeAgentRentals) ? data.activeAgentRentals : []);
        }
      } catch {
        if (mounted) setRentalSummaryError(true);
      } finally {
        if (mounted) setRentalSummaryLoading(false);
      }
    };

    void loadActiveRentals();
    return () => { mounted = false; };
  }, [activeUntil]);

  const connectWallet = async () => {
    try {
      const ui = await loadTonConnectUI();
      setWalletReady(true);
      setWalletError('');
      await ui.openModal();
    } catch (error) {
      setWalletReady(false);
      setWalletError(error instanceof Error ? error.message : 'Could not open the TON wallet selector.');
    }
  };

  const createIntent = async (agentType: AgentRentalType) => {
    if (!rentalBackendActionsEnabled) {
      setNotice('Rental checkout creation is disabled during Preview safety testing. Wallet connection can still be tested.');
      setNoticeKind('info');
      return;
    }
    setBusy(agentType);
    setNotice('');
    setActiveUntil(null);
    setSendAttempted(false);
    setTransactionSubmitted(false);
    try {
      const { data, error } = await supabase.functions.invoke('agent-rental-payments', {
        body: { action: 'create_intent', agentType },
      });
      if (error) throw new Error(error.message || 'Could not create a payment request.');
      if (!data?.success || !data?.intent?.id) {
        throw new Error(data?.error || 'The payment service returned an incomplete request.');
      }
      setIntent(data.intent as PaymentIntent);
      setNotice('Checkout created. Connect your TON wallet to continue. No funds have been sent.');
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
    if (!rentalBackendActionsEnabled) {
      setNotice('Payment verification is disabled during Preview safety testing because it can update rental records.');
      setNoticeKind('info');
      return;
    }
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

  const sendPayment = async () => {
    if (!intent) return;

    if (!paymentsEnabled) {
      setNotice('Real TON transfers are disabled during Preview testing. Wallet connection can be tested safely without sending funds.');
      setNoticeKind('info');
      return;
    }

    try {
      const ui = getTonConnectUI();
      const wallet = ui.wallet;
      if (!wallet) throw new Error('Connect your TON wallet before continuing.');
      if (wallet.account.chain !== '-239' || intent.network !== 'mainnet') {
        throw new Error('This checkout accepts TON mainnet wallets only. Switch your wallet to TON mainnet.');
      }

      const now = Math.floor(Date.now() / 1000);
      const expiry = Math.floor(new Date(intent.expiresAt).getTime() / 1000);
      const validUntil = Math.min(now + 300, expiry);
      if (!Number.isFinite(validUntil) || validUntil <= now) {
        throw new Error('This payment request has expired. Create a new checkout.');
      }

      setBusy('send');
      setSendAttempted(true);
      setNotice('Confirm the exact amount and recipient in your wallet.');
      setNoticeKind('info');

      const response = await ui.sendTransaction({
        validUntil,
        network: '-239',
        messages: [{
          address: intent.recipientAddress,
          amount: intent.amountNano,
          payload: encodeTonCommentPayload(intent.paymentReference),
        }],
      });

      if (!response?.boc) {
        throw new Error('The wallet did not return a transaction confirmation. Check wallet activity before retrying.');
      }

      setTransactionSubmitted(true);
      setNotice('Wallet returned a transaction response. Checking TON mainnet for confirmation...');
      setNoticeKind('info');
      setBusy(null);
      await verifyIntent();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The wallet transaction was not confirmed. Check wallet activity before retrying.');
      setNoticeKind('error');
    } finally {
      setBusy((current) => current === 'send' ? null : current);
    }
  };

  const shortAddress = walletAddress
    ? walletAddress.slice(0, 6) + '…' + walletAddress.slice(-6)
    : null;
  const isMainnetWallet = walletNetwork === '-239';

  return (
    <section className="panel min-w-0 space-y-5 overflow-hidden rounded-2xl border border-neon/25 bg-gradient-to-b from-neon/[0.06] to-black/30 p-3 min-[380px]:p-4 sm:p-5">
      <div className="space-y-2">
        <p className="label">Native coin · TON mainnet</p>
        <h2 className="title">Rent a mining agent</h2>
        <p className="max-w-xl text-[11px] leading-relaxed text-neon-500">
          ZORD displays the native TON coin as GRAM. Both rentals run for 30 days.
          Working agents generate ZP only.
        </p>
      </div>

      <div className="rounded-xl border border-neon/20 bg-black/35 p-4">
        <div className="flex min-w-0 items-center gap-2">
          <Wallet size={15} className="shrink-0 text-cyan-300" />
          <p className="label">TON wallet</p>
        </div>
        <div className="mt-2 flex flex-col gap-3 min-[380px]:flex-row min-[380px]:items-center min-[380px]:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-[11px] text-neon-300">
              {walletAddress ? shortAddress : walletReady ? 'Wallet not connected' : 'Loading wallet connector…'}
            </p>
            <p className="mt-1 font-mono text-[9px] text-neon-600">
              {walletAddress ? (isMainnetWallet ? 'Connected · TON mainnet' : 'Connected · wrong network') : walletError ? 'Wallet connector needs attention' : 'Connect to prepare a secure checkout'}
            </p>
            {walletError && <p role="alert" className="mt-1 break-words font-mono text-[9px] text-amber-300">{walletError}</p>}
          </div>
          <button
            type="button"
            className="btn-ghost min-h-11 w-full shrink-0 min-[380px]:w-auto"
            onClick={() => void connectWallet()}
          >
            {walletAddress ? 'Change wallet' : walletError ? 'Retry connector' : walletReady ? 'Connect wallet' : 'Load wallet connector'}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.04] p-3">
        <p className="font-mono text-[10px] leading-relaxed text-amber-200">
          Preview checkout mode: you can create a payment request and ask the server to verify a TON mainnet payment. Confirmed payments activate the rental. The page will not initiate a real GRAM transfer until that separate safety lock is approved.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {RENTAL_OPTIONS.map((option) => (
          <article key={option.id} className="flex h-full min-w-0 flex-col rounded-xl border border-neon/20 bg-black/35 p-3 min-[380px]:p-4 transition-colors hover:border-neon/35">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-sm font-bold leading-snug text-neon-200">{option.title}</h3>
                <p className="mt-2 text-[11px] leading-relaxed text-neon-500">{option.description}</p>
              </div>
              <span className="shrink-0 rounded-lg border border-cyan-300/20 bg-cyan-300/5 px-2.5 py-1.5 font-display text-sm font-bold text-cyan-200">{option.price}</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-neon/10 pt-3 font-mono text-[10px] text-neon-400">
              <span>{option.rate}</span>
              <span>30 days</span>
            </div>
            <button
              type="button"
              className="btn-primary mt-auto min-h-11 w-full rounded-lg py-3"
              disabled={!rentalBackendActionsEnabled || busy !== null || (intent !== null && Date.parse(intent.expiresAt) > Date.now())}
              onClick={() => void createIntent(option.id)}
            >
              {busy === option.id ? <LoaderCircle size={14} className="animate-spin" /> : null}
              {rentalBackendActionsEnabled ? (intent?.agentType === option.id ? 'Current checkout' : 'Create checkout') : 'Checkout disabled in Preview'}
            </button>
          </article>
        ))}
      </div>

      <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.035] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="label">Verified rental mining</p>
            <p className="mt-1 font-display text-sm font-bold text-cyan-200">Trusted ZP accrual</p>
          </div>
          <span className="rounded-full border border-cyan-300/20 px-2 py-1 font-mono text-[9px] uppercase text-cyan-200">
            Server tracked
          </span>
        </div>
        <p className="mt-2 font-mono text-[9px] leading-relaxed text-neon-500">
          Confirmed rentals add ZP to your verified balance while active. Accrual stops at the exact rental expiry, and each credited period is protected against duplicate processing.
        </p>
        {rentalSummaryLoading ? (
          <p className="mt-3 font-mono text-[10px] text-neon-500">Checking your rental status…</p>
        ) : rentalSummaryError ? (
          <p className="mt-3 font-mono text-[10px] text-amber-300">Verified rental status is temporarily unavailable. Your balance has not been changed by this display.</p>
        ) : activeRentals.length === 0 ? (
          <p className="mt-3 font-mono text-[10px] text-neon-500">No confirmed mining rental is currently active.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {activeRentals.map((rental) => (
              <div key={rental.agentType + rental.startsAt} className="flex min-w-0 flex-col gap-3 rounded-lg border border-neon/15 bg-black/25 p-3 min-[380px]:flex-row min-[380px]:items-center min-[380px]:justify-between">
                <div className="min-w-0">
                  <p className="font-display text-xs font-bold text-neon-200">
                    {rental.agentType === 'alpha_miner' ? 'Alpha Miner' : 'Overclocked Core'}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-cyan-200">{rental.ratePerSecond} ZP / second</p>
                </div>
                <div className="min-w-0 break-words text-left min-[380px]:shrink-0 min-[380px]:text-right">
                  <p className="font-mono text-[9px] uppercase text-green-300">Active</p>
                  <p className="mt-1 font-mono text-[9px] text-neon-500">Until {new Date(rental.expiresAt).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {intent && (
        <div className="space-y-4 rounded-xl border border-cyan-400/25 bg-cyan-400/[0.04] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-xs font-bold uppercase text-cyan-300">Wallet checkout ready</p>
            <span className="font-mono text-[9px] uppercase text-amber-300">
              {transactionSubmitted ? 'Submitted · verifying' : 'Awaiting wallet'}
            </span>
          </div>
          <div>
            <p className="label">Exact amount</p>
            <p className="mt-1 font-display text-xl text-cyan-200">
              {(Number(intent.amountNano) / 1_000_000_000).toFixed(3).replace(/\.?0+$/, '')} GRAM
            </p>
            <p className="font-mono text-[9px] text-neon-600">TON mainnet · native coin · not a jetton</p>
          </div>
          <div>
            <p className="label">Payment reference</p>
            <p className="mt-1 break-all font-mono text-[10px] text-cyan-200">{intent.paymentReference}</p>
            <p className="mt-1 font-mono text-[9px] text-neon-600">
              This reference is attached automatically as the TON transaction comment.
            </p>
          </div>
          <p className="font-mono text-[9px] leading-relaxed text-neon-600">
            Request expires: {new Date(intent.expiresAt).toLocaleString()}
          </p>
          <button
            type="button"
            className="btn-cyan min-h-11 w-full"
            disabled={!paymentsEnabled || !walletAddress || !isMainnetWallet || busy !== null || sendAttempted}
            onClick={() => void sendPayment()}
          >
            {busy === 'send' ? <LoaderCircle size={14} className="animate-spin" /> : null}
            {paymentsEnabled ? 'Approve payment in TON wallet' : 'Real GRAM transfer locked in Preview'}
          </button>
          {!paymentsEnabled && (
            <p className="font-mono text-[9px] leading-relaxed text-amber-300">
              Your checkout and server-side verification are active in Preview. This final wallet-send step is still locked, so this page cannot move real GRAM yet.
            </p>
          )}
          {sendAttempted && !transactionSubmitted && (
            <p className="font-mono text-[9px] leading-relaxed text-amber-300">
              A wallet request was attempted. Check wallet activity and payment status before creating another checkout; do not retry blindly.
            </p>
          )}
          <button
            type="button"
            className="btn-ghost min-h-11 w-full"
            disabled={!rentalBackendActionsEnabled || busy !== null}
            onClick={() => void verifyIntent()}
          >
            {busy === 'verify' ? <LoaderCircle size={14} className="animate-spin" /> : null}
            {rentalBackendActionsEnabled ? 'Check mainnet payment' : 'Payment verification disabled in Preview'}
          </button>
          {activeUntil && (
            <p className="font-mono text-[10px] text-green-300">
              Rental recorded until {new Date(activeUntil).toLocaleString()}.
            </p>
          )}
        </div>
      )}

      {notice && (
        <p role="status" className={'font-mono text-[10px] leading-relaxed ' + (noticeKind === 'error' ? 'text-red-300' : noticeKind === 'success' ? 'text-green-300' : 'text-amber-300')}>
          {notice}
        </p>
      )}
      <p className="font-mono text-[9px] leading-relaxed text-amber-300">
        A wallet connection never activates a rental. The server independently verifies the TON mainnet transaction and its unique comment. Only confirmed rentals earn ZP, and accrual stops at expiry.
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
    { name: 'Poly-Shield', tier: 'Tier 2', icon: Shield, summary: 'Expanded multi-layer protection for Telegram communities.', features: ['All Sentinel capabilities', 'Advanced community defense', 'Expanded moderation controls'] },
    { name: 'Omini Glitch', tier: 'Tier 3', icon: Sparkles, summary: 'Full community intelligence and creative operations.', features: ['All Sentinel and Poly-Shield capabilities', 'AI content creation for Telegram groups and channels', 'Meme creation for community engagement'] },
  ];

  return (
    <div className="min-w-0 space-y-6 pb-5">
      <header className="panel relative min-w-0 overflow-hidden rounded-2xl border border-neon/30 bg-gradient-to-br from-neon/[0.10] via-black/30 to-cyan-400/[0.04] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-neon-400"><Bot size={18} /><span className="label">ZORD autonomous services</span></div>
          <span className="rounded-full border border-green-400/25 bg-green-400/[0.06] px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider text-green-300">Agent hub</span>
        </div>
        <h1 className="mt-3 font-display text-2xl font-bold tracking-wide text-neon-100">ZORD Agents</h1>
        <p className="mt-2 max-w-xl text-xs leading-relaxed text-neon-400">Explore mining agents and community protection services in one place. Compare what each service offers before choosing your next step.</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-neon/15 bg-black/25 p-3"><p className="font-mono text-[9px] uppercase tracking-wider text-neon-600">Your active miners</p><p className="mt-1 font-display text-lg font-semibold text-neon-200">{running.length}</p></div>
          <div className="rounded-xl border border-neon/15 bg-black/25 p-3"><p className="font-mono text-[9px] uppercase tracking-wider text-neon-600">Current displayed rate</p><p className="mt-1 font-display text-lg font-semibold text-neon-200">{formatRate(miningRate)} <span className="text-[10px]">ZP/s</span></p></div>
        </div>
      </header>

      <TemporaryRewardPanel />

      <AgentRentalCheckout />

      <section className="panel space-y-4 rounded-2xl border border-neon/20 bg-gradient-to-b from-neon/[0.04] to-black/20 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0"><p className="label">Mining operations</p><h2 className="title mt-1">ZP agent activity</h2></div>
          <Cpu size={18} className="shrink-0 text-neon-400" />
        </div>
        <div className="grid grid-cols-2 gap-2 min-[380px]:gap-3">
          <div className="rounded-xl border border-neon/20 bg-black/35 p-3"><p className="label">Active miners</p><p className="mt-1 font-display text-xl text-neon-300">{running.length}</p></div>
          <div className="rounded-xl border border-neon/20 bg-black/40 p-3"><p className="label">Displayed rate</p><p className="mt-1 font-display text-xl text-neon-300">{formatRate(miningRate)} <span className="text-[10px]">ZP/s</span></p></div>
        </div>
        <div className="space-y-2">
          {AGENT_IDS.map((id: AgentId) => {
            const agent = AGENTS[id];
            const endsAt = Math.max(state.agents[id], id === 'alpha' ? state.temporaryAgentUntil : 0);
            const isActive = endsAt > now;
            return <article key={id} className="flex flex-col gap-3 rounded-xl border border-neon/15 bg-black/30 p-3.5 min-[380px]:flex-row min-[380px]:items-start min-[380px]:justify-between">
              <div className="min-w-0"><p className="font-display text-xs font-bold text-neon-300">{agent.name}</p><p className="mt-1 font-mono text-[10px] leading-relaxed text-neon-600">{agent.summary}</p><p className="mt-2 font-mono text-[10px] text-cyan-300">{formatRate(agent.zpPerSec)} ZP/sec while active</p></div>
              <span className={'shrink-0 border px-2 py-1 font-mono text-[9px] uppercase ' + (isActive ? 'border-green-500/40 text-green-300' : 'border-neon/20 text-neon-600')}>{isActive ? formatRemaining(endsAt - now) : 'Inactive'}</span>
            </article>;
          })}
        </div>
        <p className="font-mono text-[9px] leading-relaxed text-amber-300">The activity figures above are legacy game-state estimates, not a withdrawable balance. Paid GRAM rentals are shown separately in the verified rental panel and credited through the trusted ZP ledger.</p>
      </section>

      <section className="space-y-4">
        <div className="min-w-0 space-y-2"><p className="label">Community protection</p><h2 className="title">Choose a service tier</h2><p className="text-xs leading-relaxed text-neon-500">Compare the protection levels below. Telegram bot provisioning is not available yet.</p></div>
        {tiers.map(({ name, tier, icon: Icon, summary, features }) => <article key={name} className="panel min-w-0 space-y-4 rounded-2xl border border-neon/20 bg-gradient-to-br from-black/35 to-neon/[0.035] p-3 min-[380px]:p-4 sm:p-5 transition-colors hover:border-neon/35">
          <div className="flex items-center justify-between gap-3"><span className="rounded-md border border-cyan-300/20 bg-cyan-300/5 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-cyan-200">{tier}</span><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-neon/20 bg-neon/5"><Icon size={18} className="text-neon-300" /></span></div>
          <div><h3 className="font-display text-base font-bold uppercase tracking-wider text-neon-200">{name}</h3><p className="mt-1 text-[11px] leading-relaxed text-neon-500">{summary}</p></div>
          <ul className="space-y-2">{features.map(feature => <li key={feature} className="flex items-start gap-2 text-[11px] leading-relaxed text-neon-400"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-neon-400" />{feature}</li>)}</ul>
          <div className="flex min-w-0 items-start gap-2 rounded-lg border border-amber-300/15 bg-amber-300/[0.04] px-3 py-2"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" /><span className="min-w-0 font-mono text-[9px] leading-relaxed text-amber-200">Coming soon · Telegram bot provisioning is not active yet</span></div>
        </article>)}
      </section>
    </div>
  );
}
