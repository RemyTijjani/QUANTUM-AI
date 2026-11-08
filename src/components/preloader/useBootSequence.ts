import { useEffect, useState } from 'react';

export const BOOT_LINES = [
  'Initializing ZORD OS kernel...',
  'Verifying Telegram HMAC security handshake...',
  'Connecting to Supabase decentralized telemetry...',
  'Loading operative profiles & ZP reserves...',
  'SYSTEM ONLINE. LAUNCHING INTERFACE.',
] as const;

const LAST_STAGE = BOOT_LINES.length - 1;
const STAGE_TARGET_PERCENT = [15, 40, 60, 85, 100];
const STAGE_INTERVAL_MS = 650;
const PERCENT_TICK_MS = 40;
const ERROR_STAGE = 2;

interface BootSignals {
  isAuthenticating: boolean;
  isLoading: boolean;
  hasError: boolean;
}

function realStageFor({ isAuthenticating, isLoading, hasError }: BootSignals): number {
  if (hasError) return ERROR_STAGE;
  if (isAuthenticating) return 1;
  if (isLoading) return LAST_STAGE - 1;
  return LAST_STAGE;
}

export function useBootSequence(signals: BootSignals) {
  const { hasError } = signals;
  const [timerStage, setTimerStage] = useState(0);
  const [percent, setPercent] = useState(0);

  const stage = Math.min(timerStage, realStageFor(signals));
  const target = STAGE_TARGET_PERCENT[stage];
  const complete =
    !hasError && stage === LAST_STAGE && percent >= 100 && !signals.isAuthenticating && !signals.isLoading;

  useEffect(() => {
    if (hasError || timerStage >= LAST_STAGE) return;
    const id = window.setTimeout(() => setTimerStage((s) => s + 1), STAGE_INTERVAL_MS);
    return () => window.clearTimeout(id);
  }, [timerStage, hasError]);

  useEffect(() => {
    if (percent >= target) return;
    const id = window.setTimeout(() => {
      setPercent((p) => Math.min(target, p + Math.max(1, Math.ceil((target - p) * 0.15))));
    }, PERCENT_TICK_MS);
    return () => window.clearTimeout(id);
  }, [percent, target]);

  return { stage, percent, complete };
}
