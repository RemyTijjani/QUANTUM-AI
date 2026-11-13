import { createClient } from "npm:@supabase/supabase-js@2";

export function registrationEvidence(event: { objectives?: unknown; requirements?: unknown }) {
  const objectives = Array.isArray(event.objectives) ? event.objectives : [];
  const requirements = Array.isArray(event.requirements) ? event.requirements : [];
  if (!objectives.includes("register") || !requirements.includes("authenticated_player")) return null;

  return {
    progress: {
      register: {
        verified: true,
        verifiedAt: new Date().toISOString(),
        method: "server_authenticated_registration",
      },
    },
  };
}

export function eventLocalDateKey(value: string | number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function eventLocalDateKeys(start: string, end: string, timezone: string): string[] {
  const first = eventLocalDateKey(start, timezone);
  const last = eventLocalDateKey(new Date(new Date(end).getTime() - 1), timezone);
  const [startYear, startMonth, startDay] = first.split("-").map(Number);
  const [endYear, endMonth, endDay] = last.split("-").map(Number);
  let cursor = Date.UTC(startYear, startMonth - 1, startDay);
  const finalDay = Date.UTC(endYear, endMonth - 1, endDay);
  const days: string[] = [];
  while (cursor <= finalDay && days.length < 370) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 24 * 60 * 60 * 1000;
  }
  if (cursor <= finalDay) {
    throw new Error("Event duration exceeds the supported verification window.");
  }
  return days;
}

export async function verifyConfiguredEventActivities(
  admin: ReturnType<typeof createClient>,
  playerId: string,
  event: { id: string; starts_at: string | null; ends_at: string | null; timezone?: string | null },
  registration: Record<string, unknown>,
  preloadedActivities?: Array<{ id: string; mission_id: string | null; activity_type: string; is_required: boolean; config: unknown }>,
) {
  if (!event.starts_at || !event.ends_at) return registration;
  const timezone = event.timezone || "UTC";

  let activities = preloadedActivities;
  if (!activities) {
    const { data, error } = await admin
      .from("game_event_activities")
      .select("id, mission_id, activity_type, is_required, config")
      .eq("event_id", event.id);
    if (error) {
      console.error("Event activity verification lookup failed:", error);
      throw new Error("Could not verify event activities.");
    }
    activities = data ?? [];
  }

  const currentProgress = registration.progress && typeof registration.progress === "object" && !Array.isArray(registration.progress)
    ? registration.progress as Record<string, unknown>
    : {};
  const existingActivityProgress = currentProgress.activities && typeof currentProgress.activities === "object" && !Array.isArray(currentProgress.activities)
    ? currentProgress.activities as Record<string, unknown>
    : {};
  const nextActivityProgress: Record<string, unknown> = { ...existingActivityProgress };
  let changed = false;
  const eventEnd = new Date(event.ends_at).getTime();
  const registeredAt = typeof registration.registered_at === "string" ? new Date(registration.registered_at).getTime() : new Date(event.starts_at).getTime();
  const activityStart = new Date(Math.max(new Date(event.starts_at).getTime(), registeredAt)).toISOString();
  const activityEnd = new Date(Math.min(Date.now(), eventEnd)).toISOString();

  for (const activity of activities ?? []) {
    if (activity.activity_type === "creator_submission_approved" && activity.mission_id) {
      const { data: creatorMission, error: missionError } = await admin
        .from("mission_tasks")
        .select("id")
        .eq("id", activity.mission_id)
        .eq("kind", "creator")
        .maybeSingle();
      if (missionError) {
        console.error("Creator mission lookup failed:", missionError);
        throw new Error("Could not verify the linked Creator Ops mission.");
      }
      if (!creatorMission) continue;

      const previous = nextActivityProgress[activity.id];
      if (previous && typeof previous === "object" && (previous as Record<string, unknown>).verified === true) continue;

      const { data: submission, error } = await admin
        .from("creator_ops_submissions")
        .select("id, mission_id, created_at, reviewed_at")
        .eq("player_id", playerId)
        .eq("mission_id", activity.mission_id)
        .eq("status", "approved")
        .not("reviewed_at", "is", null)
        .gte("created_at", activityStart)
        .gte("reviewed_at", activityStart)
        .lte("reviewed_at", event.ends_at)
        .order("reviewed_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("Creator activity verification failed:", error);
        throw new Error("Could not verify creator submission activity.");
      }
      if (!submission) continue;

      nextActivityProgress[activity.id] = {
        verified: true,
        verifiedAt: new Date().toISOString(),
        method: "admin_approved_creator_ops_submission",
        submissionId: submission.id,
        missionId: submission.mission_id,
        submittedAt: submission.created_at,
        approvedAt: submission.reviewed_at,
      };
      changed = true;
      continue;
    }

    if (activity.activity_type !== "gameplay_verification") continue;
    const config = activity.config && typeof activity.config === "object" && !Array.isArray(activity.config)
      ? activity.config as Record<string, unknown>
      : {};
    const perFragmentTarget = config.fixesPerFragmentPerDay;
    const legacyTotalTarget = config.targetCountPerDay;
    const usesPerFragmentTarget = Number.isSafeInteger(perFragmentTarget) &&
      (perFragmentTarget as number) >= 1 && (perFragmentTarget as number) <= 100;
    const usesLegacyTotalTarget = Number.isSafeInteger(legacyTotalTarget) &&
      (legacyTotalTarget as number) >= 1 && (legacyTotalTarget as number) <= 100;
    if (config.action !== "fragment_fixed" || (!usesPerFragmentTarget && !usesLegacyTotalTarget)) {
      continue;
    }

    const configuredFragments = config.fragmentIds;
    const allowedFragments = configuredFragments === undefined
      ? ["top", "bottom", "left", "right"]
      : Array.isArray(configuredFragments) ? configuredFragments : [];
    if (allowedFragments.length < 1 || allowedFragments.length > 4 ||
        allowedFragments.some((id: unknown) => typeof id !== "string" || !["top", "bottom", "left", "right"].includes(id)) ||
        new Set(allowedFragments).size !== allowedFragments.length) {
      console.error("Skipping gameplay activity with an invalid fragment selection:", activity.id);
      continue;
    }

    // Page through the complete event window. A single PostgREST result is capped,
    // so a fixed limit could silently omit valid actions on long-running events.
    const actions: Array<{ id: string; fragment_id: string; created_at: string }> = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data: page, error: actionsError } = await admin
        .from("gameplay_action_events")
        .select("id, fragment_id, created_at")
        .eq("player_id", playerId)
        .eq("action_type", "fragment_fixed")
        .in("fragment_id", allowedFragments)
        .gte("created_at", activityStart)
        .lte("created_at", activityEnd)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (actionsError) {
        console.error("Gameplay evidence lookup failed:", actionsError);
        throw new Error("Could not verify gameplay activity.");
      }
      actions.push(...(page ?? []));
      if (!page || page.length < pageSize) break;
    }
    const days = eventLocalDateKeys(activityStart, event.ends_at, timezone);
    const dailyCounts: Record<string, number> = Object.fromEntries(days.map((day) => [day, 0]));
    const dailyFragmentCounts: Record<string, Record<string, number>> = Object.fromEntries(
      days.map((day) => [day, Object.fromEntries(allowedFragments.map((fragment) => [fragment, 0]))])
    );
    for (const action of actions) {
      if (!allowedFragments.includes(action.fragment_id)) continue;
      const day = eventLocalDateKey(action.created_at, timezone);
      if (day in dailyCounts) {
        dailyCounts[day] += 1;
        dailyFragmentCounts[day][action.fragment_id] += 1;
      }
    }

    const target = (usesPerFragmentTarget ? perFragmentTarget : legacyTotalTarget) as number;
    const completedDay = (day: string) => usesPerFragmentTarget
      ? allowedFragments.every((fragment) => dailyFragmentCounts[day][fragment] >= target)
      : dailyCounts[day] >= target;
    const completedDays = days.filter(completedDay).length;
    const currentDay = eventLocalDateKey(Date.now(), timezone);
    const previous = nextActivityProgress[activity.id] && typeof nextActivityProgress[activity.id] === "object"
      ? nextActivityProgress[activity.id] as Record<string, unknown>
      : {};
    const verified = days.length > 0 && completedDays === days.length;
    const evidence = {
      verified,
      verifiedAt: verified ? (typeof previous.verifiedAt === "string" ? previous.verifiedAt : new Date().toISOString()) : null,
      method: usesPerFragmentTarget ? "server_recorded_per_fragment_fix_actions" : "server_recorded_fragment_fix_actions",
      action: "fragment_fixed",
      ...(usesPerFragmentTarget
        ? { fixesPerFragmentPerDay: target, dailyFragmentCounts, currentDayFragmentCounts: dailyFragmentCounts[currentDay] ?? {} }
        : { targetCountPerDay: target }),
      dailyCounts,
      currentDayCount: dailyCounts[currentDay] ?? 0,
      completedDays,
      totalDays: days.length,
    };
    if (JSON.stringify(previous) !== JSON.stringify(evidence)) {
      nextActivityProgress[activity.id] = evidence;
      changed = true;
    }
  }

  const requiredActivities = (activities ?? []).filter((activity) => activity.is_required);
  const allRequiredActivitiesVerified = requiredActivities.length > 0 &&
    requiredActivities.every((activity) => {
      const evidence = nextActivityProgress[activity.id];
      return !!evidence && typeof evidence === "object" && (evidence as Record<string, unknown>).verified === true;
    });

  const hasAnyVerifiedProgress = Object.values(nextActivityProgress).some((evidence) =>
    !!evidence && typeof evidence === "object" &&
    ((evidence as Record<string, unknown>).verified === true ||
      Number((evidence as Record<string, unknown>).completedDays ?? 0) > 0 ||
      Number((evidence as Record<string, unknown>).currentDayCount ?? 0) > 0)
  );
  const shouldResetUnverifiedCompletion = registration.status === "completed" && !allRequiredActivitiesVerified;
  if (!changed && !(allRequiredActivitiesVerified && registration.status !== "completed") &&
      !(hasAnyVerifiedProgress && registration.status === "registered") &&
      !shouldResetUnverifiedCompletion) return registration;

  const update: Record<string, unknown> = {
    progress: { ...currentProgress, activities: nextActivityProgress },
    updated_at: new Date().toISOString(),
  };
  if (allRequiredActivitiesVerified && registration.status !== "completed") {
    update.status = "completed";
    update.completed_at = registration.completed_at ?? new Date().toISOString();
  } else if (shouldResetUnverifiedCompletion) {
    update.status = hasAnyVerifiedProgress ? "in_progress" : "registered";
    update.completed_at = null;
  } else if (hasAnyVerifiedProgress && registration.status === "registered") {
    update.status = "in_progress";
  }

  const { data: updated, error: updateError } = await admin
    .from("game_event_participations")
    .update(update)
    .eq("id", registration.id)
    .eq("player_id", playerId)
    .select("id, event_id, status, progress, registered_at, updated_at, completed_at, game_events(id, title, category, starts_at, ends_at, timezone, objectives, requirements)")
    .single();

  if (updateError) {
    console.error("Verified event activity progress update failed:", updateError);
    throw new Error("Could not save verified event progress.");
  }
  return updated;
}



/** Run async verification work in bounded batches to avoid request spikes. */
export async function mapInBatches<T, R>(
  items: T[],
  batchSize: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 32) {
    throw new Error("Batch size must be between 1 and 32.");
  }
  const results: R[] = [];
  for (let offset = 0; offset < items.length; offset += batchSize) {
    const batch = items.slice(offset, offset + batchSize);
    const completed = await Promise.all(
      batch.map((item, index) => mapper(item, offset + index)),
    );
    results.push(...completed);
  }
  return results;
}
