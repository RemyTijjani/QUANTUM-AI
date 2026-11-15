
import { useCallback, useState } from 'react';
import {
  Check,
  X,
  ExternalLink,
  RefreshCw,
  Terminal,
  Activity,
  Users,
  Database,
  Zap,
  ArrowLeft,
  ShieldCheck,
} from 'lucide-react';

import { formatZp } from '@/lib/format';

import {
  AdminApiError,
  fetchDashboard,
  reviewSubmission,
  bulkApproveSubmissions,
  saveTask,
  deleteTask,
  saveVaultReserves,
} from '@/lib/admin/adminApi';

import type {
  AdminCredentials,
  AdminDashboardData,
  AdminSubmission,
  AdminTaskInput,
  AdminVaultReserves,
} from '@/lib/admin/adminApi';

import AdminLogin from '@/components/admin/AdminLogin';
import AdminTaskManager from '@/components/admin/AdminTaskManager';
import AdminExpeditionManager from '@/components/admin/AdminExpeditionManager';
import AdminRaffleManager from '@/components/admin/AdminRaffleManager';
import AdminPlayerManager from '@/components/admin/AdminPlayerManager';
import AdminExternalZapFunding from '@/components/admin/AdminExternalZapFunding';
import AdminExternalTonFunding from '@/components/admin/AdminExternalTonFunding';
import AdminTonWithdrawals from '@/components/admin/AdminTonWithdrawals';
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
  const [activeTab, setActiveTab] = useState<'queue' | 'stats' | 'tasks' | 'expeditions' | 'players' | 'raffles' | 'raffle-funding' | 'ton-withdrawals'>('queue');
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selectedSubmissionIds, setSelectedSubmissionIds] = useState<string[]>([]);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);


  const [logs, setLogs] = useState<string[]>([
    '[INIT] ZORD Admin Workspace online.',
    '[SYS] Administration cluster synced.',
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

  const handleBulkApprove = async () => {
    const selected = selectedSubmissionIds.filter((id) => data.submissions.some((submission) => submission.id === id));
    if (selected.length === 0 || bulkApproving) return;
    if (!window.confirm(`Approve ${selected.length} selected submission(s)? Each approved submission will receive its configured ZP reward.`)) return;

    setBulkApproving(true);
    setActionError(null);
    try {
      const result = await bulkApproveSubmissions(creds, selected);
      for (const item of result.results) {
        if (item.success) onApproveSubmission(item.rewardZp ?? 0);
      }
      addLog(`[BULK APPROVAL] ${result.approvedCount} approved; ${result.failedCount} failed. Individual Creator Ops rewards were processed by the backend.`);
      setSelectedSubmissionIds([]);
      await refresh();
      if (result.failedCount > 0) {
        setActionError(`Bulk approval finished: ${result.approvedCount} approved, ${result.failedCount} could not be approved. Refresh the queue to review remaining submissions.`);
      }
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBulkApproving(false);
    }
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

  const missionTitle = (id: string) =>
    data.tasks.find((task) => task.id === id)?.title ?? id;

  const statValue = (value: number) =>
    refreshing ? '...' : value.toLocaleString();

  return (
    <div className="fixed inset-0 z-50 box-border flex h-dvh w-full min-w-0 max-w-full flex-col overflow-hidden gap-4 bg-[#080e0a] p-3 font-sans text-slate-100 sm:p-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#111a14] p-4 shadow-xl sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-emerald-400/10 p-2 text-emerald-300">
            <Terminal size={24} />
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-400">
              Autonomous Moderation Intelligence
            </p>

            <h1 className="text-xl font-semibold tracking-tight text-white">
              ZORD OS // COMMAND & CONTROL
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/10 disabled:opacity-60"
          >
            <RefreshCw
              size={12}
              className={refreshing ? 'animate-spin' : ''}
            />
            Refresh
          </button>

          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2 text-xs font-semibold text-[#07110b] transition hover:bg-emerald-300"
          >
            <ArrowLeft size={16} />
            Return to app
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

      <aside className="w-full shrink-0 rounded-2xl border border-white/10 bg-[#111a14] p-2 md:w-60 md:p-3"><p className="hidden px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 md:block">Workspace</p><nav aria-label="Admin sections" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        <button
          type="button"
          onClick={() => setActiveTab('queue')}
          className={`flex min-h-10 shrink-0 items-center rounded-xl px-3 py-2 text-xs font-medium transition md:w-full ${
            activeTab === 'queue'
              ? 'bg-emerald-400/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/25'
              : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
          }`}
        >
          Review Queue ({data.submissions.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('stats')}
          className={`flex min-h-10 shrink-0 items-center rounded-xl px-3 py-2 text-xs font-medium transition md:w-full ${
            activeTab === 'stats'
              ? 'bg-emerald-400/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/25'
              : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
          }`}
        >
          System & Telemetry
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('tasks')}
          className={`flex min-h-10 shrink-0 items-center rounded-xl px-3 py-2 text-xs font-medium transition md:w-full ${
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
          onClick={() => setActiveTab('raffles')}
          className={`px-4 py-2 text-xs uppercase tracking-wider transition-all border ${
            activeTab === 'raffles'
              ? 'border-neon bg-neon/20 text-neon-300 font-bold'
              : 'border-neon/20 bg-black/40 text-neon-600 hover:text-neon-400'
          }`}
        >
          Raffles
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('raffle-funding')}
          className={`px-4 py-2 text-xs uppercase tracking-wider transition-all border ${
            activeTab === 'raffle-funding'
              ? 'border-neon bg-neon/20 text-neon-300 font-bold'
              : 'border-neon/20 bg-black/40 text-neon-600 hover:text-neon-400'
          }`}
        >
          Raffle Funding
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('ton-withdrawals')}
          className={`px-4 py-2 text-xs uppercase tracking-wider transition-all border ${
            activeTab === 'ton-withdrawals'
              ? 'border-neon bg-neon/20 text-neon-300 font-bold'
              : 'border-neon/20 bg-black/40 text-neon-600 hover:text-neon-400'
          }`}
        >
          Gram Withdrawals
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('expeditions')}
          className={`px-4 py-2 text-xs uppercase tracking-wider transition-all border ${
            activeTab === 'expeditions'
              ? 'border-neon bg-neon/20 text-neon-300 font-bold'
              : 'border-neon/20 bg-black/40 text-neon-600 hover:text-neon-400'
          }`}
        >
          Expeditions
        </button>


      </nav></aside><main className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-[#0d1510] p-3 sm:p-5"><div className="mb-5 border-b border-white/10 pb-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Management</p><h2 className="mt-1 text-xl font-semibold tracking-tight text-white">Admin workspace</h2><p className="mt-1 text-xs text-slate-400">Manage ZORD operations from one place.</p></div>

      {activeTab === 'queue' && (
        <div className="panel p-4 border border-neon/20 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neon/20 pb-2">
            <h2 className="text-xs uppercase tracking-widest text-neon-400 font-bold flex items-center gap-2">
              <ShieldCheck size={14} />
              Creator Ops Submissions Review Queue
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setSelectedSubmissionIds(data.submissions.slice(0, 100).map((submission) => submission.id))} disabled={data.submissions.length === 0 || bulkApproving} className="border border-neon/30 px-2 py-1 text-[10px] text-neon-300 disabled:opacity-40">Select first 100</button>
              <button type="button" onClick={() => setSelectedSubmissionIds([])} disabled={selectedSubmissionIds.length === 0 || bulkApproving} className="border border-neon/30 px-2 py-1 text-[10px] text-neon-300 disabled:opacity-40">Clear</button>
              <button type="button" onClick={() => void handleBulkApprove()} disabled={selectedSubmissionIds.length === 0 || bulkApproving || refreshing} className="border border-neon/70 bg-neon/15 px-3 py-1 text-[10px] font-bold text-neon-200 disabled:opacity-40">{bulkApproving ? 'Approving…' : `Approve selected (${selectedSubmissionIds.length})`}</button>
            </div>
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
                    <label className="flex items-center gap-2 text-[9px] text-neon-600">
                      <input type="checkbox" checked={selectedSubmissionIds.includes(sub.id)} onChange={(e) => setSelectedSubmissionIds((current) => e.target.checked ? [...current, sub.id] : current.filter((id) => id !== sub.id))} disabled={bulkApproving || processingId === sub.id} aria-label={`Select submission from ${sub.player_referral_code ?? 'player'}`} />
                      Select
                    </label>
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

              <div className="mt-2 space-y-2">
                <input
                  type="text"
                  disabled
                  placeholder="Broadcast service is not connected"
                  className="w-full cursor-not-allowed border border-neon/20 bg-black/30 px-3 py-1.5 text-xs text-neon-600 opacity-70"
                />
                <p className="text-[9px] uppercase tracking-wider text-amber-300">Broadcast delivery is unavailable until a secure server-side broadcast service is integrated.</p>
              </div>
            </div>

            <div className="panel p-4 border border-neon/20 flex flex-col gap-4">
              <h2 className="text-xs uppercase tracking-widest text-neon-400 font-bold flex items-center gap-2 border-b border-neon/20 pb-2">
                <Database size={14} />
                Economy & Controls
              </h2>

              <div className="space-y-2 border border-amber-400/20 bg-amber-400/5 p-3">
                <p className="text-[11px] text-amber-300">Global mining controls are not connected.</p>
                <p className="text-[9px] leading-relaxed text-neon-500">No client-side multiplier can change player earnings. A trusted server-side economy control is required before this setting can be enabled.</p>
              </div>

              <div className="mt-auto pt-4 border-t border-neon/20 grid grid-cols-2 gap-2">
                <button type="button" disabled className="cursor-not-allowed border border-red-500/20 bg-red-950/20 px-3 py-2 text-xs uppercase tracking-wider text-red-300/50">
                  Flush Cache · Unavailable
                </button>
                <button type="button" disabled className="cursor-not-allowed border border-neon/20 bg-neon/5 px-3 py-2 text-xs uppercase tracking-wider text-neon-600">
                  Export Data · Unavailable
                </button>
              </div>
              <p className="text-[9px] leading-relaxed text-neon-600">Cache maintenance and telemetry export are not wired to backend operations yet. These controls are intentionally disabled.</p>
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

      {activeTab === 'raffles' && <AdminRaffleManager creds={creds} />}

      {activeTab === 'raffle-funding' && (
        <div className="space-y-6">
          <AdminExternalTonFunding creds={creds} />
          <AdminExternalZapFunding creds={creds} />
        </div>
      )}

      {activeTab === 'ton-withdrawals' && <AdminTonWithdrawals creds={creds} />}

      {activeTab === 'expeditions' && (
        <AdminExpeditionManager events={data.events} creds={creds} />
      )}


      {activeTab === 'players' && <AdminPlayerManager creds={creds} />}
        </main>
      </div>
  );
}
