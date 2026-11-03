import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import type { TabId } from '@/components/BottomNav';
import Toast from '@/components/Toast';
import AdModal from '@/components/AdModal';
import ProfileModal from '@/components/ProfileModal';
import LeaderboardModal from '@/components/LeaderboardModal';
import CoreTab from '@/components/core/CoreTab';
import BlackmarketTab from '@/components/blackmarket/BlackmarketTab';
import NetworkTab from '@/components/network/NetworkTab';
import MissionsTab from '@/components/missions/MissionsTab';
import VaultTab from '@/components/vault/VaultTab';
import { useGame } from '@/hooks/useGame';
import { useToast } from '@/hooks/useToast';
import { FRAGMENT_NAMES, FRAGMENT_UNLOCK_REWARD } from '@/lib/game/config';
import type { FragmentId } from '@/lib/game/config';
import { formatIq } from '@/lib/format';
import { initTelegram } from '@/lib/telegram';

type Overlay = 'profile' | 'leaderboard' | null;

export default function App() {
  const { state, actions } = useGame();
  const { toast, notify } = useToast();
  const [tab, setTab] = useState<TabId>('core');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [adFragment, setAdFragment] = useState<FragmentId | null>(null);

  useEffect(() => {
    initTelegram();
  }, []);

  const completeAd = () => {
    if (!adFragment) return;
    actions.unlockFragment(adFragment);
    notify(`${FRAGMENT_NAMES[adFragment]} unlocked. +${formatIq(FRAGMENT_UNLOCK_REWARD)} IQ`);
    setAdFragment(null);
  };

  const resetSystem = () => {
    actions.reset();
    setOverlay(null);
    notify('System memory wiped. Fresh operative online', 'info');
  };

  return (
    <div className="relative mx-auto flex h-dvh max-w-md flex-col overflow-hidden bg-obsidian">
      <div className="crt-overlay" aria-hidden />

      <Header
        iq={state.iq}
        onOpenProfile={() => setOverlay('profile')}
        onOpenLeaderboard={() => setOverlay('leaderboard')}
      />

      <main className="no-scrollbar relative flex-1 overflow-y-auto px-4 pt-4">
        {tab === 'core' && (
          <CoreTab state={state} actions={actions} notify={notify} onWatchAd={setAdFragment} />
        )}
        {tab === 'blackmarket' && (
          <BlackmarketTab
            state={state}
            actions={actions}
            notify={notify}
            onWatchAd={setAdFragment}
            onGoToVault={() => setTab('vault')}
          />
        )}
        {tab === 'network' && <NetworkTab state={state} actions={actions} notify={notify} />}
        {tab === 'missions' && <MissionsTab state={state} actions={actions} notify={notify} />}
        {tab === 'vault' && <VaultTab state={state} actions={actions} notify={notify} />}
      </main>

      <BottomNav active={tab} onChange={setTab} />

      {adFragment && (
        <AdModal fragmentId={adFragment} onComplete={completeAd} onCancel={() => setAdFragment(null)} />
      )}
      {overlay === 'profile' && (
        <ProfileModal state={state} onReset={resetSystem} onClose={() => setOverlay(null)} />
      )}
      {overlay === 'leaderboard' && (
        <LeaderboardModal lifetimeIq={state.lifetimeIq} onClose={() => setOverlay(null)} />
      )}

      <Toast toast={toast} />
    </div>
  );
}
