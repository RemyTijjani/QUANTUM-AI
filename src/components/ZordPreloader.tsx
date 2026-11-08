import { useEffect, useState } from 'react';
import { RadarProgress } from '@/components/preloader/RadarProgress';
import { BootLog } from '@/components/preloader/BootLog';
import { useBootSequence } from '@/components/preloader/useBootSequence';

const HOLD_AFTER_READY_MS = 500;
const EXIT_DURATION_MS = 800;

interface ZordPreloaderProps {
  isAuthenticating: boolean;
  isLoading: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export function ZordPreloader({ isAuthenticating, isLoading, error = null, onRetry }: ZordPreloaderProps) {
  const { stage, percent, complete } = useBootSequence({
    isAuthenticating,
    isLoading,
    hasError: Boolean(error),
  });
  const [phase, setPhase] = useState<'booting' | 'exiting' | 'done'>('booting');

  useEffect(() => {
    if (phase !== 'booting' || !complete) return;
    const id = window.setTimeout(() => setPhase('exiting'), HOLD_AFTER_READY_MS);
    return () => window.clearTimeout(id);
  }, [complete, phase]);

  useEffect(() => {
    if (phase !== 'exiting') return;
    const id = window.setTimeout(() => setPhase('done'), EXIT_DURATION_MS);
    return () => window.clearTimeout(id);
  }, [phase]);

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
    </div>
  );
}
