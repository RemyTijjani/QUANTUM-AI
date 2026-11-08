const BOOT_FLAG_KEY = 'zord_has_booted';

export function hasCompletedBoot(): boolean {
  try {
    return window.localStorage.getItem(BOOT_FLAG_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markBootCompleted(): void {
  try {
    window.localStorage.setItem(BOOT_FLAG_KEY, 'true');
  } catch {
    // Storage unavailable: the full boot sequence simply shows again next visit.
  }
}
