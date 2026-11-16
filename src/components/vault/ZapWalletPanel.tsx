import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, CheckCircle2, Coins, Copy, RefreshCw, Send, Wallet } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { buildReferralLink } from '@/lib/referral';
import { formatZp } from '@/lib/format';
import {
  convertZpToZap,
  fetchZapWallet,
  lookupZapTransferRecipient,
  transferZap,
  type ZapTransferRecipient,
  type ZapWallet,
} from '@/lib/economy/zapWallet';

export default function ZapWalletPanel({
  verifiedZpBalance,
  onConversionComplete,
}: {
  verifiedZpBalance: number | null;
  onConversionComplete: () => Promise<void> | void;
}) {
  const [wallet, setWallet] = useState<ZapWallet | null>(null);
  const [amountZp, setAmountZp] = useState('1000');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [pendingAmount, setPendingAmount] = useState<string | null>(null);
  const { auth } = useAuth();
  const player = auth.status === 'authenticated' ? auth.player : null;
  const [recipientIdentifier, setRecipientIdentifier] = useState('');
  const [transferAmount, setTransferAmount] = useState('100');
  const [recipientPreview, setRecipientPreview] = useState<ZapTransferRecipient | null>(null);
  const [lookingUpRecipient, setLookingUpRecipient] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferSuccess, setTransferSuccess] = useState<string | null>(null);
  const [transferRequestKey, setTransferRequestKey] = useState<string | null>(null);
  const [transferRequestSignature, setTransferRequestSignature] = useState<string | null>(null);
  const [copiedReceiveCode, setCopiedReceiveCode] = useState(false);
  const [confirmingTransfer, setConfirmingTransfer] = useState(false);

  const maxConvertibleZp = verifiedZpBalance === null || !Number.isFinite(verifiedZpBalance)
    ? 0
    : Math.floor(verifiedZpBalance / 1000) * 1000;
  const parsedAmount = /^\d+$/.test(amountZp) ? Number(amountZp) : 0;
  const validAmount = Number.isSafeInteger(parsedAmount) &&
    parsedAmount >= 1000 &&
    parsedAmount % 1000 === 0 &&
    parsedAmount <= maxConvertibleZp;

  const loadWallet = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const nextWallet = await fetchZapWallet();
      setWallet(nextWallet);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load your ZAP wallet.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  const zapEquivalent = useMemo(
    () => validAmount ? parsedAmount / 1000 : 0,
    [parsedAmount, validAmount],
  );

  const handleLookupRecipient = async () => {
    const identifier = recipientIdentifier.trim();
    if (identifier.length < 3 || identifier.length > 80 || lookingUpRecipient || transferring) return;
    setLookingUpRecipient(true);
    setTransferError(null);
    setTransferSuccess(null);
    setRecipientPreview(null);
    setConfirmingTransfer(false);
    setTransferRequestKey(null);
    setTransferRequestSignature(null);
    try {
      const recipient = await lookupZapTransferRecipient(identifier);
      setRecipientPreview(recipient);
    } catch (lookupError) {
      setTransferError(lookupError instanceof Error ? lookupError.message : 'Could not find that player.');
    } finally {
      setLookingUpRecipient(false);
    }
  };

  const handleTransfer = async () => {
    const identifier = recipientIdentifier.trim();
    if (!recipientPreview || !/^[1-9][0-9]{0,19}$/.test(transferAmount) || BigInt(transferAmount) < 100n || transferring) return;
    if (BigInt(transferAmount) > BigInt(wallet?.balance ?? '0')) {
      setTransferError('You do not have enough ZAP for this transfer.');
      return;
    }
    setTransferring(true);
    setTransferError(null);
    setTransferSuccess(null);
    const signature = `${identifier.toLowerCase()}:${transferAmount}`;
    const key = transferRequestSignature === signature && transferRequestKey
      ? transferRequestKey
      : crypto.randomUUID();
    setTransferRequestKey(key);
    setTransferRequestSignature(signature);
    try {
      const result = await transferZap(identifier, transferAmount, key);
      setWallet(result.wallet);
      setTransferSuccess(`Sent ${formatZp(result.transfer.amount)} ZAP to ${result.recipient.displayName}.`);
      setRecipientIdentifier('');
      setTransferAmount('100');
      setConfirmingTransfer(false);
      setRecipientPreview(null);
      setTransferRequestKey(null);
      setTransferRequestSignature(null);
    } catch (sendError) {
      setTransferError(sendError instanceof Error ? sendError.message : 'The transfer could not be completed.');
      await loadWallet();
    } finally {
      setTransferring(false);
    }
  };

  const handleCopyReceiveCode = async () => {
    if (!player?.referralCode) return;
    try {
      await navigator.clipboard.writeText(player.referralCode);
      setCopiedReceiveCode(true);
      window.setTimeout(() => setCopiedReceiveCode(false), 1800);
    } catch {
      setTransferError('Could not copy the code. Please copy it manually.');
    }
  };

  const handleCopyInviteLink = async () => {
    if (!player?.referralCode) return;
    try {
      await navigator.clipboard.writeText(buildReferralLink(player.referralCode));
      setCopiedReceiveCode(true);
      window.setTimeout(() => setCopiedReceiveCode(false), 1800);
      setTransferError(null);
    } catch {
      setTransferError('Could not copy the invite link. Please copy your referral code instead.');
    }
  };

  const handleConvert = async () => {
    if (!validAmount || submitting) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    const key = pendingKey && pendingAmount === amountZp
      ? pendingKey
      : crypto.randomUUID();
    setPendingKey(key);
    setPendingAmount(amountZp);

    try {
      const result = await convertZpToZap(amountZp, key);
      setWallet(result.wallet);
      const confirmationMessage = `You converted ${formatZp(result.conversion.zpDebited)} ZP into ${result.conversion.zapCredited} ZAP.`;
      setSuccess(confirmationMessage);
      setAmountZp('1000');
      setPendingKey(null);
      setPendingAmount(null);

      // The conversion is already confirmed by the server. A dashboard refresh
      // failure must not be reported as a failed conversion.
      try {
        await onConversionComplete();
      } catch {
        setSuccess(`${confirmationMessage} Your wallet is updated, but the dashboard could not refresh. Please refresh the page.`);
      }
    } catch (conversionError) {
      const message = conversionError instanceof Error ? conversionError.message : 'Conversion could not be completed.';
      await loadWallet();
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
        <div className="rounded-xl border border-neon/20 bg-[#07130d] p-3">
          <div className="flex items-center gap-2 text-neon-500">
            <Coins size={14} />
            <p className="text-[9px] font-semibold uppercase tracking-wider">ZP points</p>
          </div>
          <p className="mt-3 break-all font-display text-xl font-bold text-neon-200">
            {verifiedZpBalance === null ? '—' : formatZp(verifiedZpBalance)}
          </p>
          <p className="mt-1 text-[9px] text-neon-700">Earned in ZORD</p>
        </div>

        <div className="rounded-xl border border-cyan-400/25 bg-[#06131a] p-3">
          <div className="flex items-center justify-between gap-1 text-cyan-300">
            <div className="flex items-center gap-2">
              <Wallet size={14} />
              <p className="text-[9px] font-semibold uppercase tracking-wider">ZAP wallet</p>
            </div>
            <button
              type="button"
              onClick={() => void loadWallet(true)}
              disabled={refreshing || loading}
              className="rounded-md p-1 text-cyan-400 hover:bg-cyan-300/10 disabled:opacity-40"
              aria-label="Refresh ZAP wallet"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
          <p className="mt-3 break-all font-display text-xl font-bold text-cyan-100">
            {loading ? '…' : wallet ? formatZp(wallet.balance) : '—'}
          </p>
          <p className="mt-1 text-[9px] text-cyan-700">{loading ? 'Loading balance' : wallet ? 'Available to use' : 'Balance unavailable'}</p>
        </div>
      </div>

      <div className="panel space-y-4 p-4">
        <div>
          <div className="flex items-center gap-2 text-cyan-300">
            <ArrowDownUp size={17} />
            <h2 className="title">Convert points to ZAP</h2>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-neon-600">
            Turn your earned ZP points into ZAP in a few simple steps.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-cyan-300/20 bg-cyan-300/5 px-3 py-3">
          <span className="text-[10px] text-neon-500">Conversion rate</span>
          <span className="text-xs font-bold text-cyan-200">1,000 ZP = 1 ZAP</span>
        </div>

        <div className="space-y-2">
          <label htmlFor="zp-conversion-amount" className="text-xs font-semibold text-neon-200">
            How many ZP do you want to convert?
          </label>
          <div className="flex gap-2">
            <input
              id="zp-conversion-amount"
              type="number"
              min="1000"
              step="1000"
              inputMode="numeric"
              value={amountZp}
              onChange={(event) => {
                setAmountZp(event.target.value);
                setError(null);
                setSuccess(null);
                if (pendingAmount !== event.target.value) {
                  setPendingKey(null);
                  setPendingAmount(null);
                }
              }}
              disabled={submitting}
              className="min-w-0 flex-1 rounded-lg border border-neon/20 bg-black/30 px-3 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60 disabled:opacity-50"
              aria-describedby="zp-conversion-help"
            />
            <button
              type="button"
              onClick={() => setAmountZp(String(maxConvertibleZp || 1000))}
              disabled={submitting || maxConvertibleZp < 1000}
              className="rounded-lg border border-neon/20 px-4 text-xs font-semibold text-neon-300 transition hover:bg-neon/10 disabled:opacity-40"
            >
              Max
            </button>
          </div>
          <div id="zp-conversion-help" className="flex items-center justify-between gap-2 text-[10px] text-neon-700">
            <span>Available: {verifiedZpBalance === null ? '—' : `${formatZp(verifiedZpBalance)} ZP`}</span>
            <span>Whole ZAP only</span>
          </div>
          <div className="rounded-lg bg-black/20 px-3 py-3">
            <p className="text-[10px] text-neon-600">You will receive</p>
            <p className="mt-1 font-display text-lg font-bold text-cyan-200">
              {validAmount ? `${formatZp(zapEquivalent)} ZAP` : 'Enter an amount'}
            </p>
            {!validAmount && (
              <p className="mt-1 text-[9px] text-neon-700">
                Enter a multiple of 1,000 ZP. You need at least 1,000 ZP to convert.
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleConvert()}
          disabled={!validAmount || submitting || loading || !wallet}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-300 px-4 py-3 text-xs font-bold text-[#041016] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowDownUp size={15} className={submitting ? 'animate-pulse' : ''} />
          {submitting ? 'Converting…' : 'Convert ZP to ZAP'}
        </button>

        {error && (
          <p role="alert" className="rounded-lg border border-red-400/25 bg-red-400/5 p-3 text-[10px] leading-relaxed text-red-300">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/5 p-3 text-[10px] leading-relaxed text-emerald-300">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />{success}
          </p>
        )}
        <p className="text-[9px] leading-relaxed text-neon-700">
          Conversions are processed securely. The minimum conversion is 1,000 ZP, and ZAP is credited to your ZORD wallet.
        </p>
      </div>

      <div className="panel space-y-4 p-4">
        <div>
          <div className="flex items-center gap-2 text-cyan-300">
            <Send size={16} />
            <h2 className="title">Send ZAP</h2>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-neon-700">Send ZAP instantly to another ZORD player using their username or referral code.</p>
        </div>
        <div className="space-y-2">
          <label htmlFor="zap-recipient" className="text-xs font-semibold text-neon-200">Recipient username or referral code</label>
          <div className="flex gap-2">
            <input id="zap-recipient" value={recipientIdentifier} onChange={(event) => { setRecipientIdentifier(event.target.value); setRecipientPreview(null); setConfirmingTransfer(false); setTransferError(null); setTransferSuccess(null); setTransferRequestKey(null); setTransferRequestSignature(null); }} disabled={lookingUpRecipient || transferring} placeholder="@username or ZORD-..." className="min-w-0 flex-1 rounded-lg border border-neon/20 bg-black/30 px-3 py-3 text-xs text-white outline-none focus:border-cyan-300/60 disabled:opacity-50" />
            <button type="button" onClick={() => void handleLookupRecipient()} disabled={recipientIdentifier.trim().length < 3 || lookingUpRecipient || transferring} className="rounded-lg border border-cyan-300/30 px-3 text-[10px] font-semibold text-cyan-200 disabled:opacity-40">{lookingUpRecipient ? 'Checking…' : 'Find'}</button>
          </div>
          {recipientPreview && <p className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-[10px] text-emerald-300">Recipient found: {recipientPreview.displayName}{recipientPreview.username ? ` (@${recipientPreview.username})` : ''}</p>}
        </div>
        <div className="space-y-2">
          <label htmlFor="zap-transfer-amount" className="text-xs font-semibold text-neon-200">Amount to send (whole ZAP)</label>
          <input id="zap-transfer-amount" type="number" min="100" step="1" inputMode="numeric" value={transferAmount} onChange={(event) => { setTransferAmount(event.target.value); setConfirmingTransfer(false); setTransferError(null); setTransferSuccess(null); setTransferRequestKey(null); setTransferRequestSignature(null); }} disabled={transferring} className="w-full rounded-lg border border-neon/20 bg-black/30 px-3 py-3 text-sm text-white outline-none focus:border-cyan-300/60 disabled:opacity-50" />
          <p className="text-[9px] text-neon-700">Minimum: 100 ZAP · Available: {wallet ? `${formatZp(wallet.balance)} ZAP` : '—'}</p>
        </div>
        {!confirmingTransfer ? (
          <button
            type="button"
            onClick={() => setConfirmingTransfer(true)}
            disabled={!recipientPreview || !/^[1-9][0-9]{0,19}$/.test(transferAmount) || BigInt(transferAmount || '0') < 100n || transferring || !wallet}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-300 px-4 py-3 text-xs font-bold text-[#041016] hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send size={14} />Review transfer
          </button>
        ) : (
          <div className="space-y-3 rounded-lg border border-amber-300/30 bg-amber-300/5 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-200">Confirm this transfer</p>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-neon-600">Recipient</span>
              <span className="text-right font-semibold text-white">{recipientPreview?.displayName}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-neon-600">You are sending</span>
              <span className="font-display text-lg font-bold text-cyan-200">{transferAmount} ZAP</span>
            </div>
            <p className="text-[9px] leading-relaxed text-amber-200/80">This transfer cannot be reversed. It will also move net-ZAP ranking and achievement progress to the recipient.</p>
            <button
              type="button"
              onClick={() => void handleTransfer()}
              disabled={transferring}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-300 px-4 py-3 text-xs font-bold text-[#041016] hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={14} />{transferring ? 'Sending…' : 'Confirm and send'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingTransfer(false)}
              disabled={transferring}
              className="w-full rounded-lg border border-neon/20 px-4 py-2 text-xs font-semibold text-neon-300 disabled:opacity-40"
            >
              Go back
            </button>
          </div>
        )}
        {transferError && <p role="alert" className="rounded-lg border border-red-400/25 bg-red-400/5 p-3 text-[10px] text-red-300">{transferError}</p>}
        {transferSuccess && <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/5 p-3 text-[10px] text-emerald-300"><CheckCircle2 size={14} className="shrink-0" />{transferSuccess}</p>}
        <p className="text-[9px] leading-relaxed text-neon-700">Transfers are final. Check the recipient carefully before confirming. Each transfer moves net-ZAP ranking and achievement progress from sender to recipient.</p>
      </div>

      <div className="panel space-y-3 p-4">
        <div className="flex items-center gap-2 text-cyan-300">
          <Wallet size={16} />
          <h2 className="title">Receive ZAP</h2>
        </div>
        <p className="text-[10px] leading-relaxed text-neon-700">Share your referral code with another ZORD player so they can send ZAP to you.</p>
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-neon/15 bg-black/20 p-3">
          <span className="min-w-0 flex-1 break-all font-mono text-xs text-cyan-200">{player?.referralCode ?? 'Your code is loading…'}</span>
          <button type="button" onClick={() => void handleCopyReceiveCode()} disabled={!player?.referralCode} className="flex shrink-0 items-center gap-1 rounded-md border border-cyan-300/25 px-2 py-2 text-[9px] font-semibold text-cyan-200 disabled:opacity-40"><Copy size={12} />{copiedReceiveCode ? 'Copied' : 'Copy code'}</button>
        </div>
        {player?.referralCode && (
          <button type="button" onClick={() => void handleCopyInviteLink()} className="w-full rounded-lg border border-neon/20 px-3 py-2 text-[10px] font-semibold text-neon-300 transition hover:bg-neon/10">
            {copiedReceiveCode ? 'Copied' : 'Copy my ZORD invite link'}
          </button>
        )}
      </div>

      <div className="panel space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="title">ZAP activity</h2>
            <p className="mt-1 text-[10px] text-neon-700">Your latest wallet transactions</p>
          </div>
          <span className="rounded-full border border-neon/15 px-2 py-1 text-[9px] text-neon-600">Latest 5</span>
        </div>
        {!wallet || wallet.transactions.length === 0 ? (
          <div className="rounded-lg border border-neon/10 bg-black/20 px-3 py-6 text-center">
            <HistoryIcon />
            <p className="mt-2 text-xs text-neon-500">No ZAP activity yet</p>
            <p className="mt-1 text-[10px] text-neon-700">Your wallet transactions will show here.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {wallet.transactions.slice(0, 5).map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-neon/10 py-3 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-xs capitalize text-neon-200">{entry.description || entry.source.replace(/_/g, ' ')}</p>
                  <p className="mt-1 text-[9px] text-neon-700">
                    {entry.createdAt && Number.isFinite(Date.parse(entry.createdAt)) ? new Date(entry.createdAt).toLocaleString() : 'Date unavailable'}
                  </p>
                </div>
                <p className={`shrink-0 font-display text-sm font-semibold ${entry.entryType === 'debit' ? 'text-amber-300' : 'text-emerald-300'}`}>
                  {entry.entryType === 'debit' ? '−' : '+'}{formatZp(entry.amount)} <span className="text-[10px]">ZAP</span>
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function HistoryIcon() {
  return <Coins size={20} className="mx-auto text-neon-700" />;
}
