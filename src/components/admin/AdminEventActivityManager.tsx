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
  { value: 'mission', label: 'Complete a mission' },
  { value: 'creator_submission_approved', label: 'Approved Creator Ops submission' },
  { value: 'referral_registration', label: 'Verified referral registration' },
  { value: 'telegram_membership', label: 'Telegram membership check' },
  { value: 'gameplay_verification', label: 'Verified gameplay activity' },
  { value: 'admin_review', label: 'Administrator review' },
];

const emptyDraft = (eventId: string): AdminEventActivityInput => ({
  eventId, missionId: null, activityType: 'mission', title: '', description: '',
  instructions: '', config: {}, isRequired: true, sortOrder: 0,
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
      setDraft(emptyDraft(eventId));
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
    if (draft.activityType === 'mission' && !draft.missionId) {
      setError('Choose a mission for this activity.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({ ...draft, config: {} });
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
          <label className="block text-[10px] text-neon-500">Activity type<select value={draft.activityType} onChange={e => { const nextType = e.target.value as AdminEventActivityType; update('activityType', nextType); if (nextType !== 'mission') update('missionId', null); }} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200">{TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
          {draft.activityType === 'mission' && <label className="block text-[10px] text-neon-500">Mission<select required value={draft.missionId ?? ''} onChange={e => update('missionId', e.target.value || null)} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200"><option value="">Select a mission</option>{missions.map(m => <option key={m.id} value={m.id}>{m.title} ({m.status})</option>)}</select></label>}
          <label className="block text-[10px] text-neon-500">Description<textarea rows={2} maxLength={2000} value={draft.description} onChange={e => update('description', e.target.value)} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200" /></label>
          <label className="block text-[10px] text-neon-500">Player instructions<textarea rows={3} maxLength={5000} value={draft.instructions} onChange={e => update('instructions', e.target.value)} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-neon-500">Display order<input type="number" min={0} step={1} value={draft.sortOrder} onChange={e => update('sortOrder', Number(e.target.value))} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200" /></label>
            <label className="flex items-center gap-2 text-[10px] text-neon-500"><input type="checkbox" checked={draft.isRequired} onChange={e => update('isRequired', e.target.checked)} /> Required activity</label>
          </div>
          <div className="border border-cyan-500/20 bg-cyan-500/5 p-2 space-y-1"><p className="text-[10px] font-semibold text-cyan-200">No technical setup needed</p><p className="text-[9px] text-neon-500">Just enter the activity title, description and player instructions. ZORD saves the technical settings automatically.</p><p className="text-[9px] text-amber-300">Important: adding an activity does not by itself enable automatic completion checks or reward payouts. Those checks must be connected and tested for each activity type first.</p></div>
          <button type="submit" disabled={saving} className="w-full flex items-center justify-center gap-2 border border-cyan-500/50 bg-cyan-500/10 py-2 text-xs text-cyan-200 disabled:opacity-50">{saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}{saving ? 'Saving…' : 'Save activity'}</button>
        </form>
      )}
    </section>
  );
}
