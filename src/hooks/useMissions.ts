import { useEffect, useState } from 'react';
import { FALLBACK_MISSIONS, fetchMissions } from '@/lib/missions';
import type { MissionSpec } from '@/lib/game/config';

export function useMissions(): MissionSpec[] {
  const [missions, setMissions] = useState<MissionSpec[]>(FALLBACK_MISSIONS);

  useEffect(() => {
    let cancelled = false;
    fetchMissions().then((list) => {
      if (!cancelled) setMissions(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return missions;
}
