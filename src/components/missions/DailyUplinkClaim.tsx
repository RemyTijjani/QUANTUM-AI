import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatZp } from '@/lib/format';
import type { Notify } from '@/hooks/useToast';

interface ClaimResult {
  success?: boolean;
  alreadyClaimed?: boolean;
  rewardZp?: number;
  claimDate?: string;
}

export default function DailyUplinkClaim({
  notify,
  onClaimed,
}: {
  notify: Notify;
  onClaimed: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [claimed, setClaimed] = useState<ClaimResult | null>(null);

  const claim = async () => {
    if (loading || claimed) return;
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('gameplay-actions', {
      body: { action: 'claim_daily_uplink' },
    });
    setLoading(false);

    if (error) {
      notify('Daily Uplink could not be claimed. Please try again.', 'error');
      return;
    }

    const result = data as ClaimResult | null;
    if (!result || result.success !== true || typeof result.rewardZp !== 'number') {
      notify('The trusted service returned an invalid claim response.', 'error');
      return;
    }

    setClaimed(result);
    try {
      await onClaimed();
    } catch {
      // The claim is already committed; balance refresh can retry on focus.
    }

    notify(
      result.alreadyClaimed
        ? 'Daily Uplink was already claimed today.'
        : `Daily Uplink claimed: +${formatZp(result.rewardZp)} verified ZP.`,
      result.alreadyClaimed ? 'info' : 'success',
    );
  };

  return (
    <div className="mt-3">
      {claimed ? (
        <div className="flex items-center gap-2 rounded-lg border border-sky-400/30 bg-sky-400/5 px-3 py-2 font-mono text-[10px] text-sky-200">
          <Check size={13} />
          <span>
            {claimed.alreadyClaimed ? 'Already claimed today' : 'Claim recorded'}
            {claimed.claimDate ? ` · ${claimed.claimDate} UTC` : ''}
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void claim()}
          disabled={loading}
          className="btn-primary inline-flex items-center justify-center gap-2 px-4 py-2 text-[10px] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading && <Loader2 size={13} className="animate-spin" />}
          {loading ? 'Verifying claim...' : 'Claim Daily Uplink'}
        </button>
      )}
      <p className="mt-2 font-mono text-[9px] text-sky-300/80">
        Server-verified reward · one claim per UTC day
      </p>
    </div>
  );
}
