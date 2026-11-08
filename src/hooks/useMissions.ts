import { useCallback, useEffect, useState } from 'react';
import { fetchMissions } from '@/lib/missions';
import type { MissionSpec } from '@/lib/game/config';

export type MissionsResource =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; data: MissionSpec[] }
  | { status: 'error'; message: string };

export function useMissions(enabled: boolean) {
  const [resource, setResource] = useState<MissionsResource>({ status: 'idle' });

  const load = useCallback(async () => {
    setResource({ status: 'loading' });
    try {
      const data = await fetchMissions();
      setResource({ status: 'ready', data });
    } catch (err) {
      setResource({ status: 'error', message: err instanceof Error ? err.message : 'Could not load missions.' });
    }
  }, []);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  return { resource, reload: load };
}
