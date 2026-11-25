import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getTelegramUser } from '@/lib/telegram';

const BOOT_LINES = [
  'Initializing ZORD intelligence',
  'Establishing secure connection',
  'Synchronizing player data',
  'Loading gameplay systems',
];

const EXIT_DURATION_MS = 650;
const LINE_INTERVAL_MS = 850;

type Phase = 'booting' | 'flashing' | 'exiting' | 'done';

export default function ZordPreloader({ children }: { children: ReactNode }) {
  const [activeLine, setActiveLine] = useState(0);
  const [phase, setPhase] = useState<Phase>('booting');
  const [operativeName] = useState(() => getTelegramUser()?.first_name ?? null);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setActiveLine((current) => {
        if (current >= BOOT_LINES.length - 1) {
          window.clearInterval(interval);
          setPhase('flashing');
          return current;
        }
        return current + 1;
      });
    }, LINE_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (phase !== 'flashing') return;
    const timer = window.setTimeout(() => setPhase('exiting'), 420);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'exiting') return;
    const timer = window.setTimeout(() => setPhase('done'), EXIT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === 'done') return <>{children}</>;

  return (
    <>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-label="Loading ZORD"
        className={`zord-boot fixed inset-0 z-[70] flex items-center justify-center overflow-hidden bg-obsidian font-mono ${phase === 'exiting' ? 'zord-preloader-exit' : ''} ${phase === 'flashing' ? 'zord-core-flash' : ''}`}
      >
        <div className="crt-overlay" aria-hidden />

        <div className="zord-boot-grid" aria-hidden />
        <div className="relative z-[1] flex w-full max-w-sm flex-col items-center px-7 text-center">
          <div className="zord-wordmark-wrap">
            <div className="zord-wordmark">ZORD</div>
            <div className="zord-operative">
              {operativeName ? `OPERATIVE ${operativeName}` : 'AUTONOMOUS INTELLIGENCE NETWORK'}
            </div>
          </div>

          <div className="zord-quantum-core" aria-hidden>
            <div className="zord-core-orbit zord-core-orbit--outer" />
            <div className="zord-core-orbit zord-core-orbit--middle" />
            <div className="zord-core-orbit zord-core-orbit--inner" />
            <div className="zord-core-particles">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="zord-core-center">
              <span className="zord-core-glyph">Z</span>
            </div>
          </div>

          <div className="mt-7 w-full">
            <p className="zord-main-tagline">Autonomous Intellect. Total Group Dominion.</p>
            <p className="zord-support-tagline">
              Powering AI Agents. Automating Communities. Connecting the Bot Economy.
            </p>
          </div>

          <div className="zord-boot-console mt-8 w-full" aria-live="off">
            <div className="mb-3 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-neon-600">
              <span>System initialization</span>
              <span className="zord-live-indicator"><i /> LIVE</span>
            </div>
            {BOOT_LINES.map((line, index) => (
              <p
                key={line}
                className={`zord-boot-line ${index < activeLine ? 'is-complete' : ''} ${index === activeLine ? 'is-active' : ''} ${index > activeLine ? 'is-pending' : ''}`}
              >
                <span className="zord-boot-marker">{index < activeLine ? '✓' : index === activeLine ? '›' : '·'}</span>
                {line}
                {index === activeLine && phase === 'booting' && <span className="zord-cursor">_</span>}
              </p>
            ))}
          </div>

          <div className="zord-loading-track mt-6" aria-label="Initializing">
            <span />
          </div>
          <p className="mt-3 text-[10px] uppercase tracking-[0.24em] text-neon-700">
            {phase === 'flashing' ? 'Core synchronized' : 'Bringing the ecosystem online'}
          </p>
        </div>
      </div>
    </>
  );
}
