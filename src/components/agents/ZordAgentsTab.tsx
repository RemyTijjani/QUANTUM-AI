import { useEffect, useState } from 'react';
import {
  Bot,
  Cpu,
  LoaderCircle,
  Pickaxe,
  Shield,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import TemporaryRewardPanel from './TemporaryRewardPanel';
import { encodeTonCommentPayload, loadTonConnectUI } from '@/lib/ton-connect';
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
  const [pendingIntents, setPendingIntents] = useState<PaymentIntent[]>([]);
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
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [diagnosticResult, setDiagnosticResult] = useState<{
    success: boolean;
    diagnostics?: {
      tonCenterKeyConfigured?: boolean;
      treasuryAddressConfigured?: boolean;
      treasuryAddressValid?: boolean;
      tonCenterReachable?: boolean;
      tonCenterAuthorized?: boolean;
      tonCenterHttpStatus?: number;
      tonCenterResponseValid?: boolean;
      latencyMs?: number;
    };
    error?: string;
  } | null>(null);
 
  const restorePendingIntent = async () => {
    const { data, error } = await supabase.functions.invoke('agent-rental-payments', {
      body: { action: 'list_pending_intents' },
    });
    if (error || !data?.success) {
      throw new Error(data?.error || error?.message || 'Could not restore an existing payment request.');
    }
    const intents = Array.isArray(data.intents) ? data.intents as PaymentIntent[] : [];
    setPendingIntents(intents);
    setIntent(intents[0] ?? null);
  };

  useEffect(() => {
    let mounted = true;
    void supabase.functions.invoke('agent-rental-payments', {
      body: { action: 'list_pending_intents' },
    }).then(({ data, error }) => {
      if (!mounted) return;
      if (error || !data?.success) {
        setNotice(data?.error || error?.message || 'Existing payment requests could not be restored.');
        setNoticeKind('error');
        return;
      }
      const intents = Array.isArray(data.intents) ? data.intents as PaymentIntent[] : [];
      setPendingIntents(intents);
      if (intents.length > 0) {
        setIntent(intents[0]);
        setNotice('An existing rental payment request was restored. You can verify it against TON mainnet; sending a new payment remains disabled.');
        setNoticeKind('info');
      }
    }).catch((error) => {
      if (!mounted) return;
      setNotice(error instanceof Error ? error.message : 'Existing payment requests could not be restored.');
      setNoticeKind('error');
    });
    return () => { mounted = false; };
  }, []);

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

  const runGramDiagnostic = async () => {
    setDiagnosticBusy(true);
    setDiagnosticResult(null);
    setNotice('');
    try {
      const { data, error } = await supabase.functions.invoke('agent-rental-payments', {
        body: { action: 'diagnostics' },
      });
      if (error) throw new Error(error.message || 'The diagnostic request failed.');
      if (!data?.diagnostics) throw new Error(data?.error || 'The diagnostic returned an incomplete response.');
      setDiagnosticResult(data);
      setNotice(data.success
        ? 'TON Center connection and treasury configuration passed the read-only check.'
        : (data.error || 'The read-only connection check did not pass.'));
      setNoticeKind(data.success ? 'success' : 'error');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not run the GRAM connection check.');
      setNoticeKind('error');
    } finally {
      setDiagnosticBusy(false);
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
    try {
      const { data, error } = await supabase.functions.invoke('agent-rental-payments', {
        body: { action: 'create_intent', agentType },
      });
      if (error) throw new Error(error.message || 'Could not create a payment request.');
      if (!data?.success || !data?.intent?.id) {
        throw new Error(data?.error || 'The payment service returned an incomplete request.');
      }
      const createdIntent = data.intent as PaymentIntent;
      setIntent(createdIntent);
      setPendingIntents((current) => [createdIntent, ...current.filter((item) => item.id !== createdIntent.id)]);
      setNotice('Mainnet checkout created. Review the amount and destination, then approve the transfer in your TON wallet.');
      setNoticeKind('success');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not create a payment request.');
      setNoticeKind('error');
    } finally {
      setBusy(null);
    }
  };

  const sendPayment = async (targetIntent: PaymentIntent) => {
    if (!walletAddress || !isMainnetWallet) {
      setNotice('Connect a TON Mainnet wallet before sending this GRAM payment.');
      setNoticeKind('error');
      return;
    }
    if (Date.parse(targetIntent.expiresAt) <= Date.now()) {
      setNotice('This payment request has expired. Create a new checkout before sending funds.');
      setNoticeKind('error');
      return;
    }

    setBusy('send');
    setNotice('');
    try {
      const ui = await loadTonConnectUI();
      if (!ui.account || ui.account.chain !== '-239' || ui.account.address !== walletAddress) {
        throw new Error('Your connected wallet changed or is not on TON Mainnet. Reconnect and try again.');
      }
      const expirySeconds = Math.floor(Date.parse(targetIntent.expiresAt) / 1000);
      const validUntil = Math.min(expirySeconds, Math.floor(Date.now() / 1000) + 300);
      if (!Number.isFinite(validUntil) || validUntil <= Math.floor(Date.now() / 1000)) {
        throw new Error('This payment request has expired. Create a new checkout.');
      }
      const result = await ui.sendTransaction({
        validUntil,
        network: '-239',
        messages: [{
          address: targetIntent.recipientAddress,
          amount: targetIntent.amountNano,
          payload: encodeTonCommentPayload(targetIntent.paymentReference),
        }],
      });
      if (!result?.boc) throw new Error('The wallet did not return a submitted transaction.');
      setNotice('Wallet submitted the transaction. Wait for TON Mainnet confirmation, then select Verify payment. Your rental activates only after server-side verification.');
      setNoticeKind('info');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The GRAM transfer could not be submitted.');
      setNoticeKind('error');
    } finally {
      setBusy(null);
    }
  };

  const verifyIntent = async (targetIntent: PaymentIntent | null = intent) => {
    if (!targetIntent) return;
    setBusy('verify');
    setNotice('');
    try {
      const { data, error } = await supabase.functions.invoke('agent-rental-payments', {
        body: { action: 'verify_payment', intentId: targetIntent.id },
      });
      if (error) throw new Error(error.message || 'Payment verification could not be completed.');
      if (data?.pending) {
        setNotice(data.message || 'No matching mainnet payment has been indexed yet.');
        setNoticeKind('info');
      } else if (data?.success) {
        setActiveUntil(typeof data.expiresAt === 'string' ? data.expiresAt : null);
        setNotice(data.alreadyPaid ? 'This rental payment was already confirmed.' : 'Payment confirmed and rental recorded.');
        setNoticeKind('success');
        try {
          await onRefreshVerifiedEconomy();
        } catch {
          setNotice('Payment confirmed and rental recorded. Your balance display could not refresh yet; reopen the Agents tab shortly.');
          setNoticeKind('info');
        }
        try {
          await restorePendingIntent();
        } catch {
          // The confirmed payment remains recorded even if the pending-list refresh fails.
        }
      } else {
        throw new Error(data?.error || 'The payment has not been confirmed.');
      }
    } catch (error) {
      try {
        await restorePendingIntent();
      } catch {
        // Preserve the original verification error.
      }
      setNotice(error instanceof Error ? error.message : 'Payment verification failed.');
      setNoticeKind('error');
    } finally {
      setBusy(null);
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
        <span className="rounded-full border border-emerald-300/20 bg-emerald-300/[0.04] px-2 py-1 font-mono text-[8px] text-emerald-200">TON Mainnet · GRAM</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neon/15 bg-black/30 px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Wallet size={14} className="shrink-0 text-cyan-300" />
          <div className="min-w-0">
            <p className="font-mono text-[10px] text-neon-200">{walletAddress ? shortAddress : walletReady ? 'Wallet not connected' : 'Wallet connector loading'}</p>
            <p className="font-mono text-[8px] text-neon-600">{walletAddress ? (isMainnetWallet ? 'TON mainnet' : 'Wrong network') : walletError ? 'Connection needs attention' : 'Connect a TON Mainnet wallet to pay'}</p>
            {walletError && <p role="alert" className="mt-1 break-words font-mono text-[9px] text-amber-300">{walletError}</p>}
          </div>
        </div>
        <button type="button" className="btn-ghost min-h-9 w-full px-3 py-1.5 text-[10px] min-[380px]:w-auto" onClick={() => void connectWallet()}>
          {walletAddress ? 'Change wallet' : walletError ? 'Retry' : walletReady ? 'Connect' : 'Load wallet'}
        </button>
      </div>

      <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/[0.035] p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-display text-[10px] font-bold text-cyan-200">GRAM connection test</p>
            <p className="mt-0.5 font-mono text-[8px] text-neon-600">Read-only · no payment or wallet approval</p>
          </div>
          <button
            type="button"
            className="btn-ghost min-h-9 px-3 py-1.5 text-[9px]"
            disabled={diagnosticBusy}
            onClick={() => void runGramDiagnostic()}
          >
            {diagnosticBusy ? <LoaderCircle size={12} className="animate-spin" /> : null}
            {diagnosticBusy ? 'Testing…' : 'Test GRAM connection'}
          </button>
        </div>
        {diagnosticResult?.diagnostics && (
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {[
              ['API key configured', diagnosticResult.diagnostics.tonCenterKeyConfigured],
              ['Treasury configured', diagnosticResult.diagnostics.treasuryAddressConfigured],
              ['Treasury address valid', diagnosticResult.diagnostics.treasuryAddressValid],
              ['TON Center reachable', diagnosticResult.diagnostics.tonCenterReachable],
              ['API key accepted', diagnosticResult.diagnostics.tonCenterAuthorized],
              ['Transaction response valid', diagnosticResult.diagnostics.tonCenterResponseValid],
            ].map(([label, passed]) => (
              <div key={String(label)} className="flex min-w-0 items-center justify-between gap-1 rounded bg-black/25 px-2 py-1">
                <span className="font-mono text-[8px] text-neon-500">{label}</span>
                <span className={'shrink-0 font-mono text-[8px] ' + (passed ? 'text-green-300' : 'text-amber-300')}>{passed ? 'PASS' : 'CHECK'}</span>
              </div>
            ))}
            {typeof diagnosticResult.diagnostics.tonCenterHttpStatus === 'number' && (
              <p className="col-span-2 font-mono text-[8px] text-neon-600">
                HTTP {diagnosticResult.diagnostics.tonCenterHttpStatus}
                {typeof diagnosticResult.diagnostics.latencyMs === 'number' ? ` · ${diagnosticResult.diagnostics.latencyMs} ms` : ''}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {RENTAL_OPTIONS.map((option) => (
          <article key={option.id} className="flex min-w-0 flex-col gap-2 rounded-lg border border-neon/20 bg-black/35 p-2.5 transition-colors hover:border-neon/35">
            <div className="flex min-w-0 items-center gap-2">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${option.id === 'alpha_miner' ? 'border-cyan-300/25 bg-cyan-300/[0.07]' : 'border-violet-300/25 bg-violet-300/[0.07]'}`}>
                {option.id === 'alpha_miner'
                  ? <Pickaxe size={19} strokeWidth={1.8} className="text-cyan-300" />
                  : <Cpu size={19} strokeWidth={1.8} className="text-violet-300" />}
              </span>
              <div className="min-w-0">
                <h3 className="font-display text-xs font-bold leading-tight text-neon-200">{option.id === 'alpha_miner' ? 'Alpha Miner' : 'Overclocked Core'}</h3>
                <p className="mt-1 font-mono text-[9px] text-cyan-200">{option.rate}</p>
              </div>
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
                <div className="flex min-w-0 items-center gap-2">
                  {rental.agentType === 'alpha_miner'
                    ? <Pickaxe size={15} className="shrink-0 text-cyan-300" />
                    : <Cpu size={15} className="shrink-0 text-violet-300" />}
                  <div className="min-w-0">
                    <p className="font-display text-[10px] font-bold text-neon-200">{rental.agentType === 'alpha_miner' ? 'Alpha Miner' : 'Overclocked Core'}</p>
                    <p className="font-mono text-[8px] text-cyan-200">{rental.ratePerSecond} ZP/s</p>
                  </div>
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

      {pendingIntents.map((pendingIntent) => (
        <div key={pendingIntent.id} className="space-y-2 rounded-lg border border-cyan-400/25 bg-cyan-400/[0.04] p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-[10px] font-bold uppercase text-cyan-300">GRAM checkout · {pendingIntent.agentType === 'alpha_miner' ? 'Alpha Miner' : 'Overclocked Core'}</p>
            <span className="font-mono text-[8px] uppercase text-emerald-300">TON Mainnet</span>
          </div>
          <p className="font-display text-lg text-cyan-200">{(Number(pendingIntent.amountNano) / 1_000_000_000).toFixed(3).replace(/\.?0+$/, '')} GRAM</p>
          <p className="break-all font-mono text-[9px] text-neon-500">Destination: {pendingIntent.recipientAddress}</p>
          <p className="break-all font-mono text-[9px] text-neon-500">Payment reference: {pendingIntent.paymentReference}</p>
          <p className="font-mono text-[8px] text-neon-600">Request expires {new Date(pendingIntent.expiresAt).toLocaleString()}</p>
          <button type="button" className="btn-primary min-h-9 w-full text-[10px]" disabled={busy !== null || !walletAddress || !isMainnetWallet || Date.parse(pendingIntent.expiresAt) <= Date.now()} onClick={() => void sendPayment(pendingIntent)}>
            {busy === 'send' ? <LoaderCircle size={13} className="animate-spin" /> : `Pay ${ (Number(pendingIntent.amountNano) / 1_000_000_000).toFixed(3).replace(/\.?0+$/, '') } GRAM with TON wallet`}
          </button>
          <button type="button" className="btn-ghost min-h-9 w-full text-[10px]" disabled={busy !== null} onClick={() => void verifyIntent(pendingIntent)}>
            {busy === 'verify' ? <LoaderCircle size={13} className="animate-spin" /> : 'Verify Mainnet payment'}
          </button>
          <p className="font-mono text-[8px] leading-relaxed text-neon-700">Only a matching, confirmed TON Mainnet transaction activates the 30-day rental.</p>
        </div>
      ))}

      {activeUntil && (
        <p className="rounded-lg border border-green-300/20 bg-green-300/5 p-2 font-mono text-[9px] text-green-300">
          Rental confirmed until {new Date(activeUntil).toLocaleString()}
        </p>
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
