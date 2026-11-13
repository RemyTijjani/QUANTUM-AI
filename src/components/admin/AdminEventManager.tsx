import { useState, FormEvent } from 'react';
import { CalendarDays, Plus, Edit2, Trash2, Loader2, Save, X, Users, ListChecks } from 'lucide-react';
import { AdminApiError } from '@/lib/admin/adminApi';
import AdminEventActivityManager from './AdminEventActivityManager';
import type { AdminEvent, AdminEventInput, AdminEventParticipant, AdminEventParticipantStatus, AdminEventActivity, AdminEventActivityInput, AdminTask } from '@/lib/admin/adminApi';

interface Props {
  events: AdminEvent[];
  missions: AdminTask[];
  onListActivities: (eventId: string) => Promise<AdminEventActivity[]>;
  onSaveActivity: (activity: AdminEventActivityInput) => Promise<void>;
  onDeleteActivity: (eventId: string, activityId: string) => Promise<void>;
  onSave: (event: AdminEventInput) => Promise<void>;
  onDelete: (eventId: string) => Promise<void>;
  onListParticipants: (eventId: string) => Promise<AdminEventParticipant[]>;
  onUpdateParticipantStatus: (participationId: string, status: AdminEventParticipantStatus) => Promise<void>;
}

type Draft = {
  id?: string;
  title: string;
  description: string;
  category: AdminEventInput['category'];
  status: AdminEventInput['status'];
  startsAt: string;
  endsAt: string;
  timezone: string;
  rewardZp: string;
  rewardZap: string;
  minParticipants: string;
  maxParticipants: string;
  objectivesText: string;
  requirementsText: string;
  participationRulesText: string;
};

const localDateInput = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

const emptyDraft = (): Draft => ({
  title: '',
  description: '',
  category: 'daily',
  status: 'draft',
  startsAt: '',
  endsAt: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  rewardZp: '0',
  rewardZap: '0',
  minParticipants: '',
  maxParticipants: '',
  objectivesText: '',
  requirementsText: '',
  participationRulesText: '',
});

const toDraft = (event: AdminEvent): Draft => ({
  id: event.id,
  title: event.title,
  description: event.description,
  category: event.category,
  status: event.status,
  startsAt: localDateInput(event.starts_at),
  endsAt: localDateInput(event.ends_at),
  timezone: event.timezone,
  rewardZp: String(event.reward_zp),
  rewardZap: String(event.reward_zap ?? 0),
  minParticipants: event.min_participants == null ? '' : String(event.min_participants),
  maxParticipants: event.max_participants == null ? '' : String(event.max_participants),
  objectivesText: event.objectives.map(String).join('\n'),
  requirementsText: event.requirements.map(String).join('\n'),
  participationRulesText: event.participation_rules ?? '',
});

const dateLabel = (value: string | null) =>
  value ? new Date(value).toLocaleString() : 'Not scheduled';

const PARTICIPATION_RULE_TEMPLATES = [
  {
    value: 'standard',
    label: 'Standard event',
    text: 'Register for the event before it ends. Follow the activity instructions and complete all activities marked Required. Only activity completion confirmed by ZORD or reviewed by an administrator will count. Event rewards are issued only after completion is verified.',
  },
  {
    value: 'missions',
    label: 'Complete event missions',
    text: 'Register for this event, then complete the required missions listed in the Activities section. Follow each mission instruction. Your progress will count after the required activity has been verified.',
  },
  {
    value: 'creator',
    label: 'Creator content challenge',
    text: 'Create and submit original content featuring ZORD using the instructions in this event. Submit your content through the designated Creator Ops mission. Your submission must be reviewed and approved before it can count toward event completion.',
  },
  {
    value: 'referral',
    label: 'Referral challenge',
    text: 'Register for this event and invite others using your ZORD referral link. Only referral registrations recorded by ZORD during the event period can count. Sharing a link alone does not count as a completed referral.',
  },
  {
    value: 'community',
    label: 'Community activity',
    text: 'Join the community or channel named in the event instructions and complete the listed required activities. Follow the event instructions. Membership or activity will count only when it can be confirmed by ZORD or reviewed by an administrator.',
  },
  {
    value: 'custom',
    label: 'Write my own rules',
    text: '',
  },
] as const;

export default function AdminEventManager({ events, missions, onListActivities, onSaveActivity, onDeleteActivity, onSave, onDelete, onListParticipants, onUpdateParticipantStatus }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [participantsForEvent, setParticipantsForEvent] = useState<string | null>(null);
  const [activitiesForEvent, setActivitiesForEvent] = useState<string | null>(null);
  const [participants, setParticipants] = useState<AdminEventParticipant[]>([]);
  const [loadingParticipants, setLoadingParticipants] = useState(false);
  const [participantStatusDrafts, setParticipantStatusDrafts] = useState<Record<string, AdminEventParticipantStatus>>({});
  const [updatingParticipantId, setUpdatingParticipantId] = useState<string | null>(null);

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      const participationRules = draft.participationRulesText.trim();
      if (participationRules.length > 10000) {
        throw new Error('Participation rules must be 10,000 characters or fewer.');
      }

      const rewardZp = Number(draft.rewardZp);
      const rewardZap = Number(draft.rewardZap);
      if (!Number.isSafeInteger(rewardZp) || rewardZp < 0) {
        throw new Error('ZP reward must be a whole number of 0 or more.');
      }
      if (!Number.isSafeInteger(rewardZap) || rewardZap < 0) {
        throw new Error('ZAP reward must be a whole number of 0 or more.');
      }
      const minParticipants = draft.minParticipants.trim() ? Number(draft.minParticipants) : null;
      const maxParticipants = draft.maxParticipants.trim() ? Number(draft.maxParticipants) : null;
      if (minParticipants !== null && (!Number.isSafeInteger(minParticipants) || minParticipants < 1)) {
        throw new Error('Minimum participants must be at least 1, or leave it blank.');
      }
      if (maxParticipants !== null && (!Number.isSafeInteger(maxParticipants) || maxParticipants < 1)) {
        throw new Error('Maximum participants must be at least 1, or leave it blank.');
      }
      if (minParticipants !== null && maxParticipants !== null && minParticipants > maxParticipants) {
        throw new Error('Minimum participants cannot be greater than maximum participants.');
      }

      await onSave({
        id: draft.id,
        title: draft.title.trim(),
        description: draft.description.trim(),
        category: draft.category,
        status: draft.status,
        startsAt: draft.startsAt ? new Date(draft.startsAt).toISOString() : null,
        endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
        timezone: draft.timezone.trim() || 'UTC',
        rewardZp,
        rewardZap,
        minParticipants,
        maxParticipants,
        objectives: draft.objectivesText.split('\n').map((v) => v.trim()).filter(Boolean),
        requirements: draft.requirementsText.split('\n').map((v) => v.trim()).filter(Boolean),
        participationRules,
      });
      setDraft(null);
    } catch (err) {
      setError(err instanceof AdminApiError || err instanceof Error ? err.message : 'Could not save the event.');
    } finally {
      setSaving(false);
    }
  };

  const handleViewParticipants = async (eventId: string) => {
    setParticipantsForEvent(eventId);
    setLoadingParticipants(true);
    setError('');
    try {
      setParticipants(await onListParticipants(eventId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load event participants.');
      setParticipants([]);
    } finally {
      setLoadingParticipants(false);
    }
  };

  const handleUpdateParticipantStatus = async (participant: AdminEventParticipant) => {
    const status = participantStatusDrafts[participant.id] ?? participant.status;
    setUpdatingParticipantId(participant.id);
    setError('');
    try {
      await onUpdateParticipantStatus(participant.id, status);
      if (participantsForEvent) {
        setParticipants(await onListParticipants(participantsForEvent));
      }
      setParticipantStatusDrafts((current) => {
        const next = { ...current };
        delete next[participant.id];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update participant status.');
    } finally {
      setUpdatingParticipantId(null);
    }
  };

  const handleDelete = async (event: AdminEvent) => {
    if (!window.confirm(`Delete "${event.title}"? This cannot be undone.`)) return;
    setDeletingId(event.id);
    setError('');
    try {
      await onDelete(event.id);
      if (draft?.id === event.id) setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the event.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="panel p-4 border border-neon/20 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neon/20 pb-3">
        <div>
          <h2 className="text-xs uppercase tracking-widest text-neon-400 font-bold flex items-center gap-2">
            <CalendarDays size={14} /> Events Registry
          </h2>
          <p className="text-[10px] text-neon-600 mt-1">Create and manage daily, weekly, monthly and special events. New events are saved as drafts unless explicitly published.</p>
        </div>
        <button type="button" onClick={() => { setDraft(emptyDraft()); setError(''); }} className="btn-primary flex items-center gap-1.5 text-xs py-1.5 px-3 border border-neon bg-neon/20">
          <Plus size={14} /> Create Event
        </button>
      </div>

      {error && <p role="alert" className="text-[11px] text-red-300 border-l-2 border-red-500/60 bg-red-500/10 px-3 py-2">{error}</p>}

      {draft && (
        <form onSubmit={handleSubmit} className="border border-neon/30 bg-black/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-wider text-neon-300 font-bold">{draft.id ? 'Edit Event' : 'New Event Draft'}</h3>
            <button type="button" onClick={() => setDraft(null)} className="text-neon-600 hover:text-neon-300" aria-label="Close event form"><X size={16} /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-[10px] uppercase text-neon-500">Event title
              <input required maxLength={120} value={draft.title} onChange={(e) => update('title', e.target.value)} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200" />
            </label>
            <label className="text-[10px] uppercase text-neon-500">Category
              <select value={draft.category} onChange={(e) => update('category', e.target.value as Draft['category'])} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200">
                <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly / Genesis</option><option value="special">Special</option>
              </select>
            </label>
          </div>
          <label className="block text-[10px] uppercase text-neon-500">Description (2,000 characters max)
            <textarea maxLength={2000} value={draft.description} onChange={(e) => update('description', e.target.value)} rows={2} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200" />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="text-[10px] uppercase text-neon-500">Status
              <select value={draft.status} onChange={(e) => update('status', e.target.value as Draft['status'])} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200">
                <option value="draft">Draft</option><option value="published">Published</option><option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label className="text-[10px] uppercase text-neon-500">Reward (ZP)
              <input type="number" min="0" step="1" value={draft.rewardZp} onChange={(e) => update('rewardZp', e.target.value)} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200" />
            </label>
            <label className="text-[10px] uppercase text-neon-500">Reward (ZAP)
              <input type="number" min="0" step="1" value={draft.rewardZap} onChange={(e) => update('rewardZap', e.target.value)} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200" />
            </label>
            <label className="text-[10px] uppercase text-neon-500">Timezone (IANA)
              <input maxLength={100} value={draft.timezone} onChange={(e) => update('timezone', e.target.value)} placeholder="Africa/Lagos" className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200" />
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-[10px] uppercase text-neon-500">Minimum participants (optional)
              <input type="number" min="1" step="1" value={draft.minParticipants} onChange={(e) => update('minParticipants', e.target.value)} placeholder="No minimum" className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200" />
              <span className="block mt-1 normal-case text-neon-700">Target attendance. The event can still accept registrations below this number.</span>
            </label>
            <label className="text-[10px] uppercase text-neon-500">Maximum participants (optional)
              <input type="number" min="1" step="1" value={draft.maxParticipants} onChange={(e) => update('maxParticipants', e.target.value)} placeholder="Unlimited" className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200" />
              <span className="block mt-1 normal-case text-neon-700">Registration closes automatically when this limit is reached.</span>
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-[10px] uppercase text-neon-500">Starts (your local time)
              <input type="datetime-local" value={draft.startsAt} onChange={(e) => update('startsAt', e.target.value)} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200" />
            </label>
            <label className="text-[10px] uppercase text-neon-500">Ends (your local time)
              <input type="datetime-local" value={draft.endsAt} onChange={(e) => update('endsAt', e.target.value)} className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200" />
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-[10px] uppercase text-neon-500">Objectives (up to 50, 300 characters each)
              <textarea maxLength={15049} rows={3} value={draft.objectivesText} onChange={(e) => update('objectivesText', e.target.value)} placeholder="Complete the daily mission\nEarn 100 ZP" className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200" />
            </label>
            <label className="text-[10px] uppercase text-neon-500">Requirements (up to 50, 300 characters each)
              <textarea maxLength={15049} rows={3} value={draft.requirementsText} onChange={(e) => update('requirementsText', e.target.value)} placeholder="Telegram account required" className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200" />
            </label>
          </div>
          <div className="space-y-2">
            <label className="block text-[10px] uppercase text-neon-500">Participation rules template
              <select
                defaultValue=""
                onChange={(e) => {
                  const selected = PARTICIPATION_RULE_TEMPLATES.find((template) => template.value === e.target.value);
                  if (selected) update('participationRulesText', selected.text);
                  e.target.value = '';
                }}
                className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200"
              >
                <option value="">Choose a ready-made rules template…</option>
                {PARTICIPATION_RULE_TEMPLATES.map((template) => <option key={template.value} value={template.value}>{template.label}</option>)}
              </select>
            </label>
            <label className="block text-[10px] uppercase text-neon-500">Rules shown to players
              <textarea maxLength={10000} rows={4} value={draft.participationRulesText} onChange={(e) => update('participationRulesText', e.target.value)} placeholder="Choose a template above, or write the event rules in normal language." className="w-full mt-1 bg-black border border-neon/30 p-2 text-xs text-neon-200" />
              <span className="block mt-1 normal-case text-neon-600">Choose a ready-made template, then edit the wording if needed. No coding or JSON is required.</span>
            </label>
          </div>
          <p className="text-[10px] text-neon-600">Publishing requires both start and end times. Dates entered above are converted to UTC for storage; the timezone label is retained for display.</p>
          <button type="submit" disabled={saving} className="w-full flex items-center justify-center gap-2 py-2 bg-neon/20 border border-neon text-xs uppercase tracking-wider text-neon-200 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving...' : 'Save Event'}
          </button>
        </form>
      )}

      {events.length === 0 ? (
        <p className="py-10 text-center text-[11px] text-neon-600">No events created yet. Create a draft to configure the event calendar.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {events.map((event) => (
            <article key={event.id} className="border border-neon/20 bg-black/40 p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-xs font-bold text-neon-300">{event.title}</h3>
                  <p className="text-[10px] text-neon-600 uppercase mt-1">{event.category} · {event.timezone}</p>
                </div>
                <span className={`shrink-0 border px-2 py-0.5 text-[9px] uppercase ${event.status === 'published' ? 'border-green-500/40 text-green-300 bg-green-500/10' : event.status === 'cancelled' ? 'border-red-500/40 text-red-300 bg-red-500/10' : 'border-neon/30 text-neon-400 bg-neon/5'}`}>{event.status}</span>
              </div>
              {event.description && <p className="text-[11px] text-neon-500">{event.description}</p>}
              <p className="text-[10px] text-neon-600">{dateLabel(event.starts_at)} → {dateLabel(event.ends_at)}</p>
              <p className="text-[10px] text-neon-400">Rewards: {event.reward_zp.toLocaleString()} ZP + {event.reward_zap.toLocaleString()} ZAP · {event.objectives.length} objectives · {event.requirements.length} requirements</p>
              <p className="text-[10px] text-cyan-500">Participant limits: minimum {event.min_participants ?? "not set"} · maximum {event.max_participants ?? "unlimited"}</p>
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <button type="button" onClick={() => setActivitiesForEvent(current => current === event.id ? null : event.id)} className="flex items-center gap-1 border border-cyan-500/30 px-2 py-1 text-[10px] text-cyan-300"><ListChecks size={12} /> Activities</button>
                <button type="button" onClick={() => void handleViewParticipants(event.id)} className="flex items-center gap-1 border border-cyan-500/30 px-2 py-1 text-[10px] text-cyan-300"><Users size={12} /> Participants</button>
                <button type="button" onClick={() => { setDraft(toDraft(event)); setError(''); }} className="flex items-center gap-1 border border-neon/30 px-2 py-1 text-[10px] text-neon-300"><Edit2 size={12} /> Edit</button>
                <button type="button" disabled={deletingId === event.id} onClick={() => void handleDelete(event)} className="flex items-center gap-1 border border-red-500/30 px-2 py-1 text-[10px] text-red-300 disabled:opacity-50">{deletingId === event.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {activitiesForEvent && (
        <AdminEventActivityManager
          eventId={activitiesForEvent}
          missions={missions}
          onList={onListActivities}
          onSave={onSaveActivity}
          onDelete={onDeleteActivity}
        />
      )}

      {participantsForEvent && (
        <section className="border border-cyan-500/30 bg-black/50 p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-300">Event participants · {events.find((event) => event.id === participantsForEvent)?.title ?? 'Selected event'}</h3>
            <p className="text-[10px] text-cyan-600">{participants.filter((participant) => participant.status !== 'withdrawn').length} active registrations · minimum {events.find((event) => event.id === participantsForEvent)?.min_participants ?? 'not set'} · maximum {events.find((event) => event.id === participantsForEvent)?.max_participants ?? 'unlimited'}</p>
            <button type="button" onClick={() => setParticipantsForEvent(null)} className="text-[10px] text-neon-500">Close</button>
          </div>
          {loadingParticipants ? (
            <p className="py-4 text-center text-[10px] text-neon-500">Loading participant records…</p>
          ) : participants.length === 0 ? (
            <p className="py-4 text-center text-[10px] text-neon-600">No players have registered for this event yet.</p>
          ) : (
            <div className="space-y-2">
              {participants.map((participant) => (
                <article key={participant.id} className="flex flex-wrap items-center justify-between gap-2 border border-neon/15 p-2">
                  <div>
                    <p className="text-[10px] text-neon-300">{participant.players.first_name ?? participant.players.username ?? 'Player'} {participant.players.username ? `(@${participant.players.username})` : ''}</p>
                    <p className="text-[9px] text-neon-700">{participant.players.referral_code} · Telegram {participant.players.telegram_id}</p>
                    <p className="text-[9px] text-neon-700">Registered {new Date(participant.registered_at).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      aria-label={`Status for ${participant.players.username ?? participant.players.first_name ?? 'participant'}`}
                      value={participantStatusDrafts[participant.id] ?? participant.status}
                      onChange={(e) => setParticipantStatusDrafts((current) => ({ ...current, [participant.id]: e.target.value as AdminEventParticipantStatus }))}
                      className="border border-neon/20 bg-black px-2 py-1 text-[9px] uppercase text-neon-300"
                    >
                      <option value="registered">Registered</option>
                      <option value="in_progress">In progress</option>
                      <option value="submitted">Submitted</option>
                      <option value="completed">Completed</option>
                      <option value="withdrawn">Withdrawn</option>
                    </select>
                    <button
                      type="button"
                      disabled={updatingParticipantId === participant.id || (participantStatusDrafts[participant.id] ?? participant.status) === participant.status}
                      onClick={() => void handleUpdateParticipantStatus(participant)}
                      className="border border-cyan-500/30 px-2 py-1 text-[9px] text-cyan-300 disabled:opacity-40"
                    >
                      {updatingParticipantId === participant.id ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          <p className="text-[9px] text-neon-700">Statuses are administrator-reviewed only. No objective telemetry or ZP/ZAP rewards are issued by this control.</p>
        </section>
      )}
    </section>
  );
}
