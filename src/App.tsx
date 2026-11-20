
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
import { createZapAchievementClaimIntent, fetchZapAchievements, fetchZapWallet, verifyZapAchievementClaim } from '@/lib/economy/zapWallet';
import type { ZapAchievements } from '@/lib/economy/zapWallet';
import type { VerifiedLedgerEntry } from '@/lib/economy/verifiedEconomy';
import { fetchTonWallet } from '@/lib/economy/tonWallet';
import { encodeTonCommentPayload, loadTonConnectUI } from '@/lib/ton-connect';
import { rawTonAddress } from '@/components/vault/TonWalletConnection';

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
      entityNumber={auth.player.entityNumber}
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
  entityNumber,
  missions,
}: {
  playerId: string;
  referralCode: string | null;
  entityNumber: number | null;
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
  const [gramWalletConnected, setGramWalletConnected] = useState(false);
  const [pendingFragmentZp, setPendingFragmentZp] = useState(0);
  const [nextFragmentReleaseAt, setNextFragmentReleaseAt] = useState<string | null>(null);
  const [verifiedTransactions, setVerifiedTransactions] = useState<VerifiedLedgerEntry[]>([]);
  const [activeAgentRentals, setActiveAgentRentals] = useState<VerifiedAgentRental[]>([]);
  const [fragmentMiningEnabled, setFragmentMiningEnabled] = useState(true);
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

  useEffect(() => {
    let mounted = true;
    let savedWallet: Awaited<ReturnType<typeof fetchTonWallet>>['wallet'] = null;
    let activeWallet: Awaited<ReturnType<typeof loadTonConnectUI>>['wallet'] = null;
    let unsubscribe: (() => void) | undefined;

    const syncStatus = () => {
      if (!mounted) return;
      setGramWalletConnected(Boolean(
        activeWallet &&
        activeWallet.account.chain === '-239' &&
        savedWallet?.verification_status === 'verified' &&
        rawTonAddress(activeWallet.account.address) === savedWallet.wallet_address
      ));
    };

    void Promise.all([fetchTonWallet(), loadTonConnectUI()]).then(([data, ui]) => {
      if (!mounted) return;
      savedWallet = data.wallet;
      activeWallet = ui.wallet;
      syncStatus();
      unsubscribe = ui.onStatusChange((nextWallet) => {
        activeWallet = nextWallet;
        syncStatus();
        if (nextWallet) {
          void fetchTonWallet().then((latest) => {
            if (!mounted) return;
            savedWallet = latest.wallet;
            syncStatus();
          }).catch(() => undefined);
        }
      });
    }).catch(() => {
      if (mounted) setGramWalletConnected(false);
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [playerId]);

  const identity = resolveIdentity(
    auth,
    getTelegramUser(),
  );

  const { toast, notify } = useToast();

  const handleWalletStatusChange = useCallback((connected: boolean) => {
    setGramWalletConnected(connected);
  }, []);

  const handleClaimAchievement = useCallback(async (level: number) => {
    try {
      const ui = await loadTonConnectUI();
      const wallet = ui.wallet;
      if (!wallet || wallet.account.chain !== '-239') {
        setGramWalletConnected(false);
        setTab('vault');
        notify('Connect and verify your Gram wallet in Vault before paying for this achievement.', 'info');
        return;
      }

      const intent = await createZapAchievementClaimIntent(level);
      if (rawTonAddress(wallet.account.address) !== intent.senderWallet) {
        setGramWalletConnected(false);
        setTab('vault');
        notify('Reconnect the Gram wallet that was verified for this claim, then try again.', 'info');
        return;
      }

      if (intent.reused) {
        const verification = await verifyZapAchievementClaim(intent.intentId);
        if (verification.claimed) {
          const achievements = await fetchZapAchievements();
          setZapAchievements(achievements);
          setZapEarned(achievements.netZap);
          notify(`Level ${level} badge is permanently stored in your collection.`, 'info');
        } else {
          notify('Your previous claim payment is still awaiting network confirmation. Verify again shortly; ZORD will not request a second payment.', 'info');
        }
        return;
      }

      await ui.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 600,
        network: '-239',
        messages: [{
          address: intent.destinationWallet,
          amount: intent.amountNano,
          payload: encodeTonCommentPayload(intent.memo),
        }],
      });

      const verification = await verifyZapAchievementClaim(intent.intentId);
      if (verification.pending) {
        notify('Gram payment submitted. Network confirmation is pending; tap the claim again shortly to verify without paying twice.', 'info');
        return;
      }

      const achievements = await fetchZapAchievements();
      setZapAchievements(achievements);
      setZapEarned(achievements.netZap);
      notify(`Level ${level} badge claimed and permanently stored.`, 'info');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not complete the achievement claim.', 'error');
    }
  }, [notify]);

  const [tab, setTab] = useState<TabId>('core');
  const [missionsInitialView, setMissionsInitialView] = useState<EngagementView>('missions');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [adFragment, setAdFragment] = useState<FragmentId | null>(null);
  const [adProcessing, setAdProcessing] = useState(false);

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
    setAdFragment(fragmentId);
  };

  const handleWatchFragmentAd = async () => {
    if ((adFragment !== 'top' && adFragment !== 'right' && adFragment !== 'bottom') || adProcessing) return;
    setAdProcessing(true);

    try {
      const fragmentId = adFragment;
      const session = await trustedGameplay.beginUnlock(fragmentId);
      if (session.alreadyUnlocked) {
        setAdFragment(null);
        notify('Fragment is already unlocked.', 'info');
        return;
      }
      if (!session.sessionId) {
        throw new Error('ZORD could not prepare a secure unlock session.');
      }

      if (session.provider === 'free') {
        // Shield remains ad-free. Keep the five-second scan animation visible,
        // then let the server enforce the same minimum duration before unlocking.
        await new Promise((resolve) => window.setTimeout(resolve, 5000));
        const completed = await trustedGameplay.completeFreeShieldUnlock(session.sessionId);
        setAdFragment(null);
        if (completed) notify('Shield Fragment unlocked. No advertisement required.', 'info');
        return;
      }

      if (session.provider === 'onclicka') {
        const onclickaWindow = window as Window & {
          initCdTma?: (options: { id: number }) => Promise<() => Promise<unknown>>;
        };
        if (typeof onclickaWindow.initCdTma !== 'function') {
          throw new Error('OnClicka is still loading. Please try again in a moment.');
        }
        const showOnclickaAd = await onclickaWindow.initCdTma({ id: 6155605 });
        if (typeof showOnclickaAd !== 'function') {
          throw new Error('OnClicka could not initialize the rewarded ad.');
        }
        // The SDK Promise is only one signal. The server also waits for
        // OnClicka's independent USERID callback before unlocking the Fragment.
        await showOnclickaAd();
      } else {
        if (!session.ymid) throw new Error('ZORD could not prepare the Monetag verification ID.');
        const showAd = (window as Window & {
          show_12235928?: (options: {
            type: 'end';
            ymid: string;
            requestVar: string;
          }) => Promise<{ reward_event_type?: string } | undefined>;
        }).show_12235928;

        if (typeof showAd !== 'function') {
          throw new Error('Monetag is still loading. Please try again in a moment.');
        }
        const event = await showAd({
          type: 'end',
          ymid: session.ymid,
          requestVar: 'fragment_right',
        });
        if (event?.reward_event_type !== 'valued') {
          setAdFragment(null);
          notify('Monetag did not confirm a valued ad view. No Fragment was unlocked.', 'info');
          return;
        }
      }

      let completed = false;
      for (let attempt = 0; attempt < 15; attempt += 1) {
        completed = await trustedGameplay.completeUnlock(session.sessionId, session.provider);
        if (completed) break;
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
      }

      setAdFragment(null);
      if (completed) {
        notify(session.provider === 'onclicka'
          ? 'OnClicka verified the rewarded ad. Capacitor Fragment unlocked.'
          : 'Monetag verified the rewarded ad. Atom Fragment unlocked.', 'info');
      } else {
        notify(session.provider === 'onclicka'
          ? 'OnClicka SDK completed. ZORD is waiting for its server callback; no reward is granted until it arrives.'
          : 'Monetag confirmed the ad. ZORD is waiting for its server postback; the Fragment will unlock after verification.', 'info');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'The ad could not be verified. No reward was granted.', 'error');
    } finally {
      setAdProcessing(false);
    }
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
            gramWalletConnected={gramWalletConnected}
            onOpenVault={() => setTab('vault')}
            onClaimAchievement={handleClaimAchievement}
            pendingFragmentZp={pendingFragmentZp}
            nextFragmentReleaseAt={nextFragmentReleaseAt}
            entityNumber={entityNumber}
            onOpenExpeditions={() => { setMissionsInitialView('expeditions'); setTab('missions'); }}
            onOpenStreaks={() => { setMissionsInitialView('streaks'); setTab('missions'); }}
            onOpenMysteryBoxes={() => { setMissionsInitialView('mystery'); setTab('missions'); }}
            onOpenRaffles={() => { setMissionsInitialView('raffles'); setTab('missions'); }}
            onOpenMarket={() => setTab('agents')}
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
            onRefreshVerifiedEconomy={refreshVerifiedBalance}
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
          <VaultTab verifiedZpBalance={verifiedZpBalance} transactions={verifiedTransactions} onRefreshVerifiedEconomy={refreshVerifiedBalance} onWalletStatusChange={handleWalletStatusChange} />
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
          isProcessing={adProcessing}
          onWatch={() => { void handleWatchFragmentAd(); }}
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
