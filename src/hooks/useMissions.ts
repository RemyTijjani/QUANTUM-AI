import { useCallback, useEffect, useState } from 'react';
import { FALLBACK_MISSIONS, fetchMissions } from '@/lib/missions';
import type { MissionSpec } from '@/lib/game/config';

export function useMissions(): MissionSpec[] {
  const [missions, setMissions] = useState<MissionSpec[]>(FALLBACK_MISSIONS);

  const refresh = useCallback(async () => {
    const list = await fetchMissions();
    setMissions(list);
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  return missions;
}
