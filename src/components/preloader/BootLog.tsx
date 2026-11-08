import { useEffect, useState } from 'react';
import { BOOT_LINES } from '@/components/preloader/useBootSequence';

const TYPE_MS = 12;

export function BootLog({ stage, error }: { stage: number; error: string | null }) {
  return (
    <div className="w-full space-y-1.5 font-mono text-[12px] leading-relaxed text-neon-300" style={GLOW}>
      {BOOT_LINES.slice(0, stage + 1).map((line) => (
        <TypedLine key={line} text={line} />
      ))}
      {error && (
        <p className="text-red-300" style={{ textShadow: '0 0 10px rgba(248,113,113,0.5)' }}>
          <span className="mr-1 text-red-500">{'>'}</span>ERROR: {error}
        </p>
      )}
    </div>
  );
}

const GLOW = { textShadow: '0 0 10px rgba(34,197,94,0.5)' } as const;

function TypedLine({ text }: { text: string }) {
  const [count, setCount] = useState(0);
  const done = count >= text.length;

  useEffect(() => {
    if (done) return;
    const id = window.setTimeout(() => setCount((c) => c + 1), TYPE_MS);
    return () => window.clearTimeout(id);
  }, [count, done]);

  return (
    <p className={done ? 'zord-glitch-text' : undefined}>
      <span className="mr-1 text-neon-600">{'>'}</span>
      {text.slice(0, count)}
      {!done && <span className="animate-pulse">_</span>}
    </p>
  );
}
