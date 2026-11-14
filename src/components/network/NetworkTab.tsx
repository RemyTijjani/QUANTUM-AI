import { Copy, Share2, Users } from 'lucide-react';
import { formatZp } from '@/lib/format';
import { buildReferralLink } from '@/lib/referral';
import { openTelegramLink } from '@/lib/telegram';
import type { GameState } from '@/lib/game/state';
import type { Notify } from '@/hooks/useToast';
import MilestonesList from '@/components/network/MilestonesList';

interface NetworkTabProps {
  state: GameState;
  notify: Notify;
}

const SHARE_TEXT = 'Mine ZP with me in ZORD Autonomous Agent — Total Group Dominion';

export default function NetworkTab({ state, notify }: NetworkTabProps) {
  const link = buildReferralLink(state.referralCode);
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

  return (
    <div className="space-y-6 pb-2">
      <section className="panel space-y-4 p-5">
        <div>
          <p className="label">Referral uplink</p>
          <h2 className="title mt-1">Recruit operatives</h2>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-neon-500">
            Share your referral link to invite new operatives. Referral rewards are awaiting trusted backend integration.
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

        <div className="rounded-lg border border-amber-400/25 bg-amber-400/5 p-4">
          <p className="label text-amber-300">Referral rewards</p>
          <p className="mt-1 font-mono text-[10px] leading-relaxed text-neon-400">
            Kickbacks are not yet connected to the verified economy. No ZP is claimable from this screen.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <div className="px-1">
          <p className="label">Network milestones</p>
          <h2 className="title mt-1">Milestone progress</h2>
        </div>
        <MilestonesList subNodeCount={state.subNodes.length} />
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between px-1">
          <div>
            <p className="label">Sub-node operatives</p>
            <h2 className="title mt-1 flex items-center gap-2">
              <Users size={16} /> {state.subNodes.length} online
            </h2>
          </div>
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
                    {formatZp(node.generated)} ZP estimate
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-neon/15 px-4 py-3">
            <span className="font-mono text-[10px] uppercase tracking-wider text-neon-500">
              Local activity estimate {formatZp(subNodeTotal)} ZP
            </span>
          </div>
          <p className="border-t border-amber-400/20 px-4 py-3 font-mono text-[9px] leading-relaxed text-amber-300">Referral counts and generated amounts shown here are legacy local estimates, not verified rewards.</p>
        </div>
      </section>
    </div>
  );
}
