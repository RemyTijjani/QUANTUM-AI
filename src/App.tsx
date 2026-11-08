import { useCallback, useEffect, useState } from 'react';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import type { TabId } from '@/components/BottomNav';
import Toast from '@/components/Toast';
import AdModal from '@/components/AdModal';
import ProfileModal from '@/components/ProfileModal';
import type { ProfileIdentity } from '@/components/ProfileModal';
import LeaderboardModal from '@/components/LeaderboardModal';
import CoreTab from '@/components/core/CoreTab';
import NetworkTab from '@/components/network/NetworkTab';
import MissionsTab from '@/components/missions/MissionsTab';
import VaultTab from '@/components/vault/VaultTab';
import ZordAgentsTab from '@/components/agents/ZordAgentsTab';
import { AdminDashboard } from '@/components/admin/AdminReviewModal';
import { useGame } from '@/hooks/useGame';
import { useToast } from '@/hooks/useToast';
import { AuthProvider, useAuth } from '@/hooks/useTelegramAuth';
import { useMissions } from '@/hooks/useMissions';
import { ZordPreloader } from '@/components/ZordPreloader';
import type { MissionSpec } from '@/lib/game/config';
import { FRAGMENT_NAMES, FRAGMENT_UNLOCK_REWARD } from '@/lib/game/config';
import type { FragmentId } from '@/lib/game/config';
import { formatZp } from '@/lib/format';
import { initTelegram, getTelegramUser } from '@/lib/telegram';
import type { TelegramUser } from '@/lib/telegram';
import type { AuthState } from '@/lib/auth';

type Overlay = 'profile' | 'leaderboard' | 'admin' | null;

function AppShell() {
  const { auth } = useAuth();
  const missions = useMissions(auth.status === 'authenticated');
  const [introDone, setIntroDone] = useState(false);
  const handleIntroComplete = useCallback(() => setIntroDone(true), []);

  useEffect(() => {
    initTelegram();
  }, []);

  if (!introDone) return <ZordPreloader onComplete={handleIntroComplete} />;

  const referralCode = auth.status === 'authenticated' ? auth.player.referralCode : null;
  const missionList = missions.resource.status === 'ready' ? missions.resource.data : [];
  return <GameApp referralCode={referralCode} missions={missionList} />;
}

function resolveIdentity(auth: AuthState, telegramUser: TelegramUser | null): ProfileIdentity | null {
  if (auth.status === 'authenticated') {
    return { firstName: auth.player.firstName, username: auth.player.username };
  }
  if (telegramUser) {
    return { firstName: telegramUser.first_name ?? null, username: telegramUser.username ?? null };
  }
  return null;
}

function GameApp({ referralCode, missions }: { referralCode: string | null; missions: MissionSpec[] }) {
  const { state, actions } = useGame(referralCode);
  const { auth } = useAuth();
  const identity = resolveIdentity(auth, getTelegramUser());
  const { toast, notify } = useToast();
  const [tab, setTab] = useState<TabId>('core');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [adFragment, setAdFragment] = useState<FragmentId | null>(null);

  const completeAd = () => {
    if (!adFragment) return;
    actions.unlockFragment(adFragment);
    notify(`${FRAGMENT_NAMES[adFragment]} unlocked. +${formatZp(FRAGMENT_UNLOCK_REWARD)} ZP`);
    setAdFragment(null);
  };

  const resetSystem = () => {
    actions.reset(state.referralCode);
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
          <MissionsTab
            state={state}
            actions={actions}
            notify={notify}
            missions={missions}
            onOpenAdmin={() => setOverlay('admin')}
          />
        )}
        {tab === 'vault' && <VaultTab state={state} actions={actions} notify={notify} />}
      </main>

      <BottomNav active={tab} onChange={setTab} />

      {adFragment && (
        <AdModal fragmentId={adFragment} onComplete={completeAd} onCancel={() => setAdFragment(null)} />
      )}
      {overlay === 'profile' && (
        <ProfileModal state={state} identity={identity} onReset={resetSystem} onClose={() => setOverlay(null)} />
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

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
