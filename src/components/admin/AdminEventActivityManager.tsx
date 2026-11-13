import { useEffect, useState, FormEvent } from 'react';
import { Plus, Edit2, Trash2, Loader2, Save, X, ListChecks } from 'lucide-react';
import { AdminApiError } from '@/lib/admin/adminApi';
import type { AdminEventActivity, AdminEventActivityInput, AdminEventActivityType, AdminTask } from '@/lib/admin/adminApi';

interface Props {
  eventId: string;
  missions: AdminTask[];
  onList: (eventId: string) => Promise<AdminEventActivity[]>;
  onSave: (activity: AdminEventActivityInput) => Promise<void>;
  onDelete: (eventId: string, activityId: string) => Promise<void>;
}

const TYPES: { value: AdminEventActivityType; label: string }[] = [
  { value: 'creator_submission_approved', label: 'Approved Creator Ops submission' },
  { value: 'gameplay_verification', label: 'Verified gameplay activity' },
];

const emptyDraft = (eventId: string, sortOrder: number): AdminEventActivityInput => ({
  eventId, missionId: null, activityType: 'creator_submission_approved', title: '', description: '',
  instructions: '', config: {}, isRequired: true, sortOrder,
});

export default function AdminEventActivityManager({ eventId, missions, onList, onSave, onDelete }: Props) {
  const [activities, setActivities] = useState<AdminEventActivity[]>([]);
  const [draft, setDraft] = useState<AdminEventActivityInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    try { setActivities(await onList(eventId)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load event activities.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); }, [eventId]);

  const edit = (activity?: AdminEventActivity) => {
    if (!activity) {
      const nextOrder = activities.reduce((highest, item) => Math.max(highest, item.sort_order), -1) + 1;
      setDraft(emptyDraft(eventId, nextOrder));
      return;
    }
    setDraft({
      id: activity.id, eventId, missionId: activity.mission_id,
      activityType: activity.activity_type, title: activity.title,
      description: activity.description, instructions: activity.instructions,
      config: activity.config ?? {}, isRequired: activity.is_required,
      sortOrder: activity.sort_order,
    });
  };

  const update = <K extends keyof AdminEventActivityInput>(key: K, value: AdminEventActivityInput[K]) => {
    setDraft(current => current ? { ...current, [key]: value } : current);
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!draft) return;
    if ((draft.activityType === 'mission' || draft.activityType === 'creator_submission_approved') && !draft.missionId) {
      setError('Choose the mission this activity must verify.');
      return;
    }
    if (draft.activityType === 'gameplay_verification') {
      const target = Number(draft.config.fixesPerFragmentPerDay ?? 1);
      const fragments = Array.isArray(draft.config.fragmentIds) ? draft.config.fragmentIds : ['top', 'bottom', 'left', 'right'];
      if (!Number.isInteger(target) || target < 1 || target > 100) {
        setError('Set a daily target from 1 to 100 fixes for each selected fragment.');
        return;
      }
      if (fragments.length < 1 || fragments.some(id => !['top', 'bottom', 'left', 'right'].includes(String(id)))) {
        setError('Select at least one valid fragment.');
        return;
      }
    }
    setSaving(true);
    setError('');
    try {
      await onSave({ ...draft, config: draft.activityType === 'gameplay_verification' ? {
        action: 'fragment_fixed',
        fixesPerFragmentPerDay: Number(draft.config.fixesPerFragmentPerDay ?? 1),
        fragmentIds: Array.isArray(draft.config.fragmentIds) ? draft.config.fragmentIds : ['top', 'bottom', 'left', 'right'],
      } : {} });
      setDraft(null);
      await refresh();
    } catch (err) {
      setError(err instanceof AdminApiError || err instanceof Error ? err.message : 'Could not save activity.');
    } finally { setSaving(false); }
  };

  const remove = async (activity: AdminEventActivity) => {
    if (!window.confirm(`Delete activity "${activity.title}"?`)) return;
    setBusyId(activity.id);
    setError('');
    try { await onDelete(eventId, activity.id); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not delete activity.'); }
    finally { setBusyId(null); }
  };

  return (
    <section className="border border-cyan-500/30 bg-black/40 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs uppercase tracking-wider text-cyan-300 font-bold flex items-center gap-2"><ListChecks size={14} /> Event activities</h3>
        <button type="button" onClick={() => edit()} className="flex items-center gap-1 border border-cyan-500/40 px-2 py-1 text-[10px] text-cyan-300"><Plus size={12} /> Add activity</button>
      </div>
      {error && <p role="alert" className="text-[10px] text-red-300">{error}</p>}
      {loading ? <p className="text-[10px] text-neon-500">Loading activities…</p> : activities.length === 0 ? (
        <p className="text-[10px] text-neon-600">No activities configured for this event.</p>
      ) : activities.map(activity => (
        <article key={activity.id} className="border border-neon/15 p-2 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-neon-300">{activity.title} {activity.is_required ? '(Required)' : '(Optional)'}</p>
            <p className="text-[9px] text-neon-600">{TYPES.find(t => t.value === activity.activity_type)?.label ?? activity.activity_type}{activity.mission_id ? ` · ${missions.find(m => m.id === activity.mission_id)?.title ?? activity.mission_id}` : ''}</p>
            {activity.description && <p className="text-[10px] text-neon-500">{activity.description}</p>}
          </div>
          <div className="flex gap-1">
            <button type="button" onClick={() => edit(activity)} className="border border-neon/30 p-1 text-neon-300" aria-label="Edit activity"><Edit2 size={12} /></button>
            <button type="button" onClick={() => void remove(activity)} disabled={busyId === activity.id} className="border border-red-500/30 p-1 text-red-300 disabled:opacity-50" aria-label="Delete activity">{busyId === activity.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}</button>
          </div>
        </article>
      ))}
      {draft && (
        <form onSubmit={submit} className="border border-cyan-500/25 bg-black/60 p-3 space-y-2">
          <div className="flex justify-between items-center"><p className="text-[11px] text-cyan-300 font-bold">{draft.id ? 'Edit activity' : 'New activity'}</p><button type="button" onClick={() => setDraft(null)} aria-label="Close"><X size={14} /></button></div>
          <label className="block text-[10px] text-neon-500">Activity title<input required maxLength={120} value={draft.title} onChange={e => update('title', e.target.value)} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200" /></label>
          <label className="block text-[10px] text-neon-500">Activity type<select value={draft.activityType} onChange={e => { const nextType = e.target.value as AdminEventActivityType; update('activityType', nextType); if (nextType !== 'creator_submission_approved') update('missionId', null); }} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200">{!TYPES.some(t => t.value === draft.activityType) && <option value={draft.activityType} disabled>Legacy unsupported activity</option>}{TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select><p className="mt-1 text-[9px] text-neon-600">Only Creator Ops approvals and trusted fragment actions currently have server verification. Other activity types will be enabled after their proof checks are implemented.</p></label>
          {(draft.activityType === 'mission' || draft.activityType === 'creator_submission_approved') && <label className="block text-[10px] text-neon-500">{draft.activityType === 'creator_submission_approved' ? 'Creator Ops mission to verify' : 'Mission'}<select required value={draft.missionId ?? ''} onChange={e => update('missionId', e.target.value || null)} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200"><option value="">Select a mission</option>{missions.filter(m => draft.activityType !== 'creator_submission_approved' || m.kind === 'creator').map(m => <option key={m.id} value={m.id}>{m.title} ({m.status})</option>)}</select>{draft.activityType === 'creator_submission_approved' && <p className="mt-1 text-[9px] text-neon-600">Only an approved submission for this exact Creator Ops mission can verify this activity.</p>}</label>}
          <label className="block text-[10px] text-neon-500">Description<textarea rows={2} maxLength={2000} value={draft.description} onChange={e => update('description', e.target.value)} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200" /></label>
          <label className="block text-[10px] text-neon-500">Player instructions<textarea rows={3} maxLength={5000} value={draft.instructions} onChange={e => update('instructions', e.target.value)} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200" /></label>
          {draft.activityType === 'gameplay_verification' && (
            <div className="border border-cyan-500/25 bg-cyan-500/5 p-2 space-y-2">
              <p className="text-[10px] font-bold text-cyan-200">Trusted fragment challenge</p>
              <p className="text-[9px] text-neon-500">Each selected fragment must reach this number of trusted server-recorded fixes every event day.</p>
              <label className="block text-[10px] text-neon-500">Fixes required for EACH selected fragment per day
                <input type="number" min={1} max={100} step={1} value={Number(draft.config.fixesPerFragmentPerDay ?? 1)} onChange={e => update('config', { ...draft.config, action: 'fragment_fixed', fixesPerFragmentPerDay: Number(e.target.value) })} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200" />
              </label>
              <p className="text-[9px] text-cyan-300">Example: all 4 fragments × 5 fixes = 20 successful fixes per day.</p>
              <div className="space-y-1">
                <p className="text-[10px] text-neon-500">Fragments that count</p>
                {(['top', 'bottom', 'left', 'right'] as const).map(id => {
                  const selected = Array.isArray(draft.config.fragmentIds) ? draft.config.fragmentIds as string[] : ['top', 'bottom', 'left', 'right'];
                  return <label key={id} className="flex items-center gap-2 text-[10px] text-neon-400">
                    <input type="checkbox" checked={selected.includes(id)} onChange={e => {
                      const next = e.target.checked ? [...selected, id] : selected.filter(value => value !== id);
                      update('config', { ...draft.config, action: 'fragment_fixed', fragmentIds: next });
                    }} /> {id.charAt(0).toUpperCase() + id.slice(1)}
                  </label>;
                })}
              </div>
            </div>
          )}
          <label className="flex items-center gap-2 text-[10px] text-neon-500"><input type="checkbox" checked={draft.isRequired} onChange={e => update('isRequired', e.target.checked)} /> Required activity</label>
          <div className="border border-cyan-500/20 bg-cyan-500/5 p-2 space-y-1"><p className="text-[10px] font-semibold text-cyan-200">Activities are arranged automatically</p><p className="text-[9px] text-neon-500">Players see activities in the same order you add them. You do not need to set a display order.</p><p className="text-[9px] text-amber-300">Important: adding an activity does not by itself enable automatic completion checks or reward payouts. Those checks must be connected and tested for each activity type first.</p></div>
          <button type="submit" disabled={saving} className="w-full flex items-center justify-center gap-2 border border-cyan-500/50 bg-cyan-500/10 py-2 text-xs text-cyan-200 disabled:opacity-50">{saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}{saving ? 'Saving…' : 'Save activity'}</button>
        </form>
      )}
    </section>
  );
}
