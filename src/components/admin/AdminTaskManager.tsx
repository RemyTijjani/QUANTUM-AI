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

  const openModal = (task: AdminTask | null) => {
    setEditingTask(task);
    setIsTaskModalOpen(true);
  };

  return (
    <div className="panel p-4 border border-neon/20 space-y-4">
      <div className="flex items-center justify-between border-b border-neon/20 pb-2">
        <h2 className="text-xs uppercase tracking-widest text-neon-400 font-bold flex items-center gap-2">
          <Database size={14} /> Mission Control & Task Registry
        </h2>
        <button
          onClick={() => openModal(null)}
          className="btn-primary flex items-center gap-1.5 text-xs py-1.5 px-3 border border-neon bg-neon/20"
        >
          <Plus size={14} /> Add New Task
        </button>
      </div>

      {tasks.length === 0 ? (
        <p className="py-12 text-center font-mono text-[11px] text-neon-500">No mission tasks yet. Deploy one to get started.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {tasks.map((task) => (
            <div key={task.id} className="panel p-3 border border-neon/20 bg-black/40 flex justify-between items-start">
              <div>
                <span className="text-[10px] uppercase px-1.5 py-0.5 rounded border border-neon/40 bg-neon/10 text-neon-300">
                  {task.kind}
                </span>
                <h3 className="text-xs font-bold text-neon-300 mt-1.5">{task.title}</h3>
                <p className="text-[11px] text-neon-600 mt-0.5">{task.description}</p>
                <p className="text-[11px] text-neon-400 font-bold mt-2">Reward: +{formatZp(task.reward)} {task.rewardCurrency}</p>
                <p className="text-[10px] text-neon-600">Unlock: {task.unlockCostZp.toLocaleString()} ZP · {task.status}</p>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => openModal(task)}
                  disabled={busyTaskId === task.id}
                  aria-label={`Edit ${task.title}`}
                  className="p-1.5 bg-neon/10 hover:bg-neon/20 border border-neon/30 text-neon-300 disabled:opacity-50"
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

    const input: AdminTaskInput = {
      id: task?.id,
      kind,
      title: String(form.get('title') ?? ''),
      description: String(form.get('description') ?? ''),
      reward: Number(form.get('reward')),
      platform: kind === 'creator' && (platform === 'tiktok' || platform === 'youtube') ? platform : null,
      actionUrl: actionUrl || null,
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
    <Modal title={task ? 'Edit Mission Task' : 'Create New Mission Task'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-[11px] text-neon-500 uppercase">Task Name</label>
          <input name="title" defaultValue={task?.title ?? ''} required disabled={saving} placeholder="e.g. Join Telegram Channel" className="w-full mt-1 bg-black/60 border border-neon/30 p-2 text-xs text-neon-300 disabled:opacity-50" />
        </div>
        <div>
          <label className="text-[11px] text-neon-500 uppercase">Description</label>
          <input name="description" defaultValue={task?.description ?? ''} required disabled={saving} placeholder="Subscribe to our official channel" className="w-full mt-1 bg-black/60 border border-neon/30 p-2 text-xs text-neon-300 disabled:opacity-50" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] text-neon-500 uppercase">Task Kind</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as AdminTask['kind'])}
              disabled={saving}
              className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-300 disabled:opacity-50"
            >
              <option value="daily">Daily</option>
              <option value="social">Social</option>
              <option value="creator">Creator</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] text-neon-500 uppercase">Reward amount</label>
            <input type="number" name="reward" min={0} step={1} defaultValue={task?.reward ?? 100} required disabled={saving} className="w-full mt-1 bg-black/60 border border-neon/30 p-2 text-xs text-neon-300 disabled:opacity-50" />
          </div>
          <div>
            <label className="text-[11px] text-neon-500 uppercase">Reward currency</label>
            <select value={rewardCurrency} onChange={(e) => setRewardCurrency(e.target.value as 'ZP' | 'ZAP')} disabled={saving} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-300"><option value="ZP">ZP</option><option value="ZAP">ZAP (configuration only)</option></select>
          </div>
          <div>
            <label className="text-[11px] text-neon-500 uppercase">ZP unlock cost</label>
            <input type="number" name="unlockCostZp" min={0} step={1} defaultValue={task?.unlockCostZp ?? 0} required disabled={saving} className="w-full mt-1 bg-black/60 border border-neon/30 p-2 text-xs text-neon-300 disabled:opacity-50" />
          </div>
          <div>
            <label className="text-[11px] text-neon-500 uppercase">Publication status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as AdminTask['status'])} disabled={saving} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-300"><option value="draft">Draft</option><option value="published">Published</option><option value="paused">Paused</option><option value="archived">Archived</option></select>
          </div>
        </div>
        {kind === 'creator' && (
          <div>
            <label className="text-[11px] text-neon-500 uppercase">Platform</label>
            <select name="platform" defaultValue={task?.platform ?? 'tiktok'} disabled={saving} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-300 disabled:opacity-50">
              <option value="tiktok">TikTok</option>
              <option value="youtube">YouTube</option>
            </select>
          </div>
        )}
        <div>
          <label className="text-[11px] text-neon-500 uppercase">Objectives (one per line)</label>
          <textarea name="objectives" rows={3} defaultValue={task?.objectives.join('\n') ?? ''} disabled={saving} placeholder="Submit an approved creator link" className="w-full mt-1 bg-black/60 border border-neon/30 p-2 text-xs text-neon-300 disabled:opacity-50" />
        </div>
        <div>
          <label className="text-[11px] text-neon-500 uppercase">Requirements (one per line)</label>
          <textarea name="requirements" rows={3} defaultValue={task?.requirements.join('\n') ?? ''} disabled={saving} placeholder="Telegram account required" className="w-full mt-1 bg-black/60 border border-neon/30 p-2 text-xs text-neon-300 disabled:opacity-50" />
        </div>
        <p className="text-[10px] text-amber-300">ZAP rewards are saved as configuration only; payouts are unavailable until Stage 7. Paid unlocks are not charged until secure backend unlock processing is implemented.</p>
        <div>
          <label className="text-[11px] text-neon-500 uppercase">Action URL (Optional)</label>
          <input name="actionUrl" type="url" defaultValue={task?.actionUrl ?? ''} disabled={saving} placeholder="https://t.me/..." className="w-full mt-1 bg-black/60 border border-neon/30 p-2 text-xs text-neon-300 disabled:opacity-50" />
        </div>

        {error && (
          <p role="alert" className="text-[11px] text-red-400 border-l-2 border-red-500/50 pl-2">{error}</p>
        )}

        <button type="submit" disabled={saving} className="w-full py-2 flex items-center justify-center gap-2 bg-neon/20 hover:bg-neon/30 border border-neon text-xs uppercase tracking-wider font-bold disabled:opacity-60">
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saving ? 'Saving...' : task ? 'Save Changes' : 'Deploy Task'}
        </button>
      </form>
    </Modal>
  );
}
