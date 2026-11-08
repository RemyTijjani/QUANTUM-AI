import { useEffect, useState, FormEvent } from 'react';
import { Check, X, ExternalLink, Clock, ShieldCheck, RefreshCw, Terminal, Activity, Users, Database, Radio, Download, Zap, Cpu, ArrowLeft, Plus, Edit2, Trash2, Lock } from 'lucide-react';
import { MISSIONS } from '@/lib/game/config';
import { formatZp } from '@/lib/format';
import Modal from '@/components/Modal';

const ADMIN_AUTH_KEY = 'zord-admin-auth';

interface AdminSubmission {
  id: string;
  mission_id: string;
  player_referral_code: string;
  link_url: string;
  platform: 'tiktok' | 'youtube';
  status: 'pending' | 'approved' | 'rejected';
  reward_zp: number;
  reviewed_at: string | null;
  created_at: string;
}

interface AdminDashboardProps {
  onClose: () => void;
  onApproveSubmission: (rewardZp: number) => void;
}

export function AdminDashboard({ onClose, onApproveSubmission }: AdminDashboardProps) {
  const [authenticated, setAuthenticated] = useState(() => window.sessionStorage.getItem(ADMIN_AUTH_KEY) === '1');
  const [adminCreds, setAdminCreds] = useState<{ username: string; password: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'queue' | 'stats' | 'tasks'>('queue');

  const [submissions, setSubmissions] = useState<AdminSubmission[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const [stats, setStats] = useState({ totalPlayers: 0, totalSubmissions: 0, pendingSubmissions: 0, approvedSubmissions: 0 });
  const [loadingStats, setLoadingStats] = useState(false);

  const [multiplier, setMultiplier] = useState<number>(0.09);
  const [isFlushing, setIsFlushing] = useState<boolean>(false);
  const [broadcastText, setBroadcastText] = useState<string>('');
  const [logs, setLogs] = useState<string[]>([
    '[INIT] ZORD OS // COMMAND & CONTROL online.',
    '[SYS] Autonomous Moderation Intelligence cluster synced.',
    '[AUTH] Administrator credentials verified.'
  ]);

  const [tasks, setTasks] = useState(MISSIONS);
  const [editingTask, setEditingTask] = useState<any | null>(null);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);

  const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-api`;
  const headers = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
  });

  const fetchPending = async () => {
    if (!adminCreds) return;
    setLoadingQueue(true);
    try {
      const res = await fetch(functionUrl, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ action: 'fetch_pending', adminUsername: adminCreds.username, adminPassword: adminCreds.password }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setSubmissions((data.submissions ?? []) as AdminSubmission[]);
    } catch {
      setSubmissions([]);
    }
    setLoadingQueue(false);
  };

  const fetchStats = async () => {
    if (!adminCreds) return;
    setLoadingStats(true);
    try {
      const res = await fetch(functionUrl, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ action: 'fetch_stats', adminUsername: adminCreds.username, adminPassword: adminCreds.password }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setStats(data);
    } catch {
      // ignore
    }
    setLoadingStats(false);
  };

  useEffect(() => {
    if (authenticated && adminCreds) {
      fetchPending();
      fetchStats();
    }
  }, [authenticated, adminCreds]);

  const reviewSubmission = async (submission: AdminSubmission, decision: 'approved' | 'rejected') => {
    if (!adminCreds) return;
    setProcessingId(submission.id);
    try {
      const res = await fetch(functionUrl, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          action: 'review_submission',
          adminUsername: adminCreds.username,
          adminPassword: adminCreds.password,
          submissionId: submission.id,
          decision,
        }),
      });
      if (!res.ok) {
        setProcessingId(null);
        return;
      }
      const data = await res.json();

      if (decision === 'approved') {
        onApproveSubmission(data.rewardZp);
        setLogs(prev => [`[APPROVED] Mission reward +${formatZp(data.rewardZp)} ZP granted to ${data.playerReferralCode}`, ...prev]);
      } else {
        setLogs(prev => [`[REJECTED] Submission from ${submission.player_referral_code} declined.`, ...prev]);
      }

      setSubmissions((prev) => prev.filter((s) => s.id !== submission.id));
      setStats(prev => ({ ...prev, pendingSubmissions: prev.pendingSubmissions - 1 }));
    } catch {
      // ignore
    }
    setProcessingId(null);
  };

  const handleFlushCache = () => {
    setIsFlushing(true);
    setTimeout(() => {
      setIsFlushing(false);
      setLogs(prev => [`[SYS] Cache flushed successfully at ${new Date().toLocaleTimeString()}`, ...prev]);
    }, 1000);
  };

  const handleBroadcast = (e: FormEvent) => {
    e.preventDefault();
    if (!broadcastText.trim()) return;
    setLogs(prev => [`[BROADCAST] Sent: "${broadcastText}"`, ...prev]);
    setBroadcastText('');
  };

  const handleDeleteTask = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    setLogs(prev => [`[TASK] Deleted task ID: ${id}`, ...prev]);
  };

  const missionTitle = (id: string) => tasks.find((m) => m.id === id)?.title ?? id;

  if (!authenticated) {
    return (
      <AdminLogin
        onSuccess={(creds) => {
          setAdminCreds(creds);
          window.sessionStorage.setItem(ADMIN_AUTH_KEY, '1');
          setAuthenticated(true);
        }}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#020503] text-neon-400 font-mono p-4 overflow-y-auto flex flex-col gap-6">

      <div className="panel flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4 border border-neon/30 bg-[#020503]/90">
        <div className="flex items-center gap-3">
          <div className="p-2 border border-neon bg-neon/10 text-neon animate-pulse">
            <Terminal size={24} />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-neon-600">Autonomous Moderation Intelligence</p>
            <h1 className="text-xl font-display font-bold tracking-wider text-neon-300">ZORD OS // COMMAND & CONTROL</h1>
          </div>
        </div>

        <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">
          <div className="text-right hidden sm:block">
            <p className="text-[10px] text-neon-600 uppercase">Server Health</p>
            <p className="text-xs text-neon-400 font-bold flex items-center gap-1.5 justify-end">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-ping"></span> 99.98% OPTIMAL
            </p>
          </div>
          <button
            onClick={onClose}
            className="btn-primary flex items-center gap-2 text-xs py-2 px-4 border border-neon/50 bg-neon/10 hover:bg-neon/20 transition-all"
          >
            <ArrowLeft size={16} /> Return to App
          </button>
        </div>
      </div>

      <div className="flex gap-2 border-b border-neon/20 pb-2">
        <button
          onClick={() => setActiveTab('queue')}
          className={`px-4 py-2 text-xs uppercase tracking-wider transition-all border ${activeTab === 'queue' ? 'border-neon bg-neon/20 text-neon-300 font-bold' : 'border-neon/20 bg-black/40 text-neon-600 hover:text-neon-400'}`}
        >
          Review Queue ({submissions.length})
        </button>
        <button
          onClick={() => setActiveTab('stats')}
          className={`px-4 py-2 text-xs uppercase tracking-wider transition-all border ${activeTab === 'stats' ? 'border-neon bg-neon/20 text-neon-300 font-bold' : 'border-neon/20 bg-black/40 text-neon-600 hover:text-neon-400'}`}
        >
          System & Telemetry
        </button>
        <button
          onClick={() => setActiveTab('tasks')}
          className={`px-4 py-2 text-xs uppercase tracking-wider transition-all border ${activeTab === 'tasks' ? 'border-neon bg-neon/20 text-neon-300 font-bold' : 'border-neon/20 bg-black/40 text-neon-600 hover:text-neon-400'}`}
        >
          Mission Control ({tasks.length})
        </button>
      </div>

      {activeTab === 'queue' && (
        <div className="panel p-4 border border-neon/20 space-y-4">
          <div className="flex items-center justify-between border-b border-neon/20 pb-2">
            <h2 className="text-xs uppercase tracking-widest text-neon-400 font-bold flex items-center gap-2">
              <ShieldCheck size={14} /> Creator Ops Submissions Review Queue
            </h2>
            <button
              type="button"
              onClick={fetchPending}
              disabled={loadingQueue}
              className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-neon-500 transition hover:text-neon-300"
            >
              <RefreshCw size={12} className={loadingQueue ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>

          {loadingQueue ? (
            <div className="flex items-center justify-center py-12 font-mono text-[11px] text-neon-600">
              <Clock size={14} className="mr-2 animate-spin" /> Loading queue...
            </div>
          ) : submissions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ShieldCheck size={32} className="mb-3 text-neon-500" />
              <p className="font-mono text-[11px] text-neon-500">No pending submissions. Queue is clear.</p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {submissions.map((sub) => (
                <li key={sub.id} className="panel space-y-3 p-4 border border-neon/30 bg-black/50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-xs font-bold uppercase tracking-wide text-neon-300">
                        {missionTitle(sub.mission_id)}
                      </h3>
                      <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-neon-600">
                        Operative: {sub.player_referral_code} // {sub.platform}
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
                      onClick={() => reviewSubmission(sub, 'approved')}
                      disabled={processingId === sub.id}
                      className="btn flex-1 border-neon/70 bg-neon/15 text-neon-300 hover:bg-neon/25 py-2 flex items-center justify-center gap-1"
                    >
                      <Check size={14} /> Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => reviewSubmission(sub, 'rejected')}
                      disabled={processingId === sub.id}
                      className="btn flex-1 border-red-500/50 bg-red-500/10 text-red-300 hover:bg-red-500/20 py-2 flex items-center justify-center gap-1"
                    >
                      <X size={14} /> Reject
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
                <span className="text-[11px] uppercase tracking-wider">Active Operatives</span>
                <Users size={16} />
              </div>
              <p className="text-2xl font-display font-bold text-neon-300 tabular-nums">
                {loadingStats ? '...' : stats.totalPlayers.toLocaleString()}
              </p>
              <p className="text-[10px] text-neon-600 mt-1">Registered players</p>
            </div>

            <div className="panel p-4 border border-neon/20 bg-neon/5">
              <div className="flex items-center justify-between text-neon-500 mb-2">
                <span className="text-[11px] uppercase tracking-wider">Pending Reviews</span>
                <Zap size={16} />
              </div>
              <p className="text-2xl font-display font-bold text-neon-300 tabular-nums">
                {loadingStats ? '...' : stats.pendingSubmissions.toLocaleString()}
              </p>
              <p className="text-[10px] text-neon-600 mt-1">Awaiting approval</p>
            </div>

            <div className="panel p-4 border border-neon/20 bg-neon/5">
              <div className="flex items-center justify-between text-neon-500 mb-2">
                <span className="text-[11px] uppercase tracking-wider">Approved Submissions</span>
                <Check size={16} />
              </div>
              <p className="text-2xl font-display font-bold text-neon-300 tabular-nums">
                {loadingStats ? '...' : stats.approvedSubmissions.toLocaleString()}
              </p>
              <p className="text-[10px] text-neon-600 mt-1">Total approved</p>
            </div>

            <div className="panel p-4 border border-neon/20 bg-neon/5">
              <div className="flex items-center justify-between text-neon-500 mb-2">
                <span className="text-[11px] uppercase tracking-wider">System Load</span>
                <Activity size={16} />
              </div>
              <p className="text-2xl font-display font-bold text-neon-300">32.4%</p>
              <p className="text-[10px] text-neon-600 mt-1">Supabase Edge Latency: 42ms</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="panel lg:col-span-2 p-4 border border-neon/20 flex flex-col gap-3">
              <h2 className="text-xs uppercase tracking-widest text-neon-400 font-bold flex items-center gap-2 border-b border-neon/20 pb-2">
                <Activity size={14} /> Live Audit Log & Activity Stream
              </h2>
              <div className="bg-black/60 border border-neon/10 p-3 h-44 overflow-y-auto text-[11px] flex flex-col gap-1.5 font-mono">
                {logs.map((log, idx) => (
                  <div key={idx} className="text-neon-400/90 border-l-2 border-neon/40 pl-2">
                    <span className="text-neon-600">[{new Date().toLocaleTimeString()}]</span> {log}
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
                <button type="submit" className="px-4 py-1.5 bg-neon/20 hover:bg-neon/30 border border-neon text-xs uppercase tracking-wider">
                  <Radio size={14} className="inline mr-1" /> Broadcast
                </button>
              </form>
            </div>

            <div className="panel p-4 border border-neon/20 flex flex-col gap-4">
              <h2 className="text-xs uppercase tracking-widest text-neon-400 font-bold flex items-center gap-2 border-b border-neon/20 pb-2">
                <Database size={14} /> Economy & Controls
              </h2>
              <div className="flex flex-col gap-2">
                <label className="text-[11px] text-neon-500">Global Mining Multiplier (ZP/sec)</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0.01"
                    max="0.50"
                    step="0.01"
                    value={multiplier}
                    onChange={(e) => setMultiplier(parseFloat(e.target.value))}
                    className="flex-1 accent-green-500 bg-black"
                  />
                  <span className="text-sm font-bold text-neon-300">{multiplier}x</span>
                </div>
              </div>

              <div className="mt-auto pt-4 border-t border-neon/20 grid grid-cols-2 gap-2">
                <button
                  onClick={handleFlushCache}
                  disabled={isFlushing}
                  className="py-2 px-3 bg-red-950/40 border border-red-500/40 hover:bg-red-900/40 text-red-400 text-xs uppercase tracking-wider flex items-center justify-center gap-1.5"
                >
                  <RefreshCw size={12} className={isFlushing ? "animate-spin" : ""} /> {isFlushing ? 'Flushing...' : 'Flush Cache'}
                </button>
                <button
                  onClick={() => setLogs(prev => [`[SYS] Exported system telemetry snapshot.`, ...prev])}
                  className="py-2 px-3 bg-neon/10 border border-neon/40 hover:bg-neon/20 text-neon-300 text-xs uppercase tracking-wider flex items-center justify-center gap-1.5"
                >
                  <Download size={12} /> Export Data
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'tasks' && (
        <div className="panel p-4 border border-neon/20 space-y-4">
          <div className="flex items-center justify-between border-b border-neon/20 pb-2">
            <h2 className="text-xs uppercase tracking-widest text-neon-400 font-bold flex items-center gap-2">
              <Database size={14} /> Mission Control & Task Registry
            </h2>
            <button
              onClick={() => { setEditingTask(null); setIsTaskModalOpen(true); }}
              className="btn-primary flex items-center gap-1.5 text-xs py-1.5 px-3 border border-neon bg-neon/20"
            >
              <Plus size={14} /> Add New Task
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {tasks.map((task) => (
              <div key={task.id} className="panel p-3 border border-neon/20 bg-black/40 flex justify-between items-start">
                <div>
                  <span className="text-[10px] uppercase px-1.5 py-0.5 rounded border border-neon/40 bg-neon/10 text-neon-300">
                    {task.kind}
                  </span>
                  <h3 className="text-xs font-bold text-neon-300 mt-1.5">{task.title}</h3>
                  <p className="text-[11px] text-neon-600 mt-0.5">{task.description}</p>
                  <p className="text-[11px] text-neon-400 font-bold mt-2">Reward: +{formatZp(task.reward)} ZP</p>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => { setEditingTask(task); setIsTaskModalOpen(true); }}
                    className="p-1.5 bg-neon/10 hover:bg-neon/20 border border-neon/30 text-neon-300"
                  >
                    <Edit2 size={13} />
                  </button>
                  <button
                    onClick={() => handleDeleteTask(task.id)}
                    className="p-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isTaskModalOpen && (
        <Modal title={editingTask ? "Edit Mission Task" : "Create New Mission Task"} onClose={() => setIsTaskModalOpen(false)}>
          <form onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const newTask = {
              id: editingTask ? editingTask.id : `task-${Date.now()}`,
              title: formData.get('title') as string,
              description: formData.get('description') as string,
              kind: formData.get('kind') as 'daily' | 'social' | 'creator',
              reward: Number(formData.get('reward') || 100),
              actionUrl: formData.get('actionUrl') as string,
            };

            if (editingTask) {
              setTasks(prev => prev.map(t => t.id === editingTask.id ? newTask : t));
              setLogs(prev => [`[TASK] Updated task: ${newTask.title}`, ...prev]);
            } else {
              setTasks(prev => [newTask, ...prev]);
              setLogs(prev => [`[TASK] Created new task: ${newTask.title}`, ...prev]);
            }
            setIsTaskModalOpen(false);
          }} className="space-y-4">
            <div>
              <label className="text-[11px] text-neon-500 uppercase">Task ID / Slug</label>
              <input name="title" defaultValue={editingTask?.title || ''} required placeholder="e.g. Join Telegram Channel" className="w-full mt-1 bg-black/60 border border-neon/30 p-2 text-xs text-neon-300" />
            </div>
            <div>
              <label className="text-[11px] text-neon-500 uppercase">Description</label>
              <input name="description" defaultValue={editingTask?.description || ''} required placeholder="Subscribe to our official channel" className="w-full mt-1 bg-black/60 border border-neon/30 p-2 text-xs text-neon-300" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-neon-500 uppercase">Task Kind</label>
                <select name="kind" defaultValue={editingTask?.kind || 'daily'} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-300">
                  <option value="daily">Daily</option>
                  <option value="social">Social</option>
                  <option value="creator">Creator</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] text-neon-500 uppercase">Reward ZP</label>
                <input type="number" name="reward" defaultValue={editingTask?.reward || 100} required className="w-full mt-1 bg-black/60 border border-neon/30 p-2 text-xs text-neon-300" />
              </div>
            </div>
            <div>
              <label className="text-[11px] text-neon-500 uppercase">Action URL (Optional)</label>
              <input name="actionUrl" defaultValue={editingTask?.actionUrl || ''} placeholder="https://t.me/..." className="w-full mt-1 bg-black/60 border border-neon/30 p-2 text-xs text-neon-300" />
            </div>
            <button type="submit" className="w-full py-2 bg-neon/20 hover:bg-neon/30 border border-neon text-xs uppercase tracking-wider font-bold">
              {editingTask ? "Save Changes" : "Deploy Task"}
            </button>
          </form>
        </Modal>
      )}

    </div>
  );
}

function AdminLogin({ onSuccess, onClose }: { onSuccess: (creds: { username: string; password: string }) => void; onClose: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (username.trim() === 'Remytijjani' && password === 'Remytijjani656') {
      onSuccess({ username: username.trim(), password });
    } else {
      setError('Invalid credentials. Access denied.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#020503] text-neon-400 font-mono flex items-center justify-center p-4">
      <div className="panel w-full max-w-sm border border-neon/30 bg-[#020503]/95 p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 border border-neon bg-neon/10 text-neon">
            <Lock size={20} />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-neon-600">Autonomous Moderation Intelligence</p>
            <h1 className="text-base font-display font-bold tracking-wider text-neon-300">ZORD OS // ADMIN ACCESS</h1>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-[11px] text-neon-500 uppercase">Operator ID</label>
            <input
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(''); }}
              autoFocus
              required
              className="w-full mt-1 bg-black/60 border border-neon/30 p-2 text-xs text-neon-300 focus:outline-none focus:border-neon"
            />
          </div>
          <div>
            <label className="text-[11px] text-neon-500 uppercase">Access Key</label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              required
              className="w-full mt-1 bg-black/60 border border-neon/30 p-2 text-xs text-neon-300 focus:outline-none focus:border-neon"
            />
          </div>

          {error && (
            <p className="text-[11px] text-red-400 border-l-2 border-red-500/50 pl-2">{error}</p>
          )}

          <button
            type="submit"
            className="w-full py-2 bg-neon/20 hover:bg-neon/30 border border-neon text-xs uppercase tracking-wider font-bold transition"
          >
            Authenticate
          </button>
        </form>

        <button
          onClick={onClose}
          className="w-full text-center text-[10px] uppercase tracking-wider text-neon-600 hover:text-neon-400 transition"
        >
          Return to App
        </button>
      </div>
    </div>
  );
}
