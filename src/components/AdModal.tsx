import { Radio, ShieldCheck, Sparkles } from 'lucide-react';
import Modal from '@/components/Modal';
import { FRAGMENT_NAMES } from '@/lib/game/config';
import type { FragmentId } from '@/lib/game/config';

interface AdModalProps {
  fragmentId: FragmentId;
  isReactivation?: boolean;
  isProcessing?: boolean;
  isActivationStarted?: boolean;
  onWatch: () => void;
  onClose: () => void;
}

export default function AdModal({
  fragmentId,
  isReactivation = false,
  isProcessing = false,
  isActivationStarted = false,
  onWatch,
  onClose,
}: AdModalProps) {
  const isMonetagFragment = fragmentId === 'right';
  const isFreeShield = fragmentId === 'top';
  const isFreeProcessor = fragmentId === 'left';
  const isFreeFragment = isFreeShield || isFreeProcessor;
  const freeFragmentName = isFreeShield ? 'Shield' : 'Processor';

  return (
    <Modal title="Fragment activation" onClose={isProcessing ? () => undefined : onClose}>
      <div className="space-y-4">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-neon-600">
            {isReactivation ? 'Fragment reactivation' : 'Fragment unlock'}
          </p>
          <h3 className="mt-1 font-display text-sm font-bold uppercase tracking-wider text-white">
            {FRAGMENT_NAMES[fragmentId]}
          </h3>
        </div>

        <div className="scan-bars relative flex aspect-video flex-col items-center justify-center overflow-hidden rounded-xl border border-cyan-400/30 bg-black/70 p-5 text-center">
          <div className="mb-3 grid h-12 w-12 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10">
            <Radio size={22} className="text-cyan-200" />
          </div>
          <p className="font-display text-xs font-bold uppercase tracking-[0.2em] text-cyan-200">
            {isMonetagFragment ? 'Monetag rewarded interstitial' : isFreeFragment ? `Free ${freeFragmentName} activation` : 'OnClicka rewarded interstitial'}
          </p>
          <p className="mt-2 max-w-[240px] font-mono text-[10px] leading-relaxed text-neon-500">
            {isMonetagFragment
              ? 'Watch the rewarded ad. ZORD unlocks this Fragment only after the Monetag SDK and server postback both confirm a valued event.'
              : isFreeFragment
                ? `No advertisement is required. Complete the five-second activation scan to unlock ${freeFragmentName}.`
                : 'Watch the rewarded ad. ZORD unlocks this Fragment only after OnClicka confirms the view on the server.'}
          </p>
          <Sparkles size={14} className="absolute right-4 top-4 text-cyan-300/60" />
        </div>

        <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3">
          <div className="flex items-center gap-2 text-cyan-200">
            <ShieldCheck size={15} />
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider">{isFreeFragment ? 'Free activation' : 'Verified ad placement'}</p>
          </div>
          <p className="mt-1 font-mono text-[10px] leading-relaxed text-cyan-100/70">
            {isFreeFragment
              ? `${freeFragmentName} is free to unlock. The server validates the five-second activation before changing its status.`
              : 'A click, ad load, or unverified client response cannot unlock a Fragment. The assigned provider must confirm the rewarded view on the server.'}
          </p>
        </div>
        {isFreeFragment && (
          <div className="h-1.5 overflow-hidden rounded-full bg-cyan-950">
            <div className={"h-full rounded-full bg-cyan-300 transition-[width] duration-[5000ms] ease-linear " + (isActivationStarted ? "w-full" : "w-0")} />
          </div>
        )}

        {!isMonetagFragment && !isFreeFragment && (
          <div className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-3">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-200">Provider not connected</p>
            <p className="mt-1 font-mono text-[9px] leading-relaxed text-amber-100/70">
              This Fragment stays locked until its assigned provider is configured and its server-side verification is active.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={isProcessing} className="btn-secondary flex-1 disabled:opacity-50">
            Cancel
          </button>
          {(isMonetagFragment || isFreeFragment) && (
            <button type="button" onClick={onWatch} disabled={isProcessing} className="btn-primary flex-1 disabled:opacity-50">
              {isProcessing ? (isFreeFragment ? `Activating ${freeFragmentName}…` : 'Verifying ad…') : (isFreeFragment ? 'Unlock free · 5 sec' : 'Watch ad')}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
