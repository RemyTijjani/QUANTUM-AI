
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import type { TabId } from '@/components/BottomNav';
import Toast from '@/components/Toast';
import { NeonSpinner } from '@/components/NeonSpinner';
import ZordPreloader from '@/components/ZordPreloader';
import AdModal from '@/components/AdModal';
import ProfileModal from '@/components/ProfileModal';
import type { ProfileIdentity } from '@/components/ProfileModal';
import LeaderboardModal from '@/components/LeaderboardModal';
import CoreTab from '@/components/core/CoreTab';
import NetworkTab from '@/components/network/NetworkTab';
import MissionsTab from '@/components/missions/MissionsTab';
import VaultTab from '@/components/vault/VaultTab';
import ZordAgentsTab from '@/components/agents/ZordAgentsTab';
import EventsTab from '@/components/events/EventsTab';
import { AdminDashboard } from '@/components/admin/AdminReviewModal';

import { useGame } from '@/hooks/useGame';
import { useToast } from '@/hooks/useToast';
import { AuthProvider, useAuth } from '@/hooks/useTelegramAuth';
import { useMissions } from '@/hooks/useMissions';
import { fetchVerifiedEconomy } from '@/lib/economy/verifiedEconomy';

import type { MissionSpec } from '@/lib/game/config';
import type { FragmentId } from '@/lib/game/config';

import { formatZp } from '@/lib/format';
import { initTelegram, getTelegramUser } from '@/lib/telegram';

import type { TelegramUser } from '@/lib/telegram';
import type { AuthState } from '@/lib/auth';

type Overlay = 'profile' | 'leaderboard' | 'admin' | null;

function AppShell() {
  const { auth } = useAuth();
  const missions = useMissions();

  useEffect(() => {
    initTelegram();
  }, []);

  if (auth.status === 'loading') {
    return (
      <div className="relative mx-auto flex h-dvh max-w-md items-center justify-center bg-obsidian">
        <div className="crt-overlay" aria-hidden />
        <NeonSpinner label="Establishing link" />
      </div>
    );
  }

  if (auth.status === 'error') {
    return (
      <div className="relative mx-auto flex h-dvh max-w-md flex-col items-center justify-center gap-4 bg-obsidian px-6 text-center">
        <div className="crt-overlay" aria-hidden />

        <AlertTriangle size={32} className="text-red-400" />

        <p className="font-mono text-[11px] uppercase tracking-widest text-red-300">
          {auth.message}
        </p>

        <p className="font-mono text-[10px] text-neon-600">
          Open this app from Telegram to authenticate.
        </p>
      </div>
    );
  }

  if (auth.status !== 'authenticated') {
    return null;
  }

  const referralCode = auth.player.referralCode;
  const playerId = auth.player.playerId;

  return (
    <GameApp
      key={playerId}
      playerId={playerId}
      referralCode={referralCode}
      missions={missions}
    />
  );
}

function resolveIdentity(
  auth: AuthState,
  telegramUser: TelegramUser | null,
): ProfileIdentity | null {
  if (auth.status === 'authenticated') {
    return {
      firstName: auth.player.firstName,
      username: auth.player.username,
    };
  }

  if (telegramUser) {
    return {
      firstName: telegramUser.first_name ?? null,
      username: telegramUser.username ?? null,
    };
  }

  return null;
}

function GameApp({
  playerId,
  referralCode,
  missions,
}: {
  playerId: string;
  referralCode: string | null;
  missions: MissionSpec[];
}) {
  const {
    state,
    actions,
    isLoading,
    loadError,
    syncError,
    retryLoad,
    trustedGameplay,
  } = useGame(referralCode, playerId);

  const { auth } = useAuth();
  const [verifiedZpBalance, setVerifiedZpBalance] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refreshVerifiedBalance = async () => {
      try {
        const economy = await fetchVerifiedEconomy();
        if (!cancelled) setVerifiedZpBalance(economy.verifiedZpBalance);
      } catch (error) {
        console.error('Verified ZP balance load failed:', error);
        if (!cancelled) setVerifiedZpBalance(null);
      }
    };
    void refreshVerifiedBalance();
    const interval = window.setInterval(() => void refreshVerifiedBalance(), 60000);
    window.addEventListener('focus', refreshVerifiedBalance);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshVerifiedBalance);
    };
  }, [playerId]);

  const identity = resolveIdentity(
    auth,
    getTelegramUser(),
  );

  const { toast, notify } = useToast();

  const [tab, setTab] = useState<TabId>('core');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [adFragment, setAdFragment] = useState<FragmentId | null>(null);
  const [adSessionId, setAdSessionId] = useState<string | null>(null);

  // Wait until the cloud save has loaded.
  if (isLoading) {
    return (
      <div className="relative mx-auto flex h-dvh max-w-md items-center justify-center bg-obsidian">
        <div className="crt-overlay" aria-hidden />
        <NeonSpinner label="Loading cloud game save" />
      </div>
    );
  }

  // Show an error instead of starting a fresh game
  // when the cloud save cannot be loaded.
  if (loadError) {
    return (
      <div className="relative mx-auto flex h-dvh max-w-md flex-col items-center justify-center gap-5 bg-obsidian px-6 text-center">
        <div className="crt-overlay" aria-hidden />

        <AlertTriangle
          size={32}
          className="text-red-400"
        />

        <p className="font-mono text-xs text-red-300">
          Unable to load your cloud game save.
        </p>

        <p className="break-all font-mono text-[10px] text-neon-500">
          {loadError}
        </p>

        <button
          onClick={retryLoad}
          className="rounded-lg border border-neon/40 bg-neon/10 px-6 py-3 font-mono text-xs uppercase text-neon-300"
        >
          Retry
        </button>
      </div>
    );
  }

  const startFragmentUnlock = async (fragmentId: FragmentId) => {
    try {
      const result = await trustedGameplay.beginUnlock(fragmentId);
      if (result.alreadyUnlocked || !result.sessionId) {
        notify('This fragment is already unlocked and ready to fix.', 'info');
        return;
      }
      setAdSessionId(result.sessionId);
      setAdFragment(fragmentId);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not start fragment unlock', 'error');
    }
  };

  const completeAd = async () => {
    if (!adSessionId) return;
    try {
      await trustedGameplay.completeUnlock(adSessionId);
      notify('Fragment unlocked by the trusted gameplay service. No ZP reward was issued.');
      setAdFragment(null);
      setAdSessionId(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'The server could not verify this unlock', 'error');
    }
  };

  const resetSystem = () => {
    actions.reset(state.referralCode);

    setOverlay(null);

    notify(
      'System memory wiped. Fresh operative online',
      'info',
    );
  };

  return (
    <div className="relative mx-auto flex h-dvh max-w-md flex-col overflow-hidden bg-obsidian">
      <div className="crt-overlay" aria-hidden />

      <Header
        zp={state.zp}
        verifiedZpBalance={verifiedZpBalance}
        onOpenProfile={() => setOverlay('profile')}
        onOpenLeaderboard={() => setOverlay('leaderboard')}
      />

      {syncError && (
        <div className="mx-4 mt-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-2 font-mono text-[10px] text-yellow-300">
          {syncError}
        </div>
      )}

      <main className="no-scrollbar relative flex-1 overflow-y-auto px-4 pt-4">
        {tab === 'core' && (
          <CoreTab
            state={state}
            notify={notify}
            onWatchAd={(id) => { void startFragmentUnlock(id); }}
            verifiedZpBalance={verifiedZpBalance}
            onFixFragment={async (id) => {
              try {
                await trustedGameplay.fixFragment(id);
              } catch (error) {
                if (error instanceof Error && error.message.includes('Unlock this fragment')) {
                  await startFragmentUnlock(id);
                  return;
                }
                throw error;
              }
            }}
          />
        )}

        {tab === 'agents' && <ZordAgentsTab state={state} />}

        {tab === 'network' && (
          <NetworkTab
            state={state}
            actions={actions}
            notify={notify}
          />
        )}

        {tab === 'missions' && (
          <MissionsTab
            state={state}
            notify={notify}
            missions={missions}
            onOpenAdmin={() => setOverlay('admin')}
          />
        )}

        {tab === 'events' && <EventsTab />}

        {tab === 'vault' && (
          <VaultTab verifiedZpBalance={verifiedZpBalance} />
        )}
      </main>

      <BottomNav
        active={tab}
        onChange={setTab}
      />

      {adFragment && (
        <AdModal
          fragmentId={adFragment}
          onComplete={completeAd}
          onCancel={() => { setAdFragment(null); setAdSessionId(null); }}
        />
      )}

      {overlay === 'profile' && (
        <ProfileModal
          state={state}
          identity={identity}
          onReset={resetSystem}
          onClose={() => setOverlay(null)}
        />
      )}

      {overlay === 'leaderboard' && (
        <LeaderboardModal
          lifetimeZp={state.lifetimeZp}
          onClose={() => setOverlay(null)}
        />
      )}

      {overlay === 'admin' && (
        <AdminDashboard
          onClose={() => setOverlay(null)}
          onApproveSubmission={(rewardZp) => {
            notify(
              `Submission approved. +${formatZp(rewardZp)} ZP credited to submitting player`,
            );
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
      <ZordPreloader>
        <AppShell />
      </ZordPreloader>
    </AuthProvider>
  );
}
