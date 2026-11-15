import { useState, FormEvent } from 'react';
import { Database, Plus, Edit2, Trash2, Loader2 } from 'lucide-react';
import Modal from '@/components/Modal';
import { formatZp } from '@/lib/format';
import { AdminApiError } from '@/lib/admin/adminApi';
import type { AdminTask, AdminTaskInput } from '@/lib/admin/adminApi';

interface AdminTaskManagerProps {
  tasks: AdminTask[];
  busyTaskId: string | null;
  onSave: (input: AdminTaskInput) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
}

export default function AdminTaskManager({ tasks, busyTaskId, onSave, onDelete }: AdminTaskManagerProps) {
  const [editingTask, setEditingTask] = useState<AdminTask | null>(null);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | AdminTask['status']>('all');
  const visibleTasks = statusFilter === 'all' ? tasks : tasks.filter((task) => task.status === statusFilter);

  const openModal = (task: AdminTask | null) => {
    setEditingTask(task);
    setIsTaskModalOpen(true);
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-[#111a14] p-4 shadow-sm space-y-4">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Database size={15} className="text-emerald-300" /> Mission Manager
          </h2>
          <p className="mt-1 text-[11px] text-slate-400">{tasks.length} mission{tasks.length === 1 ? '' : 's'} in total · Filter by visibility</p>
        </div>
        <button
          onClick={() => openModal(null)}
          className="btn-primary flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold border border-emerald-400/40 bg-emerald-400/15 text-emerald-200 hover:bg-emerald-400/20"
        >
          <Plus size={14} /> Add Mission
        </button>
      </div>

      {tasks.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label htmlFor="admin-mission-status-filter" className="text-[11px] text-slate-400">Show missions</label>
          <select id="admin-mission-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="admin-field sm:max-w-[220px]">
            <option value="all">All visibility states ({tasks.length})</option>
            <option value="published">Published ({tasks.filter((task) => task.status === 'published').length})</option>
            <option value="draft">Draft ({tasks.filter((task) => task.status === 'draft').length})</option>
            <option value="paused">Paused ({tasks.filter((task) => task.status === 'paused').length})</option>
            <option value="archived">Archived ({tasks.filter((task) => task.status === 'archived').length})</option>
          </select>
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-12 text-center">
          <Database size={24} className="mx-auto text-slate-500" />
          <p className="mt-3 text-sm font-semibold text-slate-200">No missions created yet</p>
          <p className="mt-1 text-xs text-slate-400">Create a mission to start adding activities for players.</p>
          <button type="button" onClick={() => openModal(null)} className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-400/15"><Plus size={13} className="mr-1 inline" /> Create first mission</button>
        </div>
      ) : visibleTasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 px-4 py-10 text-center">
          <p className="text-sm font-semibold text-slate-200">No {statusFilter} missions</p>
          <p className="mt-1 text-xs text-slate-400">There are no missions with this visibility state.</p>
          <button type="button" onClick={() => setStatusFilter('all')} className="mt-3 text-xs font-medium text-emerald-300 hover:text-emerald-200">Show all missions</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {visibleTasks.map((task) => (
            <div key={task.id} className="rounded-xl border border-white/10 bg-[#101a14] p-3 flex justify-between items-start">
              <div>
                <span className="text-[10px] uppercase px-1.5 py-0.5 rounded border border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
                  {task.kind}
                </span>
                <h3 className="text-xs font-bold text-emerald-300 mt-1.5">{task.title}</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">{task.description}</p>
                <p className="text-[11px] text-slate-300 font-bold mt-2">Reward: +{formatZp(task.reward)} {task.rewardCurrency}</p>
                <p className="text-[10px] text-slate-400">Access cost: {task.unlockCostZp.toLocaleString()} ZP · {task.status}</p>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => openModal(task)}
                  disabled={busyTaskId === task.id}
                  aria-label={`Edit ${task.title}`}
                  className="p-1.5 bg-emerald-400/10 hover:bg-emerald-400/15 border border-white/10 text-emerald-300 disabled:opacity-50"
                >
                  <Edit2 size={13} />
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`Delete "${task.title}"? This cannot be undone.`)) {
                      void onDelete(task.id);
                    }
                  }}
                  disabled={busyTaskId === task.id}
                  aria-label={`Delete ${task.title}`}
                  className="p-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 disabled:opacity-50"
                >
                  {busyTaskId === task.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isTaskModalOpen && (
        <TaskFormModal
          key={editingTask?.id ?? 'new'}
          task={editingTask}
          onClose={() => setIsTaskModalOpen(false)}
          onSave={onSave}
        />
      )}
    </div>
  );
}

function TaskFormModal({
  task,
  onClose,
  onSave,
}: {
  task: AdminTask | null;
  onClose: () => void;
  onSave: (input: AdminTaskInput) => Promise<void>;
}) {
  const [kind, setKind] = useState<AdminTask['kind']>(task?.kind ?? 'daily');
  const [rewardCurrency, setRewardCurrency] = useState<'ZP' | 'ZAP'>(task?.rewardCurrency ?? 'ZP');
  const [status, setStatus] = useState<AdminTask['status']>(task?.status ?? 'draft');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const platform = String(form.get('platform') ?? '');
    const actionUrl = String(form.get('actionUrl') ?? '').trim();
    const telegramChatId = String(form.get('telegramChatId') ?? '').trim();

    const input: AdminTaskInput = {
      id: task?.id,
      kind,
      title: String(form.get('title') ?? ''),
      description: String(form.get('description') ?? ''),
      reward: Number(form.get('reward')),
      platform: kind === 'creator' && (platform === 'tiktok' || platform === 'youtube') ? platform : null,
      actionUrl: actionUrl || null,
      telegramChatId: telegramChatId || null,
      rewardCurrency,
      unlockCostZp: Number(form.get('unlockCostZp') ?? 0),
      status,
      objectives: String(form.get('objectives') ?? '').split('\n').map((v) => v.trim()).filter(Boolean),
      requirements: String(form.get('requirements') ?? '').split('\n').map((v) => v.trim()).filter(Boolean),
    };
    if (!Number.isSafeInteger(input.unlockCostZp) || input.unlockCostZp < 0) {
      setError('ZP unlock cost must be a whole number of 0 or more.');
      return;
    }
    if (input.objectives.length > 50 || input.requirements.length > 50 || [...input.objectives, ...input.requirements].some((v) => v.length > 300)) {
      setError('Use up to 50 objectives and 50 requirements, each 300 characters or fewer.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onSave(input);
      onClose();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Could not save the task. Please try again.');
    }
    setSaving(false);
  };

  return (
    <Modal title={task ? 'Edit Mission' : 'Create New Mission'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-[11px] text-slate-400 uppercase">Mission name</label>
          <input name="title" defaultValue={task?.title ?? ''} required disabled={saving} placeholder="e.g. Join Telegram Channel" className="admin-field" />
        </div>
        <div>
          <label className="text-[11px] text-slate-400 uppercase">What should players know?</label>
          <input name="description" defaultValue={task?.description ?? ''} required disabled={saving} placeholder="Subscribe to our official channel" className="admin-field" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] text-slate-400 uppercase">Mission category</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as AdminTask['kind'])}
              disabled={saving}
              className="admin-field"
            >
              <option value="daily">Daily</option>
              <option value="social">Social</option>
              <option value="creator">Creator</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] text-slate-400 uppercase">Reward amount</label>
            <input type="number" name="reward" min={0} step={1} defaultValue={task?.reward ?? 100} required disabled={saving} className="admin-field" />
          </div>
          <div>
            <label className="text-[11px] text-slate-400 uppercase">Reward type</label>
            <select value={rewardCurrency} onChange={(e) => setRewardCurrency(e.target.value as 'ZP' | 'ZAP')} disabled={saving} className="admin-field"><option value="ZP">ZP</option><option value="ZAP">ZAP (configuration only)</option></select>
          </div>
          <div>
            <label className="text-[11px] text-slate-400 uppercase">ZP cost to unlock</label>
            <input type="number" name="unlockCostZp" min={0} step={1} defaultValue={task?.unlockCostZp ?? 0} required disabled={saving} className="admin-field" />
          </div>
          <div>
            <label className="text-[11px] text-slate-400 uppercase">Mission visibility</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as AdminTask['status'])} disabled={saving} className="admin-field"><option value="draft">Draft</option><option value="published">Published</option><option value="paused">Paused</option><option value="archived">Archived</option></select>
          </div>
        </div>
        {kind === 'creator' && (
          <div>
            <label className="text-[11px] text-slate-400 uppercase">Content platform</label>
            <select name="platform" defaultValue={task?.platform ?? 'tiktok'} disabled={saving} className="admin-field">
              <option value="tiktok">TikTok</option>
              <option value="youtube">YouTube</option>
            </select>
          </div>
        )}
        <div>
          <label className="text-[11px] text-slate-400 uppercase">What must the player do?</label>
          <textarea name="objectives" rows={3} defaultValue={task?.objectives.join('\n') ?? ''} disabled={saving} placeholder="Write one simple task per line. Example: Submit a ZORD video link for review." className="admin-field" />
          <p className="text-[10px] text-slate-400 mt-1">Beginner tip: use normal sentences, one task per line. You do not need JSON, code, or special formatting.</p>
        </div>
        <div>
          <label className="text-[11px] text-slate-400 uppercase">What does the player need before starting?</label>
          <textarea name="requirements" rows={3} defaultValue={task?.requirements.join('\n') ?? ''} disabled={saving} placeholder="Write one requirement per line. Example: Have access to the official ZORD Telegram channel." className="admin-field" />
          <p className="text-[10px] text-slate-400 mt-1">Beginner tip: describe the requirement in plain language, one per line. No code or JSON is needed.</p>
        </div>
        {kind === 'social' && (
          <div>
            <label className="text-[11px] text-slate-400 uppercase">Telegram chat ID (for automatic membership checks)</label>
            <input name="telegramChatId" defaultValue={task?.telegramChatId ?? ''} disabled={saving} placeholder="-1001234567890 or @publicchannel" className="admin-field" />
            <p className="text-[10px] text-slate-400 mt-1">Required for Telegram rewards. Use the channel/group ID (not the invite link). The ZORD bot must be an administrator there. Leave blank for missions that are not Telegram membership missions.</p>
          </div>
        )}
        <p className="text-[10px] text-amber-300">Reward safety: ZAP is configuration only and cannot be paid yet. ZP unlock cost is also only a setting; players are not charged. Mission rewards must not be treated as earned until the relevant activity has a trusted server-side verification and payout flow.</p>
        <div>
          <label className="text-[11px] text-slate-400 uppercase">Link for the player (optional)</label>
          <input name="actionUrl" type="url" defaultValue={task?.actionUrl ?? ''} disabled={saving} placeholder="https://t.me/..." className="admin-field" />
        </div>

        {error && (
          <p role="alert" className="text-[11px] text-red-400 border-l-2 border-red-500/50 pl-2">{error}</p>
        )}

        <button type="submit" disabled={saving} className="w-full py-2 flex items-center justify-center gap-2 bg-emerald-400/15 hover:bg-emerald-400/20 border border-emerald-400/40 text-xs uppercase tracking-wider font-bold disabled:opacity-60">
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saving ? 'Saving...' : task ? 'Save Changes' : 'Create Mission'}
        </button>
      </form>
    </Modal>
  );
}
