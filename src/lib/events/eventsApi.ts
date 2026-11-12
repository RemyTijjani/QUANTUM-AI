export interface PublicGameEvent {
  id: string;
  title: string;
  description: string;
  category: 'daily' | 'weekly' | 'monthly' | 'special';
  starts_at: string;
  ends_at: string;
  timezone: string;
  reward_zp: number;
  reward_zap: number;
  objectives: unknown[];
  requirements: unknown[];
  participation_rules: string;
}

export class EventsApiError extends Error {}

const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-events`;

export async function fetchPublishedEvents(): Promise<PublicGameEvent[]> {
  let response: Response;

  try {
    response = await fetch(functionUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
    });
  } catch {
    throw new EventsApiError('Could not reach the events service. Check your connection and try again.');
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `Events request failed (${response.status}).`;
    throw new EventsApiError(message);
  }

  if (!body || typeof body !== 'object' || !Array.isArray((body as { events?: unknown }).events)) {
    throw new EventsApiError('The events service returned an unexpected response.');
  }

  const events = (body as { events: unknown[] }).events;
  return events.map((value) => {
    if (!value || typeof value !== 'object') {
      throw new EventsApiError('The events service returned an invalid event record.');
    }

    const event = value as Partial<PublicGameEvent>;
    if (
      typeof event.id !== 'string' ||
      typeof event.title !== 'string' ||
      typeof event.description !== 'string' ||
      !['daily', 'weekly', 'monthly', 'special'].includes(String(event.category)) ||
      typeof event.starts_at !== 'string' ||
      typeof event.ends_at !== 'string' ||
      typeof event.timezone !== 'string' ||
      typeof event.reward_zp !== 'number' ||
      typeof event.reward_zap !== 'number' ||
      !Array.isArray(event.objectives) ||
      !Array.isArray(event.requirements) ||
      typeof event.participation_rules !== 'string'
    ) {
      throw new EventsApiError('The events service returned an invalid event record.');
    }

    return event as PublicGameEvent;
  });
}

export interface EventRegistration {
  id: string;
  event_id: string;
  status: 'registered' | 'in_progress' | 'completed' | 'submitted' | 'withdrawn';
  progress?: Record<string, unknown>;
  registered_at: string;
  updated_at: string;
  completed_at: string | null;
  game_events: {
    id: string;
    title: string;
    category: PublicGameEvent['category'];
    starts_at: string | null;
    ends_at: string | null;
    timezone: string;
  } | null;
  activities: EventParticipationActivity[];
}

export interface EventParticipationActivity {
  id: string;
  activity_type: string;
  title: string;
  description: string;
  instructions: string;
  is_required: boolean;
  sort_order: number;
  verification: 'verified' | 'awaiting_verification';
  mission: {
    id: string;
    title: string;
    description: string;
    action_url: string | null;
    kind: string;
    platform: string | null;
    status: string;
  } | null;
}

async function eventParticipationRequest(
  method: 'GET' | 'POST',
  eventId?: string,
): Promise<unknown> {
  const { data: sessionData, error: sessionError } = await (await import('@/lib/supabase')).supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (sessionError || !token) {
    throw new EventsApiError('Your session has expired. Reopen the Mini App and try again.');
  }

  let response: Response;
  try {
    response = await fetch(`${functionUrl.replace('/public-events', '/event-participation')}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify({ eventId }) } : {}),
    });
  } catch {
    throw new EventsApiError('Could not reach the event participation service. Check your connection and try again.');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `Event participation request failed (${response.status}).`;
    throw new EventsApiError(message);
  }
  return body;
}

export async function fetchMyEventRegistrations(): Promise<EventRegistration[]> {
  const body = await eventParticipationRequest('GET');
  if (!body || typeof body !== 'object' || !Array.isArray((body as { registrations?: unknown }).registrations)) {
    throw new EventsApiError('The event history service returned an unexpected response.');
  }
  return (body as { registrations: EventRegistration[] }).registrations;
}

export async function registerForEvent(eventId: string): Promise<{ alreadyRegistered: boolean }> {
  const body = await eventParticipationRequest('POST', eventId);
  if (!body || typeof body !== 'object' || (body as { success?: unknown }).success !== true) {
    throw new EventsApiError('The event registration service returned an unexpected response.');
  }
  return { alreadyRegistered: (body as { alreadyRegistered?: boolean }).alreadyRegistered === true };
}
