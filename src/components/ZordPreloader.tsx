import { useEffect, useState } from 'react';
import { RadarProgress } from '@/components/preloader/RadarProgress';
import { BootLog } from '@/components/preloader/BootLog';
import { useBootSequence } from '@/components/preloader/useBootSequence';
import { NeonSpinner } from '@/components/NeonSpinner';
import { hasCompletedBoot, markBootCompleted } from '@/lib/bootFlag';

const HOLD_AFTER_READY_MS = 500;
const RETURNING_PULSE_MS = 1000;
const EXIT_DURATION_MS = 800;

interface ZordPreloaderProps {
  isAuthenticating: boolean;
  isLoading: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export function ZordPreloader({ isAuthenticating, isLoading, error = null, onRetry }: ZordPreloaderProps) {
  const [returning] = useState(hasCompletedBoot);
  const [minPulseElapsed, setMinPulseElapsed] = useState(!returning);
  const hasError = Boolean(error);
  const { stage, percent, complete } = useBootSequence({ isAuthenticating, isLoading, hasError });
  const settled = !isAuthenticating && !isLoading && !hasError;
  const ready = returning ? settled && minPulseElapsed : complete;
  const [phase, setPhase] = useState<'booting' | 'exiting' | 'done'>('booting');
  const minimal = returning && !hasError;

  useEffect(() => {
    if (!returning) return;
    const id = window.setTimeout(() => setMinPulseElapsed(true), RETURNING_PULSE_MS);
    return () => window.clearTimeout(id);
  }, [returning]);

  useEffect(() => {
    if (phase !== 'booting' || !ready) return;
    const id = window.setTimeout(() => setPhase('exiting'), returning ? 0 : HOLD_AFTER_READY_MS);
    return () => window.clearTimeout(id);
  }, [ready, phase, returning]);

  useEffect(() => {
    if (phase !== 'exiting') return;
    if (!returning) markBootCompleted();
    const id = window.setTimeout(() => setPhase('done'), EXIT_DURATION_MS);
    return () => window.clearTimeout(id);
  }, [phase, returning]);

  if (phase === 'done') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-0 z-[70] flex items-center justify-center overflow-hidden bg-[#020503] px-6 ${
        phase === 'exiting' ? 'zord-preloader-exit' : ''
      }`}
    >
      <div className="crt-overlay" aria-hidden />

      {minimal ? (
        <NeonSpinner label="Verifying session..." />
      ) : (
        <div className="flex w-full max-w-md flex-col items-center gap-8">
          <div className="text-center">
            <p
              className="font-display text-lg font-bold tracking-[0.3em] text-neon-300"
              style={{ textShadow: '0 0 10px rgba(34,197,94,0.5)' }}
            >
              ZORD AUTONOMOUS AGENT
            </p>
            <p className="mt-2 font-mono text-[11px] uppercase tracking-widest text-neon-600">// boot sequence</p>
          </div>

          <RadarProgress percent={percent} />

          <BootLog stage={stage} error={error} />

          {error && onRetry && (
            <button type="button" onClick={onRetry} className="btn-primary">
              Retry uplink
            </button>
          )}
        </div>
      )}
    </div>
  );
}
