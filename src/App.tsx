
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

import type { MissionSpec } from '@/lib/game/config';
import {
  FRAGMENT_NAMES,
  FRAGMENT_UNLOCK_REWARD,
} from '@/lib/game/config';

import type { FragmentId } from '@/lib/game/config';

import { formatZp } from '@/lib/format';
import { initTelegram, getTelegramUser } from '@/lib/telegram';

import type { TelegramUser } from '@/lib/telegram';
import type { AuthState } from '@/lib/auth';

type Overlay = 'profile' | 'leaderboard' | 'admin' | null;

function AppShell() {
  const { auth } = useAuth();
  const [demoMode, setDemoMode] = useState(false);
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

  if (auth.status === 'error' && !demoMode) {
    return (
      <div className="relative mx-auto flex h-dvh max-w-md flex-col items-center justify-center gap-4 bg-obsidian px-6 text-center">
        <div className="crt-overlay" aria-hidden />

        <AlertTriangle size={32} className="text-red-400" />

        <p className="font-mono text-[11px] uppercase tracking-widest text-red-300">
          {auth.message}
        </p>

        <p className="font-mono text-[10px] text-neon-600">
          Open this app from Telegram to authenticate, or use the isolated Preview demo.
        </p>
        <button
          type="button"
          onClick={() => setDemoMode(true)}
          className="mt-2 rounded-lg border border-cyan-400/50 bg-cyan-400/10 px-6 py-3 font-mono text-xs uppercase tracking-wider text-cyan-200"
        >
          Enter Preview Demo
        </button>
      </div>
    );
  }

  if (auth.status !== 'authenticated' && !demoMode) {
    return null;
  }

  const referralCode = auth.status === 'authenticated' ? auth.player.referralCode : 'ZORD-DEMO';
  const playerId = auth.status === 'authenticated' ? auth.player.playerId : 'preview-demo-session';

  return (
    <GameApp
      key={playerId}
      playerId={playerId}
      referralCode={referralCode}
      missions={demoMode ? [] : missions}
      isDemo={demoMode}
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
  isDemo = false,
}: {
  playerId: string;
  referralCode: string | null;
  missions: MissionSpec[];
  isDemo?: boolean;
}) {
  const {
    state,
    actions,
    isLoading,
    loadError,
    syncError,
    retryLoad,
  } = useGame(referralCode, playerId, isDemo);

  const { auth } = useAuth();

  const identity = resolveIdentity(
    auth,
    getTelegramUser(),
  );

  const { toast, notify } = useToast();

  const [tab, setTab] = useState<TabId>('core');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [adFragment, setAdFragment] = useState<FragmentId | null>(null);

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

  const completeAd = () => {
    if (!adFragment) return;

    actions.unlockFragment(adFragment);

    notify(
      `${FRAGMENT_NAMES[adFragment]} unlocked. +${formatZp(FRAGMENT_UNLOCK_REWARD)} ZP`,
    );

    setAdFragment(null);
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

      {isDemo && (
        <div className="mx-4 mt-2 border border-cyan-400/40 bg-cyan-400/10 px-3 py-2 text-center font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-200">
          Preview Demo — sample data only · no cloud saves or rewards
        </div>
      )}

      <Header
        zp={state.zp}
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
            actions={actions}
            notify={notify}
            onWatchAd={setAdFragment}
          />
        )}

        {tab === 'agents' && <ZordAgentsTab />}

        {tab === 'network' && (
          <NetworkTab
            state={state}
            actions={actions}
            notify={notify}
          />
        )}

        {tab === 'missions' && isDemo && (
          <section className="panel space-y-3 border border-cyan-400/30 bg-black/40 p-4">
            <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-cyan-200">Demo missions</h2>
            <p className="font-mono text-[10px] leading-relaxed text-neon-500">These are examples for interface review. Mission submissions, verification and rewards are disabled in Demo Mode.</p>
            {[
              ['Daily Uplink', 'Check in with ZORD OS for today.', '100 ZP'],
              ['Agent Uptime', 'Keep a ZORD agent running.', '200 ZP'],
              ['Follow the Signal Feed', 'Catch every fragment drop as it breaks.', '250 ZP'],
              ['Creator Content Drop', 'Submit a video featuring ZORD.', '500 ZP'],
            ].map(([title, description, reward]) => (
              <article key={title} className="border border-neon/20 bg-black/30 p-3">
                <p className="font-mono text-[11px] font-bold text-neon-300">{title}</p>
                <p className="mt-1 font-mono text-[10px] text-neon-600">{description}</p>
                <p className="mt-2 font-mono text-[10px] text-cyan-300">{reward} · preview only</p>
              </article>
            ))}
          </section>
        )}

        {tab === 'missions' && !isDemo && (
          <MissionsTab
            state={state}
            actions={actions}
            notify={notify}
            missions={missions}
            onOpenAdmin={() => setOverlay('admin')}
          />
        )}

        {tab === 'events' && (isDemo ? (
          <section className="panel space-y-3 border border-cyan-400/30 bg-black/40 p-4">
            <h2 className="font-display text-lg font-bold uppercase tracking-wider text-cyan-200">Events Hub · Demo</h2>
            <p className="font-mono text-[10px] leading-relaxed text-neon-500">Sample event cards are shown for layout review. Joining, participation tracking and reward claims are disabled.</p>
            {[
              ['ZORD Daily Uplink', 'Daily', 'Complete the daily check-in objective.', '100 ZP configured'],
              ['Community Signal Challenge', 'Weekly', 'Take part in the community challenge.', '500 ZP configured'],
              ['Creator Content Sprint', 'Special', 'Publish and submit ZORD-related content.', '500 ZP + 10 ZAP configured'],
            ].map(([title, category, description, reward]) => (
              <article key={title} className="border border-neon/20 bg-black/30 p-3">
                <p className="font-mono text-[9px] uppercase tracking-widest text-neon-600">{category} event · sample</p>
                <h3 className="mt-1 font-mono text-[11px] font-bold text-neon-300">{title}</h3>
                <p className="mt-1 font-mono text-[10px] text-neon-600">{description}</p>
                <p className="mt-2 font-mono text-[10px] text-cyan-300">{reward}</p>
                <span className="mt-2 inline-block border border-cyan-400/30 px-2 py-1 font-mono text-[9px] uppercase text-cyan-200">Demo only · no registration</span>
              </article>
            ))}
          </section>
        ) : <EventsTab />)}

        {tab === 'vault' && (
          <VaultTab
            state={state}
            actions={actions}
            notify={notify}
          />
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
          onCancel={() => setAdFragment(null)}
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
