import { Radio, ShieldCheck, Sparkles } from 'lucide-react';
import Modal from '@/components/Modal';
import { FRAGMENT_NAMES } from '@/lib/game/config';
import type { FragmentId } from '@/lib/game/config';

interface AdModalProps {
  fragmentId: FragmentId;
  onClose: () => void;
}

export default function AdModal({ fragmentId, onClose }: AdModalProps) {
  return (
    <Modal title="Fragment ad placement" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-neon-600">Fragment unlock</p>
          <h3 className="mt-1 font-display text-sm font-bold uppercase tracking-wider text-white">{FRAGMENT_NAMES[fragmentId]}</h3>
        </div>

        <div className="scan-bars relative flex aspect-video flex-col items-center justify-center overflow-hidden rounded-xl border border-cyan-400/30 bg-black/70 p-5 text-center">
          <div className="mb-3 grid h-12 w-12 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10">
            <Radio size={22} className="text-cyan-200" />
          </div>
          <p className="font-display text-xs font-bold uppercase tracking-[0.2em] text-cyan-200">Advertisement placement</p>
          <p className="mt-2 max-w-[240px] font-mono text-[10px] leading-relaxed text-neon-500">
            An advertisement will appear in this space after publisher approval and integration.
          </p>
          <Sparkles size={14} className="absolute right-4 top-4 text-cyan-300/60" />
        </div>

        <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3">
          <div className="flex items-center gap-2 text-cyan-200">
            <ShieldCheck size={15} />
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider">Verified ad placement</p>
          </div>
          <p className="mt-1 font-mono text-[10px] leading-relaxed text-cyan-100/70">
            Ad views will only count after a completed view is securely verified by ZORD.
          </p>
        </div>

        <div className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-3">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-200">Publisher review preview</p>
          <p className="mt-1 font-mono text-[9px] leading-relaxed text-amber-100/70">
            Ads are not active yet. This preview does not start an unlock session, count an ad view, or issue a reward. The Fragment stays locked until an advertisement is connected and a completed view is verified by ZORD.
          </p>
        </div>

        <button type="button" onClick={onClose} className="btn-primary w-full">Close preview</button>
      </div>
    </Modal>
  );
}
