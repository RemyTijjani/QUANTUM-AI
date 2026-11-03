import { Check } from 'lucide-react';
import FaIcon from '@/components/FaIcon';
import { FRAGMENT_IDS, FRAGMENT_IQ_PER_SEC, FRAGMENT_NAMES } from '@/lib/game/config';
import { formatCooldown } from '@/lib/format';
import type { FragmentId } from '@/lib/game/config';
import type { FragmentStatus } from '@/lib/game/state';
import { FRAGMENT_ICON, STATUS_LABEL } from '@/components/core/fragmentVisuals';

const BAY_STYLE: Record<FragmentStatus, string> = {
  locked: 'border-dashed border-neon/35 bg-black/60 text-neon-500 hover:border-neon/60 hover:text-neon-400',
  unlocked: 'border-cyan-400/70 bg-cyan-400/10 text-cyan-300 shadow-[0_0_14px_rgba(34,211,238,0.25)] hover:bg-cyan-400/20',
  fixed: 'border-yellow-500 bg-yellow-500/10 text-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.4)] hover:bg-yellow-500/20',
};

interface FragmentBaysProps {
  fragments: Record<FragmentId, FragmentStatus>;
  cooldowns: Record<FragmentId, number>;
  now: number;
  onFragmentPress: (id: FragmentId) => void;
}

export default function FragmentBays({ fragments, cooldowns, now, onFragmentPress }: FragmentBaysProps) {
  return (
    <section className="space-y-3">
      <div className="px-1">
        <p className="label">Fragment bays</p>
        <h2 className="title mt-1">Missing pieces</h2>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {FRAGMENT_IDS.map((id) => (
          <FragmentBay
            key={id}
            id={id}
            status={fragments[id]}
            cooldownRemaining={Math.max(0, cooldowns[id] - now)}
            onPress={() => onFragmentPress(id)}
          />
        ))}
      </div>
    </section>
  );
}

function FragmentBay({
  id,
  status,
  cooldownRemaining,
  onPress,
}: {
  id: FragmentId;
  status: FragmentStatus;
  cooldownRemaining: number;
  onPress: () => void;
}) {
  const cooldownActive = cooldownRemaining > 0;
  const label = cooldownActive ? formatCooldown(cooldownRemaining) : STATUS_LABEL[status];

  return (
    <button
      type="button"
      onClick={onPress}
      disabled={cooldownActive}
      aria-label={`${FRAGMENT_NAMES[id]}: ${label}`}
      className={`relative flex min-h-[112px] flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center transition duration-500 active:scale-95 ${BAY_STYLE[status]} ${
        status === 'unlocked' && !cooldownActive ? 'animate-soft-pulse' : ''
      } ${cooldownActive ? 'cursor-not-allowed opacity-80' : ''}`}
    >
      {status === 'fixed' && <Check size={14} className="absolute right-2 top-2" />}
      <FaIcon name={FRAGMENT_ICON[id]} size={22} />
      <span className="font-display text-[10px] font-bold uppercase leading-tight tracking-wider">
        {FRAGMENT_NAMES[id]}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-wider opacity-90">{label}</span>
      {status === 'fixed' && (
        <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-yellow-500/90">
          +{FRAGMENT_IQ_PER_SEC.toFixed(2)} IQ/sec
        </span>
      )}
    </button>
  );
}
