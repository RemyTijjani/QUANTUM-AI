import { X } from 'lucide-react';
import type { ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose?: () => void;
  children: ReactNode;
}

export default function Modal({ title, onClose, children }: ModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm animate-fade-in sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="panel flex max-h-[88dvh] w-full max-w-md flex-col rounded-b-none rounded-t-2xl border-neon/40 shadow-glow animate-sheet-up sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-neon/20 px-5 py-4">
          <h2 className="title">{title}</h2>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1 text-neon-500 transition hover:bg-neon/10 hover:text-neon-300"
            >
              <X size={18} />
            </button>
          )}
        </div>
        <div className="no-scrollbar overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
