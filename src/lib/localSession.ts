import { supabase } from '@/lib/supabase';

const OWNER_KEY = 'zord-owner-id';

export async function claimLocalSession(
  ownerId: string,
): Promise<void> {
  let switched = false;

  try {
    const previousOwner = window.localStorage.getItem(OWNER_KEY);

    if (previousOwner !== ownerId) {
      switched = true;

      // Preserve each Telegram account's separately stored game data.
      window.localStorage.setItem(OWNER_KEY, ownerId);
    }
  } catch {
    // Storage can be unavailable.
  }

  if (switched) {
    // Clear the previous Supabase login session before authenticating
    // the Telegram account that is currently opening the app.
    await supabase.auth
      .signOut({ scope: 'local' })
      .catch(() => undefined);
  }
}
