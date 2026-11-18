import { useEffect, useState } from 'react';
import {
  Bot,
  LoaderCircle,
  Shield,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import TemporaryRewardPanel from './TemporaryRewardPanel';
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

function AgentRentalCheckout({ onRefreshVerifiedEconomy }: { onRefreshVerifiedEconomy: () => Promise<void> | void }) {
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
  // Preview keeps rental checkout and payment verification disabled.
  // Enable only after explicit launch approval and a reviewed payment release.
  const rentalBackendActionsEnabled = false;

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
        await onRefreshVerifiedEconomy();
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
    <section className="panel min-w-0 space-y-3 overflow-hidden rounded-xl border border-neon/25 bg-gradient-to-b from-neon/[0.06] to-black/30 p-2.5 sm:p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-bold text-neon-100">Mining agents</h2>
          <p className="mt-0.5 font-mono text-[9px] text-neon-500">30-day rentals · paid in GRAM</p>
        </div>
        <span className="rounded-full border border-amber-300/20 bg-amber-300/[0.04] px-2 py-1 font-mono text-[8px] text-amber-200">Preview · payments locked</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neon/15 bg-black/30 px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Wallet size={14} className="shrink-0 text-cyan-300" />
          <div className="min-w-0">
            <p className="font-mono text-[10px] text-neon-200">{walletAddress ? shortAddress : walletReady ? 'Wallet not connected' : 'Wallet connector loading'}</p>
            <p className="font-mono text-[8px] text-neon-600">{walletAddress ? (isMainnetWallet ? 'TON mainnet' : 'Wrong network') : walletError ? 'Connection needs attention' : 'Optional · connect to test wallet'}</p>
            {walletError && <p role="alert" className="mt-1 break-words font-mono text-[9px] text-amber-300">{walletError}</p>}
          </div>
        </div>
        <button type="button" className="btn-ghost min-h-9 w-full px-3 py-1.5 text-[10px] min-[380px]:w-auto" onClick={() => void connectWallet()}>
          {walletAddress ? 'Change wallet' : walletError ? 'Retry' : walletReady ? 'Connect' : 'Load wallet'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {RENTAL_OPTIONS.map((option) => (
          <article key={option.id} className="flex min-w-0 flex-col gap-2 rounded-lg border border-neon/20 bg-black/35 p-2.5 transition-colors hover:border-neon/35">
            <div className="min-w-0">
              <h3 className="font-display text-xs font-bold leading-tight text-neon-200">{option.id === 'alpha_miner' ? 'Alpha Miner' : 'Overclocked Core'}</h3>
              <p className="mt-1 font-mono text-[9px] text-cyan-200">{option.rate}</p>
            </div>
            <div className="flex items-baseline justify-between gap-1 border-t border-neon/10 pt-2">
              <span className="font-display text-sm font-bold text-neon-100">{option.price}</span>
              <span className="font-mono text-[8px] text-neon-600">30 days</span>
            </div>
            <button
              type="button"
              className="btn-primary mt-auto min-h-9 w-full rounded-lg px-2 py-2 text-[9px]"
              disabled={!rentalBackendActionsEnabled || busy !== null || (intent !== null && Date.parse(intent.expiresAt) > Date.now())}
              onClick={() => void createIntent(option.id)}
            >
              {busy === option.id ? <LoaderCircle size={13} className="animate-spin" /> : null}
              {rentalBackendActionsEnabled ? (intent?.agentType === option.id ? 'Current checkout' : 'Rent agent') : 'Preview locked'}
            </button>
          </article>
        ))}
      </div>

      <div className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.025] p-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="font-display text-xs font-bold text-cyan-200">Active rentals</p>
          <span className="font-mono text-[8px] text-neon-600">Verified by server</span>
        </div>
        {rentalSummaryLoading ? (
          <p className="mt-2 font-mono text-[9px] text-neon-500">Loading…</p>
        ) : rentalSummaryError ? (
          <p className="mt-2 font-mono text-[9px] text-amber-300">Status unavailable. Try again later.</p>
        ) : activeRentals.length === 0 ? (
          <p className="mt-2 font-mono text-[9px] text-neon-600">No active rentals</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {activeRentals.map((rental) => (
              <div key={rental.agentType + rental.startsAt} className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-black/25 px-2 py-1.5">
                <div className="min-w-0">
                  <p className="font-display text-[10px] font-bold text-neon-200">{rental.agentType === 'alpha_miner' ? 'Alpha Miner' : 'Overclocked Core'}</p>
                  <p className="font-mono text-[8px] text-cyan-200">{rental.ratePerSecond} ZP/s</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-[8px] uppercase text-green-300">Active</p>
                  <p className="font-mono text-[8px] text-neon-600">Until {new Date(rental.expiresAt).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {intent && (
        <div className="space-y-2 rounded-lg border border-cyan-400/25 bg-cyan-400/[0.04] p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-[10px] font-bold uppercase text-cyan-300">Checkout details</p>
            <span className="font-mono text-[8px] uppercase text-amber-300">{transactionSubmitted ? 'Submitted · verifying' : 'Awaiting wallet'}</span>
          </div>
          <p className="font-display text-lg text-cyan-200">{(Number(intent.amountNano) / 1_000_000_000).toFixed(3).replace(/\.?0+$/, '')} GRAM</p>
          <p className="break-all font-mono text-[9px] text-neon-500">Reference: {intent.paymentReference}</p>
          <p className="font-mono text-[8px] text-neon-600">Expires {new Date(intent.expiresAt).toLocaleString()}</p>
          <button type="button" className="btn-cyan min-h-9 w-full text-[10px]" disabled={!paymentsEnabled || !walletAddress || !isMainnetWallet || busy !== null || sendAttempted} onClick={() => void sendPayment()}>
            {paymentsEnabled ? 'Approve in wallet' : 'GRAM transfer locked in Preview'}
          </button>
          {sendAttempted && !transactionSubmitted && <p className="font-mono text-[9px] text-amber-300">Check wallet activity before retrying.</p>}
          <button type="button" className="btn-ghost min-h-9 w-full text-[10px]" disabled={!rentalBackendActionsEnabled || busy !== null} onClick={() => void verifyIntent()}>
            {rentalBackendActionsEnabled ? 'Verify payment' : 'Verification locked in Preview'}
          </button>
          {activeUntil && <p className="font-mono text-[9px] text-green-300">Active until {new Date(activeUntil).toLocaleString()}</p>}
        </div>
      )}

      {notice && <p role="status" className={'font-mono text-[9px] leading-relaxed ' + (noticeKind === 'error' ? 'text-red-300' : noticeKind === 'success' ? 'text-green-300' : 'text-amber-300')}>{notice}</p>}
    </section>
  );
}

export default function ZordAgentsTab({ onRefreshVerifiedEconomy }: { onRefreshVerifiedEconomy: () => Promise<void> | void }) {
  const tiers = [
    { name: 'Sentinel', tier: 'Tier 1', icon: ShieldCheck, summary: 'Core moderation', features: ['Spam and threat detection', 'Community safety rules'] },
    { name: 'Poly-Shield', tier: 'Tier 2', icon: Shield, summary: 'Advanced protection', features: ['Sentinel features', 'Multi-layer community defense'] },
    { name: 'Omini Glitch', tier: 'Tier 3', icon: Sparkles, summary: 'Protection + content tools', features: ['Sentinel and Poly-Shield features', 'AI content and meme creation'] },
  ];

  return (
    <div className="min-w-0 space-y-3 pb-4">
      <header className="flex items-center justify-between gap-2 border-b border-neon/15 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <Bot size={17} className="shrink-0 text-neon-300" />
          <h1 className="font-display text-base font-bold tracking-wide text-neon-100">Agents</h1>
        </div>
        <span className="rounded-full border border-green-400/25 px-2 py-1 font-mono text-[8px] uppercase text-green-300">Agent hub</span>
      </header>

      <TemporaryRewardPanel />
      <AgentRentalCheckout onRefreshVerifiedEconomy={onRefreshVerifiedEconomy} />

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-bold text-neon-100">Community services</h2>
          <span className="font-mono text-[8px] text-neon-600">Coming soon</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {tiers.map(({ name, tier, icon: Icon, summary, features }) => (
            <article key={name} className="flex min-w-0 items-center gap-2 rounded-lg border border-neon/20 bg-black/30 p-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neon/20 bg-neon/5">
                <Icon size={15} className="text-neon-300" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h3 className="font-display text-[10px] font-bold uppercase text-neon-200">{name}</h3>
                  <span className="font-mono text-[8px] text-cyan-300">{tier}</span>
                </div>
                <p className="font-mono text-[8px] text-neon-500">{summary}</p>
                <details className="mt-1">
                  <summary className="cursor-pointer font-mono text-[8px] text-cyan-300">Features</summary>
                  <ul className="mt-1 space-y-1">
                    {features.map((feature) => <li key={feature} className="font-mono text-[8px] leading-relaxed text-neon-400">• {feature}</li>)}
                  </ul>
                </details>
              </div>
              <span className="shrink-0 rounded-full border border-amber-300/15 px-1.5 py-1 font-mono text-[7px] text-amber-200">Soon</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
