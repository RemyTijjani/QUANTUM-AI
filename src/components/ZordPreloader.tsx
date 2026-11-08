import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getTelegramUser } from '@/lib/telegram';

const BOOT_DURATION_MS = 2000;
const EXIT_DURATION_MS = 600;
const BOOT_LINES = [
  'Initializing ZORD OS kernel...',
  'Establishing Telegram interface handshake...',
  'Synchronizing operative data & ZP reserves...',
  'SYSTEM ONLINE. LAUNCHING INTERFACE.',
];
const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const GLOW_TEXT_SHADOW = '0 0 10px rgba(34,197,94,0.5)';

type Phase = 'booting' | 'exiting' | 'done';

function visibleLineText(line: string, index: number, activeIndex: number, progress: number): string {
  if (index < activeIndex) return line;
  const segment = Math.min(Math.max(progress * BOOT_LINES.length - index, 0), 1);
  return line.slice(0, Math.floor(segment * line.length));
}

export default function ZordPreloader({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<Phase>('booting');
  const [operativeName] = useState(() => getTelegramUser()?.first_name ?? null);

  useEffect(() => {
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const t = Math.min((now - start) / BOOT_DURATION_MS, 1);
      setProgress(t);
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        setPhase('exiting');
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (phase !== 'exiting') return;
    const timer = window.setTimeout(() => setPhase('done'), EXIT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === 'done') return <>{children}</>;

  const percent = Math.round(progress * 100);
  const activeIndex = Math.min(Math.floor(progress * BOOT_LINES.length), BOOT_LINES.length - 1);

  return (
    <>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-label="Loading ZORD OS"
        className={`fixed inset-0 z-[70] flex items-center justify-center overflow-hidden bg-obsidian font-mono ${
          phase === 'exiting' ? 'zord-preloader-exit' : ''
        }`}
      >
        <div className="crt-overlay" aria-hidden />

        <div className="relative flex w-full max-w-sm flex-col items-center gap-8 px-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="font-display text-lg font-bold uppercase tracking-[0.3em] text-neon-400" style={{ textShadow: GLOW_TEXT_SHADOW }}>
              ZORD OS
            </h1>
            <p className="text-[11px] uppercase tracking-[0.22em] text-neon-500">
              {operativeName ? `Operative ${operativeName}` : 'Operative link pending'}
            </p>
          </div>

          <div className="relative h-40 w-40">
            <div className="zord-radar absolute inset-2 rounded-full opacity-70" style={{ background: 'conic-gradient(from 0deg, rgba(34,197,94,0) 0deg, rgba(34,197,94,0.45) 70deg, rgba(34,197,94,0) 90deg)' }} />
            <div className="absolute inset-0 rounded-full border border-neon/20" />
            <svg viewBox="0 0 120 120" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
              <circle cx="60" cy="60" r={RING_RADIUS} fill="none" stroke="rgba(34,197,94,0.15)" strokeWidth="4" />
              <circle
                cx="60"
                cy="60"
                r={RING_RADIUS}
                fill="none"
                stroke="#22c55e"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
                className="zord-ring-pulse"
                style={{ filter: 'drop-shadow(0 0 6px rgba(34,197,94,0.8))' }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-3xl font-bold tabular-nums text-neon-300" style={{ textShadow: GLOW_TEXT_SHADOW }}>
                {percent}%
              </span>
            </div>
          </div>

          <div className="min-h-[120px] w-full space-y-2 text-[12px] leading-[1.5] text-neon-400" style={{ textShadow: GLOW_TEXT_SHADOW }}>
            {BOOT_LINES.slice(0, activeIndex + 1).map((line, index) => {
              const text = visibleLineText(line, index, activeIndex, progress);
              const isActive = index === activeIndex;
              return (
                <p key={line} className={isActive ? 'zord-glitch' : undefined}>
                  <span className="text-neon-600">&gt; </span>
                  {text}
                  {isActive && progress < 1 && <span className="zord-cursor">_</span>}
                </p>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
