import { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import Modal from '@/components/Modal';
import { AD_MAX_SECONDS, AD_MIN_SECONDS, FRAGMENT_NAMES } from '@/lib/game/config';
import type { FragmentId } from '@/lib/game/config';

const TICK_MS = 100;

interface AdModalProps {
  fragmentId: FragmentId;
  onComplete: () => void;
  onCancel: () => void;
}

export default function AdModal({ fragmentId, onComplete, onCancel }: AdModalProps) {
  const [durationMs] = useState(
    () => Math.round((AD_MIN_SECONDS + Math.random() * (AD_MAX_SECONDS - AD_MIN_SECONDS)) * 1000),
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const done = elapsedMs >= durationMs;

  useEffect(() => {
    if (done) return;
    const started = Date.now();
    const id = window.setInterval(() => setElapsedMs(Date.now() - started), TICK_MS);
    return () => window.clearInterval(id);
  }, [done]);

  const remaining = Math.max(0, Math.ceil((durationMs - elapsedMs) / 1000));
  const progress = Math.min(1, elapsedMs / durationMs) * 100;

  return (
    <Modal title="Sponsor Interstitial" onClose={done ? onCancel : undefined}>
      <div className="space-y-5">
        <div className="scan-bars relative flex aspect-video flex-col items-center justify-center overflow-hidden rounded-lg border border-cyan-400/40 bg-black/70">
          <Radio size={28} className="mb-3 text-cyan-300 animate-soft-pulse" />
          <p className="font-display text-xs uppercase tracking-[0.2em] text-cyan-300">
            {done ? 'Feed complete' : 'Receiving sponsor feed'}
          </p>
          <p className="mt-2 font-mono text-[11px] text-neon-500">
            Unlocking {FRAGMENT_NAMES[fragmentId]}
          </p>
          <span className="absolute bottom-3 right-3 font-display text-2xl font-bold tabular-nums text-cyan-300">
            {done ? '0' : remaining}s
          </span>
        </div>

        <div>
          <div className="mb-2 flex justify-between font-mono text-[11px] uppercase tracking-wider text-neon-500">
            <span>Uplink progress</span>
            <span className="tabular-nums">{Math.round(progress)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-cyan-400/10">
            <div
              className="h-full rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.7)] transition-[width] duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {done ? (
          <button type="button" onClick={onComplete} className="btn-primary w-full">
            Complete unlock
          </button>
        ) : (
          <button type="button" onClick={onCancel} className="btn-ghost w-full">
            Cancel unlock session
          </button>
        )}
      </div>
    </Modal>
  );
}
