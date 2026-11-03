import type { FragmentId } from '@/lib/game/config';

export const FRAGMENT_ICON: Record<FragmentId, string> = {
  top: 'fa-shield-halved',
  bottom: 'fa-bolt',
  left: 'fa-memory',
  right: 'fa-atom',
};

export const STATUS_LABEL = {
  locked: 'Locked',
  unlocked: 'Tap to fix',
  fixed: 'Online',
} as const;
