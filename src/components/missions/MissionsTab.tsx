import { useEffect, useRef, useState } from 'react';
import { CalendarCheck, Check, Megaphone } from 'lucide-react';
import { AD_QUOTA_TARGET, MISSIONS } from '@/lib/game/config';
import type { MissionSpec } from '@/lib/game/config';
import { adsWatchedToday, missionStatus } from '@/lib/game/state';
import type { GameState } from '@/lib/game/state';
import { formatClock, formatIq, msUntilNextDay } from '@/lib/format';
import type { GameActions } from '@/hooks/useGame';
import type { Notify } from '@/hooks/useToast';

const VERIFY_MS = 2000;

interface MissionsTabProps {
  state: GameState;
  actions: GameActions;
  notify: Notify;
}

export default function MissionsTab({ state, actions, notify }: MissionsTabProps) {
  const now = Date.now();
  const daily = MISSIONS.filter((mission) => mission.kind === 'daily');
  const social = MISSIONS.filter((mission) => mission.kind === 'social');

  const claim = (mission: MissionSpec) => {
    actions.claimMission(mission.id);
    notify(`${mission.title} complete. +${formatIq(mission.reward)} IQ`);
  };

  return (
    <div className="space-y-6 pb-2">
      <section className="panel flex items-center justify-between gap-4 p-5">
        <div>
          <p className="label">Protocol quests</p>
          <h2 className="title mt-1">Daily directives</h2>
        </div>
        <div className="text-right">
          <p className="label">Resets in</p>
          <p className="mt-1 font-display text-sm font-bold tabular-nums text-neon-300">
            {formatClock(msUntilNextDay(now))}
          </p>
        </div>
      </section>

      <section className="space-y-3">
        {daily.map((mission) => (
          <MissionCard
            key={mission.id}
            mission={mission}
            status={missionStatus(state, mission, now)}
            progressLabel={
              mission.id === 'ad-quota'
                ? `${Math.min(adsWatchedToday(state, now), AD_QUOTA_TARGET)} / ${AD_QUOTA_TARGET} feeds`
                : undefined
            }
            onClaim={() => claim(mission)}
          />
        ))}
      </section>

      <section className="space-y-3">
        <div className="px-1">
          <p className="label">Community missions</p>
          <h2 className="title mt-1">Signal network</h2>
        </div>
        {social.map((mission) => (
          <MissionCard
            key={mission.id}
            mission={mission}
            status={missionStatus(state, mission, now)}
            onClaim={() => claim(mission)}
            verifiable
          />
        ))}
      </section>
    </div>
  );
}

interface MissionCardProps {
  mission: MissionSpec;
  status: 'claimed' | 'ready' | 'locked';
  progressLabel?: string;
  verifiable?: boolean;
  onClaim: () => void;
}

function MissionCard({ mission, status, progressLabel, verifiable, onClaim }: MissionCardProps) {
  const [verifying, setVerifying] = useState(false);
  const onClaimRef = useRef(onClaim);

  useEffect(() => {
    onClaimRef.current = onClaim;
  });

  useEffect(() => {
    if (!verifying) return;
    const id = window.setTimeout(() => {
      setVerifying(false);
      onClaimRef.current();
    }, VERIFY_MS);
    return () => window.clearTimeout(id);
  }, [verifying]);

  const Icon = mission.kind === 'daily' ? CalendarCheck : Megaphone;
  const claimed = status === 'claimed';

  return (
    <div className={`panel flex items-center gap-4 p-4 transition duration-300 ${claimed ? 'opacity-60' : ''}`}>
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${
          claimed ? 'border-neon bg-neon/20 text-neon-300' : 'border-neon/30 text-neon-400'
        }`}
      >
        {claimed ? <Check size={20} /> : <Icon size={20} />}
      </div>

      <div className="min-w-0 flex-1">
        <h3 className="font-display text-xs font-bold uppercase tracking-wide text-neon-300">{mission.title}</h3>
        <p className="mt-1 font-mono text-[11px] leading-relaxed text-neon-500">{mission.description}</p>
        <div className="mt-2 flex items-center gap-3 font-mono text-[11px] tabular-nums">
          <span className="text-neon-400">+{formatIq(mission.reward)} IQ</span>
          {progressLabel && <span className="text-cyan-300">{progressLabel}</span>}
        </div>
      </div>

      {claimed ? (
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-neon-500">Done</span>
      ) : verifiable ? (
        <button
          type="button"
          onClick={() => setVerifying(true)}
          disabled={status !== 'ready' || verifying}
          className="btn-ghost shrink-0 px-3 py-2"
        >
          {verifying ? 'Verifying' : 'Verify'}
        </button>
      ) : (
        <button type="button" onClick={onClaim} disabled={status !== 'ready'} className="btn-primary shrink-0 px-3 py-2">
          {status === 'ready' ? 'Claim' : 'Locked'}
        </button>
      )}
    </div>
  );
}
