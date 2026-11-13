import { FRAGMENT_IDS, FRAGMENT_NAMES } from '@/lib/game/config';
import type { FragmentId } from '@/lib/game/config';
import { fixedCount, fragmentCooldownRemaining, passiveRate, tierInfo } from '@/lib/game/state';
import type { GameState, FragmentStatus } from '@/lib/game/state';
import { formatRate, formatZp, formatRemaining } from '@/lib/format';
import type { Notify } from '@/hooks/useToast';
import LevelBanner from '@/components/core/LevelBanner';
import CoreCircuit from '@/components/core/CoreCircuit';
import FragmentBays from '@/components/core/FragmentBays';
import CharacterCard from '@/components/core/CharacterCard';

interface CoreTabProps {
  state: GameState;
  notify: Notify;
  onWatchAd: (id: FragmentId) => void;
  onFixFragment: (id: FragmentId) => Promise<void>;
}

export default function CoreTab({ state, notify, onWatchAd, onFixFragment }: CoreTabProps) {
  const now = Date.now();
  const tier = tierInfo(state.lifetimeZp);
  const rate = passiveRate(state, now);
  const miningLeft = state.coreMiningUntil - now;

  const handleFragment = (id: FragmentId, status: FragmentStatus) => {
    if (status === 'locked') {
      onWatchAd(id);
      return;
    }
    if (status === 'unlocked') {
      if (fragmentCooldownRemaining(state, id, now) > 0) {
        notify('Fragment cooldown is still active', 'info');
        return;
      }
      void onFixFragment(id).then(() => {
        notify(`${FRAGMENT_NAMES[id]} fixed into the circuit. Core mining started`);
      }).catch((error) => {
        notify(error instanceof Error ? error.message : 'Could not verify this fragment action', 'error');
      });
      return;
    }
    notify(`${FRAGMENT_NAMES[id]} is already online`, 'info');
  };

  return (
    <div className="space-y-5 pb-2">
      <LevelBanner tier={tier} rate={rate} />
      <CoreCircuit fragments={state.fragments} rate={rate} />
      <FragmentBays
        fragments={state.fragments}
        cooldowns={state.fragmentCooldowns}
        now={now}
        onFragmentPress={(id) => handleFragment(id, state.fragments[id])}
      />
      <p className="px-1 text-center font-mono text-[11px] leading-relaxed text-neon-500">
        {miningLeft > 0
          ? `Core mining: ${formatRemaining(miningLeft)} left`
          : 'Core offline. Fix a fragment to restart mining.'}
      </p>
      <p className="px-1 text-center font-mono text-[11px] leading-relaxed text-neon-500">
        Complete the timed unlock, then fix the fragment into the core (+0.02 ZP/sec).
        {' '}
        {FRAGMENT_IDS.length - fixedCount(state)} of {FRAGMENT_IDS.length} fragments still missing.
      </p>
      <CharacterCard
        fixed={fixedCount(state)}
        lifetimeZp={formatZp(state.lifetimeZp)}
        rate={formatRate(rate)}
      />
    </div>
  );
}
