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
      !Array.isArray(event.requirements)
    ) {
      throw new EventsApiError('The events service returned an invalid event record.');
    }

    return event as PublicGameEvent;
  });
}
