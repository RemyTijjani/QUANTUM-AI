
// Lock fragments exactly when their cooldown expires.
function expireFragments(s: GameState, at: number): GameState {
  const fragments = { ...s.fragments };
  let changed = false;

  for (const id of FRAGMENT_IDS) {
    if (
      fragments[id] === 'fixed' &&
      s.fragmentCooldowns[id] <= at
    ) {
      fragments[id] = 'locked';
      changed = true;
    }
  }

  return changed ? { ...s, fragments } : s;
}

// Splits elapsed time at agent, core session, and fragment cooldown expiries.
export function advance(s: GameState, now: number): GameState {
  if (now <= s.lastTick) return s;

  // Clean up fragments whose cooldown already expired before this calculation.
  let next = expireFragments(s, s.lastTick);

  const expiries = [
    ...AGENT_IDS.map((id) => next.agents[id]),
    next.coreMiningUntil,
    ...FRAGMENT_IDS.map((id) => next.fragmentCooldowns[id]),
  ].filter((end) => end > next.lastTick && end <= now);

  const boundaries = [...new Set([...expiries, now])].sort(
    (a, b) => a - b
  );

  for (const end of boundaries) {
    // Accrue earnings up to the exact expiry timestamp.
    next = {
      ...accrue(next, (end - next.lastTick) / 1000),
      lastTick: end,
    };

    // Expired fragments stop generating ZP from this point onward.
    next = expireFragments(next, end);
  }

  return next;
}
