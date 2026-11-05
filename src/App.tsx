import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import type { TabId } from '@/components/BottomNav';
import Toast from '@/components/Toast';
import AdModal from '@/components/AdModal';
import ProfileModal from '@/components/ProfileModal';
import LeaderboardModal from '@/components/LeaderboardModal';
import CoreTab from '@/components/core/CoreTab';
import NetworkTab from '@/components/network/NetworkTab';
import MissionsTab from '@/components/missions/MissionsTab';
import VaultTab from '@/components/vault/VaultTab';
import ZordAgentsTab from '@/components/agents/ZordAgentsTab';
import { AdminDashboard } from '@/components/AdminDashboard'; 
import { useGame } from '@/hooks/useGame';
import { useToast } from '@/hooks/useToast';
import { FRAGMENT_NAMES, FRAGMENT_UNLOCK_REWARD } from '@/lib/game/config';
import type { FragmentId } from '@/lib/game/config';
import { formatZp } from '@/lib/format';
import { initTelegram } from '@/lib/telegram';
import { registerReferral } from '@/lib/referral';

type Overlay = 'profile' | 'leaderboard' | 'admin' | null;

export default function App() {
  const { state, actions } = useGame();
  const { toast, notify } = useToast();
  const [tab, setTab] = useState<TabId>('core');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [adFragment, setAdFragment] = useState<FragmentId | null>(null);

  useEffect(() => {
    initTelegram();
    registerReferral(state.referralCode);
  }, [state.referralCode]);

  const completeAd = () => {
    if (!adFragment) return;
    actions.unlockFragment(adFragment);
    notify(`${FRAGMENT_NAMES[adFragment]} unlocked. +${formatZp(FRAGMENT_UNLOCK_REWARD)} ZP`);
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
        zp={state.zp}
        onOpenProfile={() => setOverlay('profile')}
        onOpenLeaderboard={() => setOverlay('leaderboard')}
      />

      <main className="no-scrollbar relative flex-1 overflow-y-auto px-4 pt-4">
        {tab === 'core' && (
          <CoreTab state={state} actions={actions} notify={notify} onWatchAd={setAdFragment} />
        )}
        {tab === 'agents' && <ZordAgentsTab />}
        {tab === 'network' && <NetworkTab state={state} actions={actions} notify={notify} />}
        {tab === 'missions' && (
          <MissionsTab state={state} actions={actions} notify={notify} onOpenAdmin={() => setOverlay('admin')} />
        )}
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
        <LeaderboardModal lifetimeZp={state.lifetimeZp} onClose={() => setOverlay(null)} />
      )}
    {overlay === 'admin' && (
        <AdminDashboard
          onClose={() => setOverlay(null)}
          onApproveSubmission={(rewardZp) => {
            actions.creditZp(rewardZp);
            notify(`Submission approved. +${formatZp(rewardZp)} ZP credited to player`);
          }}
        />
      )}

      <Toast toast={toast} />
    </div>
  );
}
