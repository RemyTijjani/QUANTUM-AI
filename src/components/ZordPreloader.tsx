import { useEffect } from 'react';

const PRELOADER_DURATION_MS = 1500;

interface ZordPreloaderProps {
  onComplete: () => void;
}

export function ZordPreloader({ onComplete }: ZordPreloaderProps) {
  useEffect(() => {
    const id = window.setTimeout(onComplete, PRELOADER_DURATION_MS);
    return () => window.clearTimeout(id);
  }, [onComplete]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-6 overflow-hidden bg-[#020503] px-6"
    >
      <div className="crt-overlay" aria-hidden />
      <div className="relative h-12 w-12 text-neon-300 drop-shadow-[0_0_8px_currentColor]">
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-current" />
      </div>
      <p
        className="animate-pulse font-display text-lg font-bold tracking-[0.3em] text-neon-300"
        style={{ textShadow: '0 0 10px rgba(34,197,94,0.5)' }}
      >
        ZORD AUTONOMOUS AGENT
      </p>
    </div>
  );
}
