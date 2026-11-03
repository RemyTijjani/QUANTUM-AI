import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastTone = 'success' | 'info' | 'error';

export type Notify = (text: string, tone?: ToastTone) => void;

export interface ToastMessage {
  id: number;
  text: string;
  tone: ToastTone;
}

const TOAST_DURATION_MS = 2600;

export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const notify = useCallback<Notify>((text, tone = 'success') => {
    setToast({ id: Date.now(), text, tone });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { toast, notify };
}
