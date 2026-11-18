
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
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
import type { EngagementView } from '@/components/missions/Stage6EngagementHub';
import VaultTab from '@/components/vault/VaultTab';
import ZordAgentsTab from '@/components/agents/ZordAgentsTab';
const AdminDashboard = lazy(async () => {
  const module = await import('@/components/admin/AdminReviewModal');
  return { default: module.AdminDashboard };
});
import PlayerAnnouncements from '@/components/PlayerAnnouncements';

import { useGame } from '@/hooks/useGame';
import { useToast } from '@/hooks/useToast';
import { AuthProvider, useAuth } from '@/hooks/useTelegramAuth';
import { useMissions } from '@/hooks/useMissions';
import { fetchVerifiedEconomy } from '@/lib/economy/verifiedEconomy';
import type { VerifiedAgentRental } from '@/lib/economy/verifiedEconomy';
import { fetchZapAchievements, fetchZapWallet } from '@/lib/economy/zapWallet';
import type { ZapAchievements } from '@/lib/economy/zapWallet';
import type { VerifiedLedgerEntry } from '@/lib/economy/verifiedEconomy';

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
    isLoading,
    clockNow,
    trustedGameplay,
  } = useGame(referralCode, playerId);

  const { auth } = useAuth();
  const [verifiedZpBalance, setVerifiedZpBalance] = useState<number | null>(null);
  const [verifiedZpLifetime, setVerifiedZpLifetime] = useState<number | null>(null);
  const [zapEarned, setZapEarned] = useState<number | null>(null);
  const [zapLoading, setZapLoading] = useState(true);
  const [zapAchievements, setZapAchievements] = useState<ZapAchievements | null>(null);
  const [zapAchievementsLoading, setZapAchievementsLoading] = useState(true);
  const [pendingFragmentZp, setPendingFragmentZp] = useState(0);
  const [nextFragmentReleaseAt, setNextFragmentReleaseAt] = useState<string | null>(null);
  const [verifiedTransactions, setVerifiedTransactions] = useState<VerifiedLedgerEntry[]>([]);
  const [activeAgentRentals, setActiveAgentRentals] = useState<VerifiedAgentRental[]>([]);
  const [fragmentMiningEnabled, setFragmentMiningEnabled] = useState(false);
  const [fragmentMiningRateMultiplier, setFragmentMiningRateMultiplier] = useState(1);

  const refreshVerifiedBalance = useCallback(async () => {
    try {
      const economy = await fetchVerifiedEconomy();
      setVerifiedZpBalance(economy.verifiedZpBalance);
      setVerifiedZpLifetime(economy.verifiedLifetimeZp);
      setPendingFragmentZp(economy.pendingFragmentZp);
      setNextFragmentReleaseAt(economy.nextFragmentReleaseAt);
      setVerifiedTransactions(economy.transactions);
      setActiveAgentRentals(economy.activeAgentRentals);
      setFragmentMiningEnabled(economy.fragmentMiningEnabled);
      setFragmentMiningRateMultiplier(economy.fragmentMiningRateMultiplier);
      try {
        const zapWallet = await fetchZapWallet();
        setZapEarned(zapWallet.rankingEarned);
        const achievements = await fetchZapAchievements();
        setZapAchievements(achievements);
      } catch (zapError) {
        console.error('ZAP earnings load failed:', zapError);
        setZapEarned(null);
        setZapAchievements(null);
      } finally {
        setZapLoading(false);
        setZapAchievementsLoading(false);
      }
    } catch (error) {
      console.error('Verified ZP balance load failed:', error);
      setVerifiedZpBalance(null);
      setVerifiedZpLifetime(null);
      setPendingFragmentZp(0);
      setNextFragmentReleaseAt(null);
      setVerifiedTransactions([]);
      setActiveAgentRentals([]);
      setFragmentMiningEnabled(false);
      setFragmentMiningRateMultiplier(1);
      setZapEarned(null);
      setZapAchievements(null);
      setZapLoading(false);
      setZapAchievementsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshVerifiedBalance();
    const interval = window.setInterval(() => void refreshVerifiedBalance(), 60000);
    window.addEventListener('focus', refreshVerifiedBalance);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshVerifiedBalance);
    };
  }, [playerId, refreshVerifiedBalance]);

  const identity = resolveIdentity(
    auth,
    getTelegramUser(),
  );

  const { toast, notify } = useToast();

  const [tab, setTab] = useState<TabId>('core');
  const [missionsInitialView, setMissionsInitialView] = useState<EngagementView>('missions');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [adFragment, setAdFragment] = useState<FragmentId | null>(null);

  // Wait until the local snapshot is ready before rendering the player UI.
  if (isLoading) {
    return (
      <div className="relative mx-auto flex h-dvh max-w-md items-center justify-center bg-obsidian">
        <div className="crt-overlay" aria-hidden />
        <NeonSpinner label="Loading player state" />
      </div>
    );
  }

  const startFragmentUnlock = (fragmentId: FragmentId) => {
    // Publisher-review preview only. Do not create an unlock session until
    // the assigned ad provider is connected and server-side verification exists.
    setAdFragment(fragmentId);
  };



  return (
    <div className="relative mx-auto flex h-dvh max-w-md flex-col overflow-hidden bg-obsidian">
      <div className="crt-overlay" aria-hidden />

      <Header
        verifiedZpBalance={verifiedZpBalance}
        onOpenProfile={() => setOverlay('profile')}
        onOpenLeaderboard={() => setOverlay('leaderboard')}
      />

      <main className="no-scrollbar relative flex-1 overflow-y-auto px-4 pt-4">
        <PlayerAnnouncements />
        {tab === 'core' && (
          <CoreTab
            state={state}
            now={clockNow}
            fragmentMiningEnabled={fragmentMiningEnabled}
            fragmentMiningRateMultiplier={fragmentMiningRateMultiplier}
            notify={notify}
            onWatchAd={(id) => { void startFragmentUnlock(id); }}
            verifiedZpBalance={verifiedZpBalance}
            activeAgentRentals={activeAgentRentals}
            zapEarned={zapEarned}
            zapLoading={zapLoading}
            zapAchievements={zapAchievements}
            zapAchievementsLoading={zapAchievementsLoading}
            pendingFragmentZp={pendingFragmentZp}
            nextFragmentReleaseAt={nextFragmentReleaseAt}
            onOpenExpeditions={() => { setMissionsInitialView('expeditions'); setTab('missions'); }}
            onOpenStreaks={() => { setMissionsInitialView('streaks'); setTab('missions'); }}
            onOpenMysteryBoxes={() => { setMissionsInitialView('mystery'); setTab('missions'); }}
            onOpenRaffles={() => { setMissionsInitialView('raffles'); setTab('missions'); }}
            onFixFragment={async (id) => {
              try {
                await trustedGameplay.fixFragment(id);
                return true;
              } catch (error) {
                if (error instanceof Error && error.message.includes('Unlock this fragment')) {
                  await startFragmentUnlock(id);
                  return false;
                }
                throw error;
              }
            }}
          />
        )}

        {tab === 'agents' && <ZordAgentsTab onRefreshVerifiedEconomy={refreshVerifiedBalance} />}

        {tab === 'network' && (
          <NetworkTab
            state={state}
            notify={notify}
          />
        )}

        {tab === 'missions' && (
          <MissionsTab
            state={state}
            notify={notify}
            missions={missions}
            onOpenAdmin={() => setOverlay('admin')}
            onRefreshVerifiedEconomy={refreshVerifiedBalance}
            initialView={missionsInitialView}
          />
        )}

        {tab === 'vault' && (
          <VaultTab verifiedZpBalance={verifiedZpBalance} transactions={verifiedTransactions} onRefreshVerifiedEconomy={refreshVerifiedBalance} />
        )}
      </main>

      <BottomNav
        active={tab}
        onChange={(nextTab) => { if (nextTab === 'missions') setMissionsInitialView('missions'); setTab(nextTab); }}
      />

      {adFragment && (
        <AdModal
          fragmentId={adFragment}
          isReactivation={state.fragments[adFragment] === 'fixed'}
          onClose={() => setAdFragment(null)}
        />
      )}

      {overlay === 'profile' && (
        <ProfileModal
          identity={identity}
          verifiedZpBalance={verifiedZpBalance}
          verifiedZpLifetime={verifiedZpLifetime}
          zapEarned={zapEarned}
          zapAchievements={zapAchievements}
          onClose={() => setOverlay(null)}
        />
      )}

      {overlay === 'leaderboard' && (
        <LeaderboardModal onClose={() => setOverlay(null)} />
      )}

      {overlay === 'admin' && (
        <Suspense fallback={<div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 font-mono text-xs text-neon-300">Loading admin console…</div>}>
          <AdminDashboard
            onClose={() => setOverlay(null)}
            onApproveSubmission={(rewardZp) => {
              notify(
                `Submission approved. +${formatZp(rewardZp)} ZP credited to submitting player`,
              );
            }}
          />
        </Suspense>
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
