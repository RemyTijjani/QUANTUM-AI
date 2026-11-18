import { Award, ShieldCheck, User, Wallet } from 'lucide-react';
import { formatZp } from '@/lib/format';
import { tierInfo } from '@/lib/game/state';
import type { ZapAchievements } from '@/lib/economy/zapWallet';
import Modal from '@/components/Modal';

export interface ProfileIdentity {
  firstName: string | null;
  username: string | null;
}

interface ProfileModalProps {
  identity: ProfileIdentity | null;
  verifiedZpBalance: number | null;
  verifiedZpLifetime: number | null;
  zapEarned: number | null;
  zapAchievements: ZapAchievements | null;
  onClose: () => void;
}

export default function ProfileModal({
  identity,
  verifiedZpBalance,
  verifiedZpLifetime,
  zapEarned,
  zapAchievements,
  onClose,
}: ProfileModalProps) {
  const netZap = zapAchievements?.netZap ?? zapEarned;
  const tier = netZap === null ? null : tierInfo(netZap);
  const rankNumber = zapAchievements?.coreRank?.rankNumber ?? tier?.tier ?? null;
  const displayName = identity?.firstName
    ? identity.username
      ? `${identity.firstName} · @${identity.username}`
      : identity.firstName
    : identity?.username
      ? `@${identity.username}`
      : 'Unnamed operative';

  return (
    <Modal title="Operative Profile" onClose={onClose}>
      <div className="space-y-4">
        <section className="rounded-2xl border border-neon/30 bg-gradient-to-br from-neon/15 via-[#07130c] to-black p-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-neon/40 bg-black/50 text-neon-300">
              <User size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <span className="rounded-full border border-neon/30 bg-neon/10 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-neon-300">
                Core rank {rankNumber === null ? '—' : String(rankNumber).padStart(2, '0')}
              </span>
              <h3 className="mt-2 break-words font-display text-lg font-bold leading-tight text-white">{displayName}</h3>
              <p className="mt-1 break-words font-mono text-xs text-neon-300">{tier?.rank ?? 'Rank unavailable'}</p>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Wallet size={16} className="text-neon-400" />
            <div>
              <h3 className="font-display text-xs font-bold uppercase tracking-[0.14em] text-white">Verified economy</h3>
              <p className="mt-0.5 font-mono text-[10px] text-neon-500">Balances recorded by the ZORD server</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <BalanceCard label="Available ZP" value={verifiedZpBalance === null ? 'Unavailable' : formatZp(verifiedZpBalance)} detail="Verified balance" />
            <BalanceCard label="Lifetime ZP" value={verifiedZpLifetime === null ? 'Unavailable' : formatZp(verifiedZpLifetime)} detail="Server-recorded" />
            <BalanceCard label="Net ZAP" value={netZap === null ? 'Unavailable' : formatZp(netZap)} detail="Earned minus spent" />
            <BalanceCard label="Core rank" value={rankNumber === null ? 'Unavailable' : `#${rankNumber}`} detail={tier?.rank ?? 'Server data unavailable'} />
          </div>
        </section>

        <section className="flex items-start gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.04] p-3">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-cyan-200" />
          <p className="font-mono text-[10px] leading-relaxed text-cyan-100/80">
            Your official ZP balance, lifetime earnings, ZAP score, and Core rank come from server-verified records. Local game estimates are not used as wallet balances.
          </p>
        </section>
      </div>
    </Modal>
  );
}

function BalanceCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.025] p-3">
      <div className="flex items-center gap-1.5 text-neon-400">
        <Award size={13} />
        <span className="font-mono text-[9px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-2 break-words font-display text-lg font-bold leading-tight tabular-nums text-white">{value}</p>
      <p className="mt-1 break-words font-mono text-[9px] text-neon-500">{detail}</p>
    </div>
  );
}
