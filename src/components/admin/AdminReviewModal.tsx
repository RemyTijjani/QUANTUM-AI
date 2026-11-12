
import { useCallback, useState, FormEvent } from 'react';
import {
  Check,
  X,
  ExternalLink,
  RefreshCw,
  Terminal,
  Activity,
  Users,
  Database,
  Radio,
  Download,
  Zap,
  ArrowLeft,
  ShieldCheck,
} from 'lucide-react';

import { formatZp } from '@/lib/format';

import {
  AdminApiError,
  fetchDashboard,
  reviewSubmission,
  saveTask,
  deleteTask,
  saveVaultReserves,
  saveEvent,
  deleteEvent,
  listEventParticipants,
} from '@/lib/admin/adminApi';

import type {
  AdminCredentials,
  AdminDashboardData,
  AdminSubmission,
  AdminTaskInput,
  AdminVaultReserves,
  AdminEventInput,
} from '@/lib/admin/adminApi';

import AdminLogin from '@/components/admin/AdminLogin';
import AdminTaskManager from '@/components/admin/AdminTaskManager';
import AdminEventManager from '@/components/admin/AdminEventManager';
import AdminPlayerManager from '@/components/admin/AdminPlayerManager';
import VaultReservesCard from '@/components/admin/VaultReservesCard';
import { NeonSpinner } from '@/components/NeonSpinner';

interface AdminDashboardProps {
  onClose: () => void;
  onApproveSubmission: (rewardZp: number) => void;
}

interface AdminSession {
  creds: AdminCredentials;
  data: AdminDashboardData;
}

const errorMessage = (err: unknown) =>
  err instanceof AdminApiError
    ? err.message
    : 'Something went wrong. Please try again.';

export function AdminDashboard({
  onClose,
  onApproveSubmission,
}: AdminDashboardProps) {
  const [session, setSession] = useState<AdminSession | null>(null);

  if (!session) {
    return (
      <AdminLogin
        onSuccess={(creds, data) => setSession({ creds, data })}
        onClose={onClose}
      />
    );
  }

  return (
    <AdminConsole
      creds={session.creds}
      initialData={session.data}
      onClose={onClose}
      onApproveSubmission={onApproveSubmission}
    />
  );
}

function AdminConsole({
  creds,
  initialData,
  onClose,
  onApproveSubmission,
}: {
  creds: AdminCredentials;
  initialData: AdminDashboardData;
  onClose: () => void;
  onApproveSubmission: (rewardZp: number) => void;
}) {
  const [data, setData] = useState<AdminDashboardData>(initialData);
  const [activeTab, setActiveTab] = useState<'queue' | 'stats' | 'tasks' | 'events' | 'players'>('queue');
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const [multiplier, setMultiplier] = useState<number>(0.09);
  const [isFlushing, setIsFlushing] = useState<boolean>(false);
  const [broadcastText, setBroadcastText] = useState<string>('');

  const [logs, setLogs] = useState<string[]>([
    '[INIT] ZORD OS // COMMAND & CONTROL online.',
    '[SYS] Autonomous Moderation Intelligence cluster synced.',
    '[AUTH] Administrator credentials verified.',
  ]);

  const addLog = (line: string) => setLogs((prev) => [line, ...prev]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setLoadError(null);

    try {
      setData(await fetchDashboard(creds));
    } catch (err) {
      setLoadError(errorMessage(err));
    }

    setRefreshing(false);
  }, [creds]);

  const handleReview = async (
    submission: AdminSubmission,
    decision: 'approved' | 'rejected',
  ) => {
    setProcessingId(submission.id);
    setActionError(null);

    try {
      // The backend database function performs the actual review
      // and credits the submitting player's balance atomically.
      const result = await reviewSubmission(
        creds,
        submission.id,
        decision,
      );

      if (decision === 'approved') {
        // Notify the app only after the backend confirms approval.
        // Do not credit the administrator's local game balance here.
        onApproveSubmission(result.rewardZp);

        addLog(
          `[APPROVED] Mission reward +${formatZp(result.rewardZp)} ZP granted to ${result.playerReferralCode ?? 'submitting player'}`,
        );
      } else {
        addLog(
          `[REJECTED] Submission from ${submission.player_referral_code ?? 'unknown player'} declined.`,
        );
      }

      await refresh();
    } catch (err) {
      setActionError(errorMessage(err));
    }

    setProcessingId(null);
  };

  const handleSaveTask = async (input: AdminTaskInput) => {
    await saveTask(creds, input);

    addLog(
      `[TASK] ${input.id ? 'Updated' : 'Created'} task: ${input.title}`,
    );

    await refresh();
  };

  const handleDeleteTask = async (taskId: string) => {
    const title =
      data.tasks.find((task) => task.id === taskId)?.title ?? taskId;

    setBusyTaskId(taskId);
    setActionError(null);

    try {
      await deleteTask(creds, taskId);

      addLog(`[TASK] Deleted task: ${title}`);

      await refresh();
    } catch (err) {
      setActionError(errorMessage(err));
    }

    setBusyTaskId(null);
  };

  const handleSaveVaultReserves = async (
    reserves: AdminVaultReserves,
  ) => {
    await saveVaultReserves(creds, reserves);

    addLog(
      `[VAULT] Reserves updated: ${reserves.tonReserve} TON / ${formatZp(reserves.zpReserve)} ZP`,
    );

    await refresh();
  };

  const handleSaveEvent = async (event: AdminEventInput) => {
    await saveEvent(creds, event);
    addLog(`[EVENT] ${event.status === 'published' ? 'Saved/published' : 'Saved'} event: ${event.title}`);
    await refresh();
  };

  const handleDeleteEvent = async (eventId: string) => {
    await deleteEvent(creds, eventId);
    addLog(`[EVENT] Deleted event: ${eventId}`);
    await refresh();
  };

  const handleListEventParticipants = async (eventId: string) => {
    const participants = await listEventParticipants(creds, eventId);
    addLog(`[EVENT] Loaded ${participants.length} participant record(s) for ${eventId}`);
    return participants;
  };

  const handleFlushCache = () => {
    setIsFlushing(true);

    setTimeout(() => {
      setIsFlushing(false);

      addLog(
        `[SYS] Cache flushed successfully at ${new Date().toLocaleTimeString()}`,
      );
    }, 1000);
  };

  const handleBroadcast = (e: FormEvent) => {
    e.preventDefault();

    if (!broadcastText.trim()) return;

    addLog(`[BROADCAST] Sent: "${broadcastText}"`);

    setBroadcastText('');
  };

  const missionTitle = (id: string) =>
    data.tasks.find((task) => task.id === id)?.title ?? id;

  const statValue = (value: number) =>
    refreshing ? '...' : value.toLocaleString();

  return (
    <div className="fixed inset-0 z-50 bg-[#020503] text-neon-400 font-mono p-4 overflow-y-auto flex flex-col gap-6">
      <div className="panel flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4 border border-neon/30 bg-[#020503]/90">
        <div className="flex items-center gap-3">
          <div className="p-2 border border-neon bg-neon/10 text-neon animate-pulse">
            <Terminal size={24} />
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-neon-600">
              Autonomous Moderation Intelligence
            </p>

            <h1 className="text-xl font-display font-bold tracking-wider text-neon-300">
              ZORD OS // COMMAND & CONTROL
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 border border-neon/40 bg-neon/10 px-3 py-2 text-[10px] uppercase tracking-wider text-neon-300 transition hover:bg-neon/20 disabled:opacity-60"
          >
            <RefreshCw
              size={12}
              className={refreshing ? 'animate-spin' : ''}
            />
            Refresh Data
          </button>

          <button
            type="button"
            onClick={onClose}
            className="btn-primary flex items-center gap-2 text-xs py-2 px-4 border border-neon/50 bg-neon/10 hover:bg-neon/20 transition-all"
          >
            <ArrowLeft size={16} />
            Return to App
          </button>
        </div>
      </div>

      {actionError && (
        <p
          role="alert"
          className="border-l-2 border-red-500/60 bg-red-500/10 px-3 py-2 text-[11px] text-red-300"
        >
          {actionError}
        </p>
      )}

      {loadError && (
        <div
          role="alert"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-l-2 border-red-500/60 bg-red-500/10 px-3 py-2 text-[11px] text-red-300"
        >
          <span>Live data could not be refreshed: {loadError}</span>

          <button
            type="button"
            onClick={refresh}
            className="self-start sm:self-auto border border-red-500/50 px-2 py-1 uppercase tracking-wider hover:bg-red-500/20"
          >
            Retry
          </button>
        </div>
      )}

      <div className="flex gap-2 border-b border-neon/20 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('queue')}
          className={`px-4 py-2 text-xs uppercase tracking-wider transition-all border ${
            activeTab === 'queue'
              ? 'border-neon bg-neon/20 text-neon-300 font-bold'
              : 'border-neon/20 bg-black/40 text-neon-600 hover:text-neon-400'
          }`}
        >
          Review Queue ({data.submissions.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('stats')}
          className={`px-4 py-2 text-xs uppercase tracking-wider transition-all border ${
            activeTab === 'stats'
              ? 'border-neon bg-neon/20 text-neon-300 font-bold'
              : 'border-neon/20 bg-black/40 text-neon-600 hover:text-neon-400'
          }`}
        >
          System & Telemetry
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('tasks')}
          className={`px-4 py-2 text-xs uppercase tracking-wider transition-all border ${
            activeTab === 'tasks'
              ? 'border-neon bg-neon/20 text-neon-300 font-bold'
              : 'border-neon/20 bg-black/40 text-neon-600 hover:text-neon-400'
          }`}
        >
          Mission Control ({data.tasks.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('players')}
          className={`px-4 py-2 text-xs uppercase tracking-wider transition-all border ${
            activeTab === 'players'
              ? 'border-neon bg-neon/20 text-neon-300 font-bold'
              : 'border-neon/20 bg-black/40 text-neon-600 hover:text-neon-400'
          }`}
        >
          Players
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('events')}
          className={`px-4 py-2 text-xs uppercase tracking-wider transition-all border ${
            activeTab === 'events'
              ? 'border-neon bg-neon/20 text-neon-300 font-bold'
              : 'border-neon/20 bg-black/40 text-neon-600 hover:text-neon-400'
          }`}
        >
          Events ({data.events.length})
        </button>
      </div>

      {activeTab === 'queue' && (
        <div className="panel p-4 border border-neon/20 space-y-4">
          <div className="flex items-center justify-between border-b border-neon/20 pb-2">
            <h2 className="text-xs uppercase tracking-widest text-neon-400 font-bold flex items-center gap-2">
              <ShieldCheck size={14} />
              Creator Ops Submissions Review Queue
            </h2>
          </div>

          {refreshing ? (
            <NeonSpinner label="Syncing review queue..." />
          ) : data.submissions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ShieldCheck size={32} className="mb-3 text-neon-500" />

              <p className="font-mono text-[11px] text-neon-500">
                No pending submissions. Queue is clear.
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {data.submissions.map((sub) => (
                <li
                  key={sub.id}
                  className="panel space-y-3 p-4 border border-neon/30 bg-black/50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-xs font-bold uppercase tracking-wide text-neon-300">
                        {missionTitle(sub.mission_id)}
                      </h3>

                      <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-neon-600">
                        Operative: {sub.player_referral_code ?? 'Unknown player'} // {sub.platform}
                      </p>
                    </div>

                    <span className="shrink-0 rounded-md border border-neon/30 bg-neon/10 px-2 py-0.5 font-mono text-[10px] tabular-nums text-neon-400">
                      +{formatZp(sub.reward_zp)} ZP
                    </span>
                  </div>

                  <a
                    href={sub.link_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-lg border border-neon/20 bg-black/50 px-3 py-2 font-mono text-[11px] text-cyan-300 transition hover:border-cyan-400/40"
                  >
                    <ExternalLink size={13} className="shrink-0" />

                    <span className="truncate">{sub.link_url}</span>
                  </a>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleReview(sub, 'approved')}
                      disabled={processingId === sub.id}
                      className="btn flex-1 border-neon/70 bg-neon/15 text-neon-300 hover:bg-neon/25 py-2 flex items-center justify-center gap-1 disabled:opacity-50"
                    >
                      <Check size={14} />
                      Approve
                    </button>

                    <button
                      type="button"
                      onClick={() => handleReview(sub, 'rejected')}
                      disabled={processingId === sub.id}
                      className="btn flex-1 border-red-500/50 bg-red-500/10 text-red-300 hover:bg-red-500/20 py-2 flex items-center justify-center gap-1 disabled:opacity-50"
                    >
                      <X size={14} />
                      Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {activeTab === 'stats' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="panel p-4 border border-neon/20 bg-neon/5">
              <div className="flex items-center justify-between text-neon-500 mb-2">
                <span className="text-[11px] uppercase tracking-wider">
                  Active Operatives
                </span>
                <Users size={16} />
              </div>

              <p className="text-2xl font-display font-bold text-neon-300 tabular-nums">
                {statValue(data.stats.totalPlayers)}
              </p>

              <p className="text-[10px] text-neon-600 mt-1">
                Registered players
              </p>
            </div>

            <div className="panel p-4 border border-neon/20 bg-neon/5">
              <div className="flex items-center justify-between text-neon-500 mb-2">
                <span className="text-[11px] uppercase tracking-wider">
                  Total ZP Awarded
                </span>
                <Database size={16} />
              </div>

              <p className="text-2xl font-display font-bold text-neon-300 tabular-nums">
                {refreshing ? '...' : formatZp(data.stats.totalZp)}
              </p>

              <p className="text-[10px] text-neon-600 mt-1">
                Sum of approved mission rewards
              </p>
            </div>

            <div className="panel p-4 border border-neon/20 bg-neon/5">
              <div className="flex items-center justify-between text-neon-500 mb-2">
                <span className="text-[11px] uppercase tracking-wider">
                  Submissions
                </span>
                <Activity size={16} />
              </div>

              <p className="text-2xl font-display font-bold text-neon-300 tabular-nums">
                {statValue(data.stats.totalSubmissions)}
              </p>

              <p className="text-[10px] text-neon-600 mt-1">
                All creator submissions
              </p>
            </div>

            <div className="panel p-4 border border-neon/20 bg-neon/5">
              <div className="flex items-center justify-between text-neon-500 mb-2">
                <span className="text-[11px] uppercase tracking-wider">
                  Pending Reviews
                </span>
                <Zap size={16} />
              </div>

              <p className="text-2xl font-display font-bold text-neon-300 tabular-nums">
                {statValue(data.stats.pendingSubmissions)}
              </p>

              <p className="text-[10px] text-neon-600 mt-1">
                Awaiting approval
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <VaultReservesCard
              reserves={data.vaultReserves}
              refreshing={refreshing}
              onSave={handleSaveVaultReserves}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="panel lg:col-span-2 p-4 border border-neon/20 flex flex-col gap-3">
              <h2 className="text-xs uppercase tracking-widest text-neon-400 font-bold flex items-center gap-2 border-b border-neon/20 pb-2">
                <Activity size={14} />
                Live Audit Log & Activity Stream
              </h2>

              <div className="bg-black/60 border border-neon/10 p-3 h-44 overflow-y-auto text-[11px] flex flex-col gap-1.5 font-mono">
                {logs.map((log, idx) => (
                  <div
                    key={idx}
                    className="text-neon-400/90 border-l-2 border-neon/40 pl-2"
                  >
                    <span className="text-neon-600">
                      [{new Date().toLocaleTimeString()}]
                    </span>{' '}
                    {log}
                  </div>
                ))}
              </div>

              <form onSubmit={handleBroadcast} className="flex gap-2 mt-2">
                <input
                  type="text"
                  value={broadcastText}
                  onChange={(e) => setBroadcastText(e.target.value)}
                  placeholder="Broadcast alert to all active operatives..."
                  className="flex-1 bg-black/50 border border-neon/30 px-3 py-1.5 text-xs text-neon-300 focus:outline-none focus:border-neon"
                />

                <button
                  type="submit"
                  className="px-4 py-1.5 bg-neon/20 hover:bg-neon/30 border border-neon text-xs uppercase tracking-wider"
                >
                  <Radio size={14} className="inline mr-1" />
                  Broadcast
                </button>
              </form>
            </div>

            <div className="panel p-4 border border-neon/20 flex flex-col gap-4">
              <h2 className="text-xs uppercase tracking-widest text-neon-400 font-bold flex items-center gap-2 border-b border-neon/20 pb-2">
                <Database size={14} />
                Economy & Controls
              </h2>

              <div className="flex flex-col gap-2">
                <label className="text-[11px] text-neon-500">
                  Global Mining Multiplier (ZP/sec)
                </label>

                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0.01"
                    max="0.50"
                    step="0.01"
                    value={multiplier}
                    onChange={(e) =>
                      setMultiplier(parseFloat(e.target.value))
                    }
                    className="flex-1 accent-green-500 bg-black"
                  />

                  <span className="text-sm font-bold text-neon-300">
                    {multiplier}x
                  </span>
                </div>
              </div>

              <div className="mt-auto pt-4 border-t border-neon/20 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleFlushCache}
                  disabled={isFlushing}
                  className="py-2 px-3 bg-red-950/40 border border-red-500/40 hover:bg-red-900/40 text-red-400 text-xs uppercase tracking-wider flex items-center justify-center gap-1.5"
                >
                  <RefreshCw
                    size={12}
                    className={isFlushing ? 'animate-spin' : ''}
                  />
                  {isFlushing ? 'Flushing...' : 'Flush Cache'}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    addLog('[SYS] Exported system telemetry snapshot.')
                  }
                  className="py-2 px-3 bg-neon/10 border border-neon/40 hover:bg-neon/20 text-neon-300 text-xs uppercase tracking-wider flex items-center justify-center gap-1.5"
                >
                  <Download size={12} />
                  Export Data
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'tasks' && (
        <AdminTaskManager
          tasks={data.tasks}
          busyTaskId={busyTaskId}
          onSave={handleSaveTask}
          onDelete={handleDeleteTask}
        />
      )}

      {activeTab === 'events' && (
        <AdminEventManager
          events={data.events}
          onSave={handleSaveEvent}
          onDelete={handleDeleteEvent}
          onListParticipants={handleListEventParticipants}
        />
      )}

      {activeTab === 'players' && <AdminPlayerManager creds={creds} />}
    </div>
  );
}
