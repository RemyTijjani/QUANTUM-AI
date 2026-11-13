import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Clock3, Trophy, Sparkles, RefreshCw, UserPlus, CheckCircle2, ListChecks, ExternalLink } from 'lucide-react';
import { EventsApiError, fetchPublishedEvents } from '@/lib/events/eventsApi';
import type { PublicGameEvent, EventRegistration } from '@/lib/events/eventsApi';
import { fetchMyEventRegistrations, registerForEvent } from '@/lib/events/eventsApi';

type EventCategory = 'Daily' | 'Weekly' | 'Monthly' | 'Special';

const categories: { label: EventCategory; description: string; icon: typeof CalendarDays }[] = [
  { label: 'Daily', description: 'Short activities and daily participation.', icon: Clock3 },
  { label: 'Weekly', description: 'Community competitions and weekly rankings.', icon: Trophy },
  { label: 'Monthly', description: 'Genesis events and milestone challenges.', icon: CalendarDays },
  { label: 'Special', description: 'Limited-time events announced by the team.', icon: Sparkles },
];

const categoryLabel: Record<PublicGameEvent['category'], EventCategory> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  special: 'Special',
};

function eventDate(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Schedule unavailable';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function EventCard({ event, now, registration, registering, expanded, onRegister, onToggle }: { event: PublicGameEvent; now: number; registration?: EventRegistration; registering: boolean; expanded: boolean; onRegister: (eventId: string) => void; onToggle: (eventId: string) => void }) {
  const registered = !!registration;
  const startsAt = new Date(event.starts_at).getTime();
  const isActive = startsAt <= now;
  const dateRange = `${eventDate(event.starts_at, event.timezone)} – ${eventDate(event.ends_at, event.timezone)}`;

  return (
    <article className="panel space-y-3 border border-neon/25 bg-black/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="font-mono text-[9px] uppercase tracking-widest text-neon-600">
            {categoryLabel[event.category]} event
          </span>
          <h3 className="mt-1 break-words font-display text-sm font-bold text-neon-300">{event.title}</h3>
        </div>
        <span className={`shrink-0 border px-2 py-1 font-mono text-[9px] uppercase tracking-wider ${isActive ? 'border-green-500/40 bg-green-500/10 text-green-300' : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'}`}>
          {isActive ? 'Active' : 'Upcoming'}
        </span>
      </div>

      {event.description && (
        <p className="font-mono text-[10px] leading-relaxed text-neon-600">{event.description}</p>
      )}

      <div className="flex items-start gap-2 font-mono text-[10px] text-neon-500">
        <CalendarDays size={13} className="mt-0.5 shrink-0" />
        <span>{dateRange} ({event.timezone})</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="border border-neon/20 bg-neon/5 px-2 py-1 font-mono text-[10px] text-neon-300">
          {event.reward_zp.toLocaleString()} ZP configured
        </span>
        {event.reward_zap > 0 && (
          <span className="border border-cyan-500/20 bg-cyan-500/5 px-2 py-1 font-mono text-[10px] text-cyan-300">
            {event.reward_zap.toLocaleString()} ZAP configured
          </span>
        )}
      </div>
      {(event.min_participants !== null || event.max_participants !== null) && (
        <p className="font-mono text-[10px] text-cyan-500">
          {event.min_participants !== null ? `Minimum target: ${event.min_participants}` : 'No minimum target'}
          {' · '}
          {event.max_participants !== null ? `Maximum: ${event.max_participants} participants` : 'No participant cap'}
        </p>
      )}

      {event.objectives.length > 0 && (
        <div>
          <h4 className="font-mono text-[9px] uppercase tracking-widest text-neon-500">Objectives</h4>
          <ul className="mt-1 list-disc space-y-1 pl-4 font-mono text-[10px] text-neon-600">
            {event.objectives.map((objective, index) => (
              <li key={index}>{String(objective)}</li>
            ))}
          </ul>
        </div>
      )}

      {event.participation_rules.trim().length > 0 && (
        <div>
          <h4 className="font-mono text-[9px] uppercase tracking-widest text-neon-500">Participation rules</h4>
          <p className="mt-1 whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-neon-600">{event.participation_rules}</p>
        </div>
      )}

      {event.requirements.length > 0 && (
        <div>
          <h4 className="font-mono text-[9px] uppercase tracking-widest text-neon-500">Requirements</h4>
          <ul className="mt-1 list-disc space-y-1 pl-4 font-mono text-[10px] text-neon-600">
            {event.requirements.map((requirement, index) => (
              <li key={index}>{String(requirement)}</li>
            ))}
          </ul>
        </div>
      )}

      {registered ? (
        <button
          type="button"
          onClick={() => onToggle(event.id)}
          className="inline-flex w-full items-center justify-center gap-2 border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-cyan-300"
        >
          <ListChecks size={13} /> {expanded ? 'Hide activities' : 'Continue event'}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onRegister(event.id)}
          disabled={registering || new Date(event.ends_at).getTime() <= now}
          className="inline-flex w-full items-center justify-center gap-2 border border-neon/40 bg-neon/10 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-neon-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <UserPlus size={13} /> {registering ? 'Registering…' : 'Join event'}
        </button>
      )}

      {registered && expanded && registration && (
        <div className="space-y-2 border-t border-neon/20 pt-3">
          <h4 className="font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-300">Your event activities</h4>
          {registration.activities.length === 0 ? (
            <p className="font-mono text-[10px] text-neon-600">The event organizer has not added any activities yet.</p>
          ) : registration.activities.map((activity) => (
            <div key={activity.id} className="space-y-2 border border-neon/15 bg-black/30 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-mono text-[10px] font-bold text-neon-300">{activity.title}</p>
                <span className={`shrink-0 border px-2 py-1 font-mono text-[8px] uppercase ${activity.verification === 'verified' ? 'border-green-500/40 text-green-300' : 'border-amber-500/30 text-amber-300'}`}>
                  {activity.verification === 'verified' ? 'Verified' : 'Awaiting verification'}
                </span>
              </div>
              <p className="font-mono text-[9px] text-neon-600">{activity.is_required ? 'Required activity' : 'Optional activity'}</p>
              {activity.description && <p className="font-mono text-[10px] leading-relaxed text-neon-500">{activity.description}</p>}
              {activity.instructions && <p className="whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-neon-500">{activity.instructions}</p>}
              {activity.mission && (
                <div className="border-l border-cyan-500/30 pl-2">
                  <p className="font-mono text-[10px] text-cyan-300">Mission: {activity.mission.title}</p>
                  {activity.mission.description && <p className="font-mono text-[9px] text-neon-600">{activity.mission.description}</p>}
                  {activity.mission.action_url && (
                    <a href={activity.mission.action_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-mono text-[9px] text-cyan-300 underline">
                      Open mission link <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
          <p className="font-mono text-[9px] leading-relaxed text-neon-700">Joining an event does not complete its activities. ZORD updates verification only when qualifying evidence is confirmed.</p>
        </div>
      )}
    </article>
  );
}

export default function EventsTab() {
  const [events, setEvents] = useState<PublicGameEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [registrations, setRegistrations] = useState<EventRegistration[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [registeringId, setRegisteringId] = useState<string | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setEvents(await fetchPublishedEvents());
      setFetchedAt(Date.now());
    } catch (err) {
      setError(err instanceof EventsApiError ? err.message : 'Could not load events. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRegistrations = useCallback(async () => {
    setHistoryError('');
    try {
      setRegistrations(await fetchMyEventRegistrations());
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Could not load your event history.');
    }
  }, []);

  const handleRegister = useCallback(async (eventId: string) => {
    setRegisteringId(eventId);
    setError('');
    try {
      await registerForEvent(eventId);
      await loadRegistrations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not register for this event.');
    } finally {
      setRegisteringId(null);
    }
  }, [loadRegistrations]);

  useEffect(() => {
    void loadEvents();
    void loadRegistrations();
  }, [loadEvents, loadRegistrations]);

  const now = fetchedAt ?? Date.now();
  const activeAndUpcoming = events.filter((event) => new Date(event.ends_at).getTime() > now);

  return (
    <div className="space-y-5 pb-4">
      <header className="panel border border-neon/30 bg-neon/5 p-4">
        <div className="flex items-center gap-2 text-neon-400">
          <CalendarDays size={18} />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">Community calendar</span>
        </div>
        <h1 className="mt-2 font-display text-xl font-bold tracking-wider text-neon-300">Events Hub</h1>
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-neon-600">
          Discover published events, review their objectives and track their schedules and configured rewards.
        </p>
      </header>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-neon-400">Event channels</h2>
          <button type="button" onClick={() => { void loadEvents(); void loadRegistrations(); }} disabled={loading} className="inline-flex items-center gap-1.5 border border-neon/30 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-neon-400 disabled:opacity-50">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {categories.map(({ label, description, icon: Icon }) => {
            const count = activeAndUpcoming.filter((event) => categoryLabel[event.category] === label).length;
            return (
              <article key={label} className="panel min-h-28 border border-neon/20 bg-black/40 p-3">
                <Icon size={17} className="text-neon-400" />
                <h3 className="mt-2 font-mono text-[11px] font-bold uppercase tracking-wider text-neon-300">{label} Events</h3>
                <p className="mt-1 font-mono text-[10px] leading-relaxed text-neon-700">{description}</p>
                <p className="mt-2 font-mono text-[10px] text-neon-500">{count} published</p>
              </article>
            );
          })}
        </div>
      </section>

      {error && (
        <div role="alert" className="border-l-2 border-red-500/60 bg-red-500/10 px-3 py-2 font-mono text-[10px] text-red-300">
          {error}
          <button type="button" onClick={() => void loadEvents()} className="ml-2 underline">Try again</button>
        </div>
      )}

      <section className="panel space-y-3 border border-neon/20 bg-black/40 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-neon-400">Active & upcoming</h2>
          <span className="font-mono text-[9px] uppercase text-neon-700">Published feed</span>
        </div>
        {loading ? (
          <div className="py-8 text-center font-mono text-[10px] text-neon-500">Loading published events…</div>
        ) : activeAndUpcoming.length === 0 ? (
          <div className="flex flex-col items-center py-9 text-center">
            <CalendarDays size={28} className="text-neon-700" />
            <p className="mt-3 font-mono text-[11px] text-neon-500">No active or upcoming events.</p>
            <p className="mt-1 max-w-xs font-mono text-[10px] leading-relaxed text-neon-700">
              Published events will appear here when the events service is connected and an event has been scheduled.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeAndUpcoming.map((event) => {
              const registration = registrations.find((item) => item.event_id === event.id && item.status !== 'withdrawn');
              return <EventCard
                key={event.id}
                event={event}
                now={now}
                registration={registration}
                registering={registeringId === event.id}
                expanded={expandedEventId === event.id}
                onRegister={handleRegister}
                onToggle={(eventId) => setExpandedEventId((current) => current === eventId ? null : eventId)}
              />;
            })}
          </div>
        )}
      </section>

      <section className="panel space-y-3 border border-neon/20 bg-black/40 p-4">
        <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-neon-400">Your event history</h2>
        {historyError ? (
          <p role="alert" className="font-mono text-[10px] text-red-300">{historyError}</p>
        ) : registrations.length === 0 ? (
          <p className="py-5 text-center font-mono text-[10px] leading-relaxed text-neon-700">
            You have not registered for any events yet.
          </p>
        ) : (
          <div className="space-y-2">
            {registrations.map((registration) => (
              <article key={registration.id} className="flex items-center justify-between gap-3 border border-neon/15 bg-black/30 p-3">
                <div className="min-w-0">
                  <p className="break-words font-mono text-[10px] text-neon-300">{registration.game_events?.title ?? 'Event'}</p>
                  <p className="mt-1 font-mono text-[9px] text-neon-700">Joined {eventDate(registration.registered_at, registration.game_events?.timezone ?? 'UTC')}</p>
                </div>
                <span className="shrink-0 border border-neon/20 px-2 py-1 font-mono text-[9px] uppercase text-neon-500">{registration.status.replace('_', ' ')}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
