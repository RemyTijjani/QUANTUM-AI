import { CircleCheck, CircleAlert, Info } from 'lucide-react';
import type { ToastMessage } from '@/hooks/useToast';

const TONE_STYLES = {
  success: { border: 'border-neon/70', text: 'text-neon-300', icon: CircleCheck },
  info: { border: 'border-cyan-400/60', text: 'text-cyan-300', icon: Info },
  error: { border: 'border-red-500/70', text: 'text-red-300', icon: CircleAlert },
} as const;

interface ToastProps {
  toast: ToastMessage | null;
}

export default function Toast({ toast }: ToastProps) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+96px)] z-[70] flex justify-center px-4">
      {toast && <ToastCard key={toast.id} toast={toast} />}
    </div>
  );
}

function ToastCard({ toast }: { toast: ToastMessage }) {
  const style = TONE_STYLES[toast.tone];
  const Icon = style.icon;
  return (
    <div
      role="status"
      className={`panel flex max-w-sm items-center gap-3 border ${style.border} bg-obsidian/95 px-4 py-3 shadow-glow animate-toast-in`}
    >
      <Icon size={18} className={`shrink-0 ${style.text}`} />
      <p className={`font-mono text-xs leading-relaxed ${style.text}`}>{toast.text}</p>
    </div>
  );
}
