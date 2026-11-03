import { FRAGMENT_IDS, FRAGMENT_NAMES, FRAGMENT_UNLOCK_REWARD } from '@/lib/game/config';
import type { FragmentId } from '@/lib/game/config';
import { fixedCount, fragmentCooldownRemaining, passiveRate, tierInfo } from '@/lib/game/state';
import type { GameState, FragmentStatus } from '@/lib/game/state';
import { formatRate, formatIq, formatRemaining } from '@/lib/format';
import type { GameActions } from '@/hooks/useGame';
import type { Notify } from '@/hooks/useToast';
import LevelBanner from '@/components/core/LevelBanner';
import CoreCircuit from '@/components/core/CoreCircuit';
import FragmentBays from '@/components/core/FragmentBays';
import CharacterCard from '@/components/core/CharacterCard';

interface CoreTabProps {
  state: GameState;
  actions: GameActions;
  notify: Notify;
  onWatchAd: (id: FragmentId) => void;
}

export default function CoreTab({ state, actions, notify, onWatchAd }: CoreTabProps) {
  const now = Date.now();
  const tier = tierInfo(state.lifetimeIq);
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
      actions.fixFragment(id);
      notify(`${FRAGMENT_NAMES[id]} fixed into the circuit. Core mining started`);
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
        Watch a sponsor feed to unlock a fragment (+{FRAGMENT_UNLOCK_REWARD} IQ), wait for its cooldown, then fix it into the core (+0.02 IQ/sec).
        {' '}
        {FRAGMENT_IDS.length - fixedCount(state)} of {FRAGMENT_IDS.length} fragments still missing.
      </p>
      <CharacterCard
        fixed={fixedCount(state)}
        lifetimeIq={formatIq(state.lifetimeIq)}
        rate={formatRate(rate)}
      />
    </div>
  );
}
