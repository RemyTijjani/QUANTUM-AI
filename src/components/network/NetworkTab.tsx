import { Copy, Share2, Users } from 'lucide-react';
import { KICKBACK_RATE, MILESTONES, SUB_NODE_RATE } from '@/lib/game/config';
import { formatZp, formatRate } from '@/lib/format';
import { buildReferralLink } from '@/lib/referral';
import { openTelegramLink } from '@/lib/telegram';
import type { GameState } from '@/lib/game/state';
import type { GameActions } from '@/hooks/useGame';
import type { Notify } from '@/hooks/useToast';
import MilestonesList from '@/components/network/MilestonesList';

interface NetworkTabProps {
  state: GameState;
  actions: GameActions;
  notify: Notify;
}

const SHARE_TEXT = 'Mine ZP with me in ZORD Autonomous Agent — Total Group Dominion';

export default function NetworkTab({ state, actions, notify }: NetworkTabProps) {
  const link = buildReferralLink(state.referralCode);
  const kickbackWhole = Math.floor(state.kickbackPending);
  const subNodeTotal = state.subNodes.reduce((sum, node) => sum + node.generated, 0);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      notify('Uplink link copied to clipboard');
    } catch {
      notify('Clipboard is blocked here. Select the link and copy it manually.', 'error');
    }
  };

  const shareLink = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(SHARE_TEXT)}`;
    openTelegramLink(url);
  };

  const claimKickback = () => {
    const amount = kickbackWhole;
    actions.claimKickback();
    notify(`Kickback claimed. +${formatZp(amount)} ZP`);
  };

  return (
    <div className="space-y-6 pb-2">
      <section className="panel space-y-4 p-5">
        <div>
          <p className="label">Referral uplink</p>
          <h2 className="title mt-1">Recruit operatives</h2>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-neon-500">
            Earn {Math.round(KICKBACK_RATE * 100)}% of every ZP your sub-nodes generate.
          </p>
        </div>

        <input
          readOnly
          value={link}
          aria-label="Referral link"
          onFocus={(event) => event.currentTarget.select()}
          className="w-full select-text rounded-lg border border-neon/30 bg-black/50 px-3 py-2.5 font-mono text-[11px] text-neon-300 outline-none focus:border-neon/70"
        />

        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={copyLink} className="btn-ghost">
            <Copy size={14} /> Copy
          </button>
          <button type="button" onClick={shareLink} className="btn-cyan">
            <Share2 size={14} /> Share
          </button>
        </div>

        <div className="rounded-lg border border-neon/20 bg-black/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="label">Pending kickback</p>
              <p className="mt-1 font-display text-xl font-bold tabular-nums text-neon-300">
                {formatZp(state.kickbackPending)} <span className="text-xs text-neon-500">ZP</span>
              </p>
            </div>
            <button type="button" onClick={claimKickback} disabled={kickbackWhole < 1} className="btn-primary shrink-0">
              Claim Kickback
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="px-1">
          <p className="label">Network milestones</p>
          <h2 className="title mt-1">Drop rewards</h2>
        </div>
        <MilestonesList
          subNodeCount={state.subNodes.length}
          claimed={state.claimedMilestones}
          onClaim={(threshold) => {
            const reward = MILESTONES.find((m) => m.threshold === threshold)?.reward ?? 0;
            actions.claimMilestone(threshold);
            notify(`Milestone cleared. +${formatZp(reward)} ZP`);
          }}
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between px-1">
          <div>
            <p className="label">Sub-node operatives</p>
            <h2 className="title mt-1 flex items-center gap-2">
              <Users size={16} /> {state.subNodes.length} online
            </h2>
          </div>
          <span className="font-mono text-[11px] tabular-nums text-neon-500">
            {formatRate(SUB_NODE_RATE)} ZP/sec each
          </span>
        </div>

        <div className="panel overflow-hidden">
          {state.subNodes.length === 0 ? (
            <p className="px-5 py-8 text-center font-mono text-xs leading-relaxed text-neon-500">
              No sub-nodes online yet. Share your uplink link to recruit operatives.
            </p>
          ) : (
            <ul className="divide-y divide-neon/10">
              {[...state.subNodes].reverse().map((node) => (
                <li key={node.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-display text-xs font-bold tracking-wide text-neon-300">{node.name}</p>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-neon-600">
                      Joined {new Date(node.joinedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-neon-400">
                    {formatZp(node.generated)} ZP
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-neon/15 px-4 py-3">
            <span className="font-mono text-[10px] uppercase tracking-wider text-neon-500">
              Network total {formatZp(subNodeTotal)} ZP
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
