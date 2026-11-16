
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
  LayoutDashboard,
  ClipboardCheck,
  ListTodo,
  Ticket,
  Wallet,
  ArrowDownToLine,
  Compass,
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
import AdminReferralManager from '@/components/admin/AdminReferralManager';
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
  const [activeTab, setActiveTab] = useState<'queue' | 'stats' | 'tasks' | 'expeditions' | 'players' | 'raffles' | 'raffle-funding' | 'ton-withdrawals' | 'referrals'>('queue');
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selectedSubmissionIds, setSelectedSubmissionIds] = useState<string[]>([]);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);


  const [logs, setLogs] = useState<{ message: string; createdAt: string }[]>([]);

  const addLog = (message: string) => setLogs((prev) => [
    { message, createdAt: new Date().toISOString() },
    ...prev,
  ]);

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
      `[VAULT] Reserves updated: ${reserves.tonReserve} Gram / ${formatZp(reserves.zpReserve)} ZP`,
    );

    await refresh();
  };

  const missionTitle = (id: string) =>
    data.tasks.find((task) => task.id === id)?.title ?? id;

  const statValue = (value: number) =>
    refreshing ? '...' : value.toLocaleString();

  const navGroups = [
    { label: 'Overview', items: [{ id: 'stats', label: 'Overview', icon: LayoutDashboard }] },
    { label: 'Review & build', items: [
      { id: 'queue', label: 'Review queue', icon: ClipboardCheck, count: data.submissions.length },
      { id: 'tasks', label: 'Task manager', icon: ListTodo, count: data.tasks.length },
      { id: 'expeditions', label: 'Expeditions', icon: Compass },
      { id: 'raffles', label: 'Raffles', icon: Ticket },
    ] },
    { label: 'Players & funds', items: [
      { id: 'players', label: 'Players', icon: Users },
      { id: 'referrals', label: 'Referrals', icon: Users },
      { id: 'raffle-funding', label: 'Raffle funding', icon: Wallet },
      { id: 'ton-withdrawals', label: 'GRAM withdrawals', icon: ArrowDownToLine },
    ] },
  ] as const;

  const overviewActions = [
    { tab: 'queue', title: 'Review submissions', description: 'Check evidence and approve or reject pending work.', icon: ClipboardCheck, detail: `${data.stats.pendingSubmissions} awaiting review` },
    { tab: 'tasks', title: 'Manage missions', description: 'Create, update and organize player tasks.', icon: ListTodo, detail: `${data.tasks.length} configured tasks` },
    { tab: 'players', title: 'Manage players', description: 'Find player profiles and inspect account activity.', icon: Users },
    { tab: 'referrals', title: 'Manage referrals', description: 'Set the monthly kickback budget, review allocations and manage referral accounts.', icon: Users },
    { tab: 'expeditions', title: 'Manage Expeditions', description: 'Publish events, review objectives and issue eligible rewards.', icon: Compass },
    { tab: 'raffles', title: 'Manage Raffles', description: 'Configure raffles and review their prize setup.', icon: Ticket },
    { tab: 'raffle-funding', title: 'Manage funding', description: 'Review external prize funding records.', icon: Wallet },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 box-border flex h-dvh w-full min-w-0 max-w-full flex-col overflow-hidden gap-2 bg-[#080e0a] p-2 font-sans text-slate-100 sm:gap-4 sm:p-5">
      <div className="flex shrink-0 flex-col gap-2 rounded-xl border border-white/10 bg-[#111a14] p-3 shadow-xl sm:gap-3 sm:rounded-2xl sm:p-4 sm:flex-row sm:items-center sm:justify-between">
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

      <aside className="w-full shrink-0 rounded-xl border border-white/10 bg-[#111a14] p-1.5 sm:rounded-2xl sm:p-2 md:w-60 md:p-3">
        <p className="hidden px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 md:block">Admin workspace</p>
        <nav aria-label="Admin sections" className="no-scrollbar flex flex-nowrap items-center gap-1 overflow-x-auto overscroll-x-contain md:flex-col md:items-stretch md:gap-3 md:overflow-visible">
          {navGroups.map((group) => (
            <div key={group.label} className="contents md:flex md:shrink-0 md:flex-col md:gap-1">
              <p className="hidden px-3 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500 md:block">{group.label}</p>
              {group.items.map((item) => {
                const Icon = item.icon;
                const selected = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    aria-current={selected ? 'page' : undefined}
                    className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-medium transition sm:min-h-10 sm:gap-2 sm:rounded-xl sm:px-3 sm:py-2 sm:text-xs md:w-full ${
                      selected
                        ? 'border-emerald-400/30 bg-emerald-400/15 text-emerald-300'
                        : 'border-transparent text-slate-400 hover:border-white/10 hover:bg-white/5 hover:text-slate-100'
                    }`}
                  >
                    <Icon size={15} className="shrink-0" />
                    <span className="whitespace-nowrap">{item.label}</span>
                    {'count' in item && (
                      <span className={`ml-auto rounded-md px-1.5 py-0.5 text-[10px] tabular-nums ${
                        selected ? 'bg-emerald-300/15 text-emerald-200' : 'bg-white/5 text-slate-400'
                      }`}>{item.count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside><main className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-xl border border-white/10 bg-[#0d1510] p-3 sm:rounded-2xl sm:p-5"><div className="mb-4 border-b border-white/10 pb-3 sm:mb-5 sm:pb-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Management</p><h2 className="mt-1 text-xl font-semibold tracking-tight text-white">{{ queue: 'Review queue', stats: 'Overview', tasks: 'Task manager', players: 'Player management', raffles: 'Raffle management', 'raffle-funding': 'Raffle funding', 'ton-withdrawals': 'Gram withdrawals', referrals: 'Referral management', expeditions: 'Expeditions' }[activeTab]}</h2><p className="mt-1 text-xs text-slate-400">Manage ZORD operations from one place.</p></div>

      {activeTab === 'queue' && (
        <div className="rounded-2xl border border-white/10 bg-[#111a14] p-4 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-2">
            <h2 className="text-xs uppercase tracking-widest text-slate-300 font-bold flex items-center gap-2">
              <ShieldCheck size={14} />
              Creator Ops Submissions Review Queue
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setSelectedSubmissionIds(data.submissions.slice(0, 100).map((submission) => submission.id))} disabled={data.submissions.length === 0 || bulkApproving} className="border border-white/10 px-2 py-1 text-[10px] text-emerald-300 disabled:opacity-40">Select first 100</button>
              <button type="button" onClick={() => setSelectedSubmissionIds([])} disabled={selectedSubmissionIds.length === 0 || bulkApproving} className="border border-white/10 px-2 py-1 text-[10px] text-emerald-300 disabled:opacity-40">Clear</button>
              <button type="button" onClick={() => void handleBulkApprove()} disabled={selectedSubmissionIds.length === 0 || bulkApproving || refreshing} className="border border-emerald-400/50 bg-emerald-400/10 px-3 py-1 text-[10px] font-bold text-slate-100 disabled:opacity-40">{bulkApproving ? 'Approving…' : `Approve selected (${selectedSubmissionIds.length})`}</button>
            </div>
          </div>

          {refreshing ? (
            <NeonSpinner label="Syncing review queue..." />
          ) : data.submissions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ShieldCheck size={32} className="mb-3 text-slate-400" />

              <p className="font-mono text-[11px] text-slate-400">
                No pending submissions. Queue is clear.
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {data.submissions.map((sub) => (
                <li
                  key={sub.id}
                  className="rounded-xl border border-white/10 bg-[#101a14] p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <label className="flex items-center gap-2 text-[9px] text-slate-400">
                      <input type="checkbox" checked={selectedSubmissionIds.includes(sub.id)} onChange={(e) => setSelectedSubmissionIds((current) => e.target.checked ? [...current, sub.id] : current.filter((id) => id !== sub.id))} disabled={bulkApproving || processingId === sub.id} aria-label={`Select submission from ${sub.player_referral_code ?? 'player'}`} />
                      Select
                    </label>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-xs font-bold uppercase tracking-wide text-emerald-300">
                        {missionTitle(sub.mission_id)}
                      </h3>

                      <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                        Operative: {sub.player_referral_code ?? 'Unknown player'} // {sub.platform}
                      </p>
                    </div>

                    <span className="shrink-0 rounded-md border border-white/10 bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] tabular-nums text-slate-300">
                      +{formatZp(sub.reward_zp)} ZP
                    </span>
                  </div>

                  <a
                    href={sub.link_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#0b120e] px-3 py-2 font-mono text-[11px] text-cyan-300 transition hover:border-cyan-400/40"
                  >
                    <ExternalLink size={13} className="shrink-0" />

                    <span className="truncate">{sub.link_url}</span>
                  </a>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleReview(sub, 'approved')}
                      disabled={processingId === sub.id}
                      className="btn flex-1 border-emerald-400/50 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/15 py-2 flex items-center justify-center gap-1 disabled:opacity-50"
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
            <div className="rounded-2xl border border-white/10 bg-[#111a14] p-4 shadow-sm">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-[11px] uppercase tracking-wider">
                  Registered players
                </span>
                <Users size={16} />
              </div>

              <p className="text-2xl font-display font-bold text-emerald-300 tabular-nums">
                {statValue(data.stats.totalPlayers)}
              </p>

              <p className="text-[10px] text-slate-400 mt-1">
                Registered players
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#111a14] p-4 shadow-sm">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-[11px] uppercase tracking-wider">
                  Total ZP Awarded
                </span>
                <Database size={16} />
              </div>

              <p className="text-2xl font-display font-bold text-emerald-300 tabular-nums">
                {refreshing ? '...' : formatZp(data.stats.totalZp)}
              </p>

              <p className="text-[10px] text-slate-400 mt-1">
                Sum of approved mission rewards
              </p>
            </div>

            <div className="panel p-4 border border-white/10 bg-emerald-400/5">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-[11px] uppercase tracking-wider">
                  Submissions
                </span>
                <Activity size={16} />
              </div>

              <p className="text-2xl font-display font-bold text-emerald-300 tabular-nums">
                {statValue(data.stats.totalSubmissions)}
              </p>

              <p className="text-[10px] text-slate-400 mt-1">
                All creator submissions
              </p>
            </div>

            <div className="panel p-4 border border-white/10 bg-emerald-400/5">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-[11px] uppercase tracking-wider">
                  Pending Reviews
                </span>
                <Zap size={16} />
              </div>

              <p className="text-2xl font-display font-bold text-emerald-300 tabular-nums">
                {statValue(data.stats.pendingSubmissions)}
              </p>

              <p className="text-[10px] text-slate-400 mt-1">
                Awaiting approval
              </p>
            </div>
          </div>

          <section aria-labelledby="overview-actions-title" className="space-y-3">
            <div>
              <h2 id="overview-actions-title" className="text-sm font-semibold text-white">Quick access</h2>
              <p className="mt-1 text-xs text-slate-400">Jump straight to the areas you manage most often.</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {overviewActions.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.tab}
                    type="button"
                    onClick={() => setActiveTab(item.tab)}
                    className="group flex min-h-28 items-start gap-3 rounded-2xl border border-white/10 bg-[#111a14] p-4 text-left transition hover:border-emerald-400/30 hover:bg-emerald-400/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                  >
                    <span className="rounded-xl bg-emerald-400/10 p-2 text-emerald-300">
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-100 group-hover:text-emerald-200">{item.title}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-slate-400">{item.description}</span>
                      {'detail' in item && <span className="mt-2 block text-[10px] font-medium text-emerald-300">{item.detail}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <VaultReservesCard
              reserves={data.vaultReserves}
              refreshing={refreshing}
              onSave={handleSaveVaultReserves}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="rounded-2xl border border-white/10 bg-[#111a14] lg:col-span-2 p-4 flex flex-col gap-3">
              <h2 className="text-xs uppercase tracking-widest text-slate-300 font-bold flex items-center gap-2 border-b border-white/10 pb-2">
                <Activity size={14} />
                Admin Session Activity
              </h2>

              <p className="text-[10px] text-slate-400">Successful actions performed since this dashboard was opened. This is a session-only display, not a historical audit record.</p>
              <div className="bg-[#080e0a] border border-white/10 p-3 h-44 overflow-y-auto text-[11px] flex flex-col gap-1.5 font-mono">
                {logs.length === 0 ? (
                  <p className="py-3 text-center text-slate-500">
                    No admin actions yet in this session. Completed actions will appear here.
                  </p>
                ) : logs.map((log, idx) => (
                  <div
                    key={`${log.createdAt}-${idx}`}
                    className="text-slate-300/90 border-l-2 border-emerald-400/30 pl-2"
                  >
                    <span className="text-slate-400">
                      [{new Date(log.createdAt).toLocaleTimeString()}]
                    </span>{' '}
                    {log.message}
                  </div>
                ))}
              </div>

              <div className="mt-2 space-y-2">
                <input
                  type="text"
                  disabled
                  placeholder="Broadcast service is not connected"
                  className="w-full cursor-not-allowed border border-white/10 bg-[#101a14] px-3 py-1.5 text-xs text-slate-400 opacity-70"
                />
                <p className="text-[9px] uppercase tracking-wider text-amber-300">Broadcast delivery is unavailable until a secure server-side broadcast service is integrated.</p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#111a14] p-4 flex flex-col gap-4">
              <h2 className="text-xs uppercase tracking-widest text-slate-300 font-bold flex items-center gap-2 border-b border-white/10 pb-2">
                <Database size={14} />
                Economy & Controls
              </h2>

              <div className="space-y-2 border border-amber-400/20 bg-amber-400/5 p-3">
                <p className="text-[11px] text-amber-300">Global mining controls are not connected.</p>
                <p className="text-[9px] leading-relaxed text-slate-400">No client-side multiplier can change player earnings. A trusted server-side economy control is required before this setting can be enabled.</p>
              </div>

              <div className="mt-auto pt-4 border-t border-white/10 grid grid-cols-2 gap-2">
                <button type="button" disabled className="cursor-not-allowed border border-red-500/20 bg-red-950/20 px-3 py-2 text-xs uppercase tracking-wider text-red-300/50">
                  Flush Cache · Unavailable
                </button>
                <button type="button" disabled className="cursor-not-allowed border border-white/10 bg-emerald-400/5 px-3 py-2 text-xs uppercase tracking-wider text-slate-400">
                  Export Data · Unavailable
                </button>
              </div>
              <p className="text-[9px] leading-relaxed text-slate-400">Cache maintenance and telemetry export are not wired to backend operations yet. These controls are intentionally disabled.</p>
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
      {activeTab === 'referrals' && <AdminReferralManager creds={creds} />
        </main>
      </div>
  );
}
