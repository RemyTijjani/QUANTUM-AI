import { supabase } from '@/lib/supabase';

const OWNER_KEY = 'zord-owner-id';
const OWNED_KEY_PREFIXES = ['zord-', 'sb-'];

export async function claimLocalSession(ownerId: string): Promise<void> {
  let switched = false;
  try {
    if (window.localStorage.getItem(OWNER_KEY) !== ownerId) {
      switched = true;
      Object.keys(window.localStorage)
        .filter((key) => OWNED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)))
        .forEach((key) => window.localStorage.removeItem(key));
      window.localStorage.setItem(OWNER_KEY, ownerId);
    }
  } catch {
    // Storage can be unavailable; nothing persisted means nothing to leak.
  }

  if (switched) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }
}
