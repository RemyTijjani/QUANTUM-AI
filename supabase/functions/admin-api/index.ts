
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

export function eventLocalDateKey(value: string | number | Date, timezone: string): string {
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
  registration: Record<string, unknown> & { id: string; status: string; registered_at?: string; completed_at?: string | null; zp_reward_approved_at?: string | null },
  preloadedActivities?: Array<{ id: string; mission_id: string | null; activity_type: string; is_required: boolean; config: unknown }>,
) {
  // A paid participation is an immutable audit record. Do not recalculate or
  // attempt to update its evidence after the reward has been issued.
  if (typeof registration.zp_reward_approved_at === "string") return registration;
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
    if (activity.activity_type === "creator_submission_approved") {
      const previous = nextActivityProgress[activity.id];
      const previousEvidence = previous && typeof previous === "object"
        ? previous as Record<string, unknown>
        : null;

      // Re-check the source record on every refresh. A previously verified
      // JSON marker must not survive deletion or invalidation of its submission
      // or linked mission.
      if (!activity.mission_id) {
        if (previousEvidence) {
          delete nextActivityProgress[activity.id];
          changed = true;
        }
        continue;
      }

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
      if (!creatorMission) {
        if (previousEvidence) {
          delete nextActivityProgress[activity.id];
          changed = true;
        }
        continue;
      }

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
      if (!submission) {
        if (previousEvidence) {
          delete nextActivityProgress[activity.id];
          changed = true;
        }
        continue;
      }
      const approvedSubmission = submission as unknown as {
        id: string;
        mission_id: string;
        created_at: string;
        reviewed_at: string;
      };

      const evidence = {
        verified: true,
        verifiedAt: previousEvidence?.submissionId === approvedSubmission.id &&
          typeof previousEvidence.verifiedAt === "string"
          ? previousEvidence.verifiedAt
          : new Date().toISOString(),
        method: "admin_approved_creator_ops_submission",
        submissionId: approvedSubmission.id,
        missionId: approvedSubmission.mission_id,
        submittedAt: approvedSubmission.created_at,
        approvedAt: approvedSubmission.reviewed_at,
      };
      if (JSON.stringify(previousEvidence) !== JSON.stringify(evidence)) {
        nextActivityProgress[activity.id] = evidence;
        changed = true;
      }
      continue;
    }

    if (activity.activity_type !== "gameplay_verification") {
      // Fail closed: stale evidence must not survive if an activity's type is
      // changed to one this verifier does not support.
      if (Object.prototype.hasOwnProperty.call(nextActivityProgress, activity.id)) {
        delete nextActivityProgress[activity.id];
        changed = true;
      }
      continue;
    }
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
      // A changed/invalid configuration invalidates any previously stored proof.
      if (Object.prototype.hasOwnProperty.call(nextActivityProgress, activity.id)) {
        delete nextActivityProgress[activity.id];
        changed = true;
      }
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
      if (Object.prototype.hasOwnProperty.call(nextActivityProgress, activity.id)) {
        delete nextActivityProgress[activity.id];
        changed = true;
      }
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
    .update(update as never)
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


// Intelligence Briefings management is included in the authenticated admin action set.
// admin-api: privileged admin actions using service role key,
// credentials verified server-side.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ADMIN_USERNAME = Deno.env.get("ADMIN_USERNAME") ?? "";
const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") ?? "";

const TASK_KINDS = ["daily", "social", "creator"];
const TASK_PLATFORMS = ["tiktok", "youtube"];

interface AdminRequestBody {
  action:
    | "review_submission"
    | "bulk_approve_submissions"
    | "fetch_dashboard"
    | "save_task"
    | "delete_task"
    | "save_vault_reserves"
    | "save_event"
    | "delete_event"
    | "save_expedition_draft"
    | "list_expedition_objective_reviews"
    | "review_expedition_objective"
    | "prepare_expedition_rewards"
    | "issue_expedition_rewards"
    | "list_expeditions"
    | "publish_expedition"
    | "reschedule_expedition"
    | "list_players"
    | "get_player_economy"
    | "list_event_participants"
    | "update_event_participant_status"
    | "approve_event_participant_reward"
    | "list_event_activities"
    | "save_event_activity"
    | "delete_event_activity"
    | "list_briefings"
    | "save_briefing_draft"
    | "publish_briefing"
    | "confirm_external_zap_funding"
    | "list_external_zap_funding"
    | "confirm_external_ton_funding"
    | "list_external_ton_funding"
    | "list_raffles"
    | "save_raffle_draft"
    | "reserve_raffle_prize"
    | "list_ton_withdrawals"
    | "review_ton_withdrawal"
    | "get_referral_kickback_budget"
    | "set_referral_kickback_budget"
    | "send_broadcast"
    | "get_global_mining_settings"
    | "set_global_mining_settings"
    | "flush_api_cache"
    | "export_player_data";
  adminUsername?: string;
  search?: string;
  playerId?: string;
  zapAmount?: number;
  tonAmount?: number;
  monthlyKickbackBudgetZp?: number;
  transactionReference?: string;
  raffle?: {
    id?: string;
    title?: string;
    description?: string;
    rewardType?: string;
    rewardCode?: string | null;
    prizePoolAmount?: number;
    fundingSource?: string;
    minBetZap?: number;
    entryMode?: string;
    winnerCount?: number;
    winnerMethod?: string;
    startsAt?: string | null;
    endsAt?: string | null;
  };
  adminPassword?: string;
  title?: string;
  message?: string;
  channels?: Array<"in_app" | "telegram">;
  miningEnabled?: boolean;
  miningRateMultiplier?: number;
  submissionId?: string;
  submissionIds?: string[];
  decision?: "approved" | "rejected";
  task?: {
    id?: string;
    kind?: string;
    title?: string;
    description?: string;
    reward?: number;
    platform?: string | null;
    actionUrl?: string | null;
    telegramChatId?: string | null;
    rewardCurrency?: string;
    unlockCostZp?: number;
    status?: string;
    objectives?: unknown;
    requirements?: unknown;
  };
  taskId?: string;
  vaultReserves?: { tonReserve?: number; zpReserve?: number };
  event?: {
    id?: string;
    title?: string;
    description?: string;
    category?: string;
    status?: string;
    startsAt?: string | null;
    endsAt?: string | null;
    timezone?: string;
    rewardZp?: number;
    rewardZap?: number;
    minParticipants?: number | null;
    maxParticipants?: number | null;
    objectives?: unknown;
    requirements?: unknown;
    participationRules?: unknown;
  };
  expeditionId?: string;
  startsAt?: string;
  endsAt?: string;
  briefingId?: string;
  briefing?: { id?: string; title?: string; summary?: string; category?: string; content?: unknown; accessMode?: string; prerequisiteBriefingId?: string | null; passingScore?: number; rewardType?: string; rewardAmount?: number; questions?: Array<{ id?: string; prompt?: string; options?: string[]; correctOptionIndex?: number; explanation?: string }> };
  progressId?: string;
  progressScope?: "individual" | "team";
  objectiveDecision?: "verified" | "rejected";
  reviewReason?: string;
  expedition?: {
    id?: string;
    title?: string; description?: string; category?: string; accessMode?: string; participationMode?: string;
    minTeamSize?: number; maxTeamSize?: number; minIndividualContributions?: number;
    startsAt?: string | null; endsAt?: string | null; timezone?: string;
    rewardType?: string; rewardAmount?: number;
    objectives?: Array<{ kind?: string; title?: string; scope?: string }>;
  };
  eventId?: string;
  participationId?: string;
  participationStatus?: string;
  activityId?: string;
  tonWithdrawalId?: string;
  withdrawalAction?: "approve" | "reject" | "processing" | "paid";
  adminNote?: string;
  transactionHash?: string;
  activity?: {
    id?: string;
    eventId?: string;
    missionId?: string | null;
    activityType?: string;
    title?: string;
    description?: string;
    instructions?: string;
    config?: unknown;
    isRequired?: boolean;
    sortOrder?: number;
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function hashAdminRateLimitKey(clientIp: string): Promise<string> {
  // HMAC prevents stored IP-derived identifiers from being trivially reversed.
  // The service-role key is already a server-only secret and is never persisted.
  const encoder = new TextEncoder();
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SERVICE_ROLE_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    encoder.encode(`${ADMIN_USERNAME.toLowerCase()}:${clientIp}`),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function validateTask(
  task: NonNullable<AdminRequestBody["task"]>
): string | null {
  if (!task.title?.trim()) return "Task name is required";
  if (!task.description?.trim()) return "Description is required";
  if (!task.kind || !TASK_KINDS.includes(task.kind)) {
    return "Invalid task kind";
  }

  if (
    typeof task.reward !== "number" ||
    !Number.isInteger(task.reward) ||
    task.reward < 0
  ) {
    return "Reward must be a whole number of 0 or more";
  }

  if (task.platform && !TASK_PLATFORMS.includes(task.platform)) {
    return "Invalid platform";
  }

  if (task.rewardCurrency && !['ZP', 'ZAP'].includes(task.rewardCurrency)) return "Invalid reward currency";
  if (task.kind === "creator" && task.rewardCurrency === "ZAP") return "Creator Ops submissions can only pay ZP until the Stage 7 ZAP reward backend is implemented.";
  if (task.unlockCostZp !== undefined && (!Number.isSafeInteger(task.unlockCostZp) || task.unlockCostZp < 0)) return "Unlock cost must be a whole number of 0 or more";
  if (task.status && !['draft', 'published', 'paused', 'archived'].includes(task.status)) return "Invalid mission status";
  if (task.objectives !== undefined && (!Array.isArray(task.objectives) || task.objectives.length > 50 || task.objectives.some((v) => typeof v !== 'string' || v.length > 300))) return "Invalid mission objectives";
  if (task.requirements !== undefined && (!Array.isArray(task.requirements) || task.requirements.length > 50 || task.requirements.some((v) => typeof v !== 'string' || v.length > 300))) return "Invalid mission requirements";

  if (task.telegramChatId) {
    const chatId = task.telegramChatId.trim();
    if (!/^(?:-?[0-9]+|@[A-Za-z0-9_]{5,})$/.test(chatId)) {
      return "Telegram chat ID must be a numeric chat ID or public @username";
    }
    if (task.kind !== "social") return "Telegram membership verification is only available for social missions";
  }

  if (task.actionUrl) {
    try {
      const parsed = new URL(task.actionUrl);
      if (
        parsed.protocol !== "https:" &&
        parsed.protocol !== "http:"
      ) {
        return "Action URL must be http or https";
      }
    } catch {
      return "Action URL is not a valid link";
    }
  }

  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const body: AdminRequestBody = await req.json();

    // Supabase's Cloudflare gateway supplies cf-connecting-ip. Do not trust
    // caller-controlled X-Forwarded-For values for the rate-limit identity.
    const clientIp = req.headers.get("cf-connecting-ip")?.trim() || "unknown";
    const rateLimitKey = await hashAdminRateLimitKey(clientIp);
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: rateLimit, error: rateLimitError } = await db.rpc(
      "admin_begin_login_attempt",
      { p_key_hash: rateLimitKey },
    );
    if (rateLimitError || !rateLimit) {
      console.error("Admin login rate-limit check failed:", rateLimitError);
      return json({ error: "Admin authentication temporarily unavailable" }, 503);
    }
    if (rateLimit.allowed !== true) {
      const retryAfter = Math.max(1, Number(rateLimit.retryAfterSeconds) || 900);
      return new Response(JSON.stringify({ error: "Too many login attempts. Try again later." }), {
        status: 429,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Retry-After": String(retryAfter),
        },
      });
    }

    const isAdmin =
      ADMIN_USERNAME !== "" &&
      ADMIN_PASSWORD !== "" &&
      body.adminUsername === ADMIN_USERNAME &&
      body.adminPassword === ADMIN_PASSWORD;

    if (!isAdmin) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { error: clearError } = await db.rpc(
      "admin_clear_login_failures",
      { p_key_hash: rateLimitKey },
    );
    if (clearError) {
      console.error("Admin login rate-limit reset failed:", clearError);
      return json({ error: "Admin authentication temporarily unavailable" }, 503);
    }

    // FETCH ADMIN DASHBOARD
    if (body.action === "fetch_dashboard") {
      const [
        playersRes,
        submissionsRes,
        pendingRes,
        approvedRes,
        pendingListRes,
        tasksRes,
        vaultRes,
        eventsRes,
      ] = await Promise.all([
        db.from("players").select("id", {
          count: "exact",
          head: true,
        }),

        db.from("creator_ops_submissions").select("id", {
          count: "exact",
          head: true,
        }),

        db
          .from("creator_ops_submissions")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),

        db
          .from("creator_ops_submissions")
          .select("reward_zp")
          .eq("status", "approved"),

        db
          .from("creator_ops_submissions")
          .select(
            "id, mission_id, player_referral_code, link_url, platform, status, reward_zp, reviewed_at, created_at"
          )
          .eq("status", "pending")
          .order("created_at", { ascending: true }),

        db
          .from("mission_tasks")
          .select(
            "id, kind, title, description, reward, platform, action_url, telegram_chat_id, reward_currency, unlock_cost_zp, status, objectives, requirements"
          )
          .order("created_at", { ascending: true }),

        db
          .from("vault_reserves")
          .select("ton_reserve, zp_reserve")
          .eq("id", "global")
          .maybeSingle(),

        db
          .from("game_events")
          .select("id, title, description, category, status, starts_at, ends_at, timezone, reward_zp, reward_zap, min_participants, max_participants, objectives, requirements, participation_rules, created_at, updated_at")
          .order("created_at", { ascending: false }),
      ]);

      const failed = [
        playersRes,
        submissionsRes,
        pendingRes,
        approvedRes,
        pendingListRes,
        tasksRes,
        vaultRes,
        eventsRes,
      ].find((r) => r.error);

      if (failed) {
        return json(
          { error: "Failed to load dashboard data" },
          500
        );
      }

      const totalZp = (approvedRes.data ?? []).reduce(
        (sum, row) => sum + (row.reward_zp ?? 0),
        0
      );

      return json({
        stats: {
          totalPlayers: playersRes.count ?? 0,
          totalSubmissions: submissionsRes.count ?? 0,
          pendingSubmissions: pendingRes.count ?? 0,
          totalZp,
        },

        vaultReserves: {
          tonReserve: Number(vaultRes.data?.ton_reserve ?? 0),
          zpReserve: Number(vaultRes.data?.zp_reserve ?? 0),
        },

        submissions: pendingListRes.data ?? [],

        tasks: (tasksRes.data ?? []).map((t) => ({
          id: t.id,
          kind: t.kind,
          title: t.title,
          description: t.description,
          reward: t.reward,
          platform: t.platform,
          actionUrl: t.action_url,
          telegramChatId: t.telegram_chat_id ?? null,
          rewardCurrency: t.reward_currency ?? "ZP",
          unlockCostZp: t.unlock_cost_zp ?? 0,
          status: t.status ?? "published",
          objectives: Array.isArray(t.objectives) ? t.objectives : [],
          requirements: Array.isArray(t.requirements) ? t.requirements : [],
        })),

        events: eventsRes.data ?? [],
      });
    }

    // SEARCH PLAYERS: read-only, bounded admin lookup.
    if (body.action === "list_players") {
      const rawSearch = typeof body.search === "string" ? body.search.trim() : "";
      if (rawSearch.length > 64) {
        return json({ error: "Player search must be 64 characters or fewer" }, 400);
      }
      const term = rawSearch.replace(/^@/, "");
      if (term && !/^[a-zA-Z0-9_ -]+$/.test(term)) {
        return json({ error: "Search using a username, referral code, or Telegram ID" }, 400);
      }

      let query = db
        .from("players")
        .select("id, telegram_id, username, first_name, referral_code, created_at")
        .order("created_at", { ascending: false })
        .limit(50);

      if (term) {
        if (/^\d+$/.test(term)) {
          query = query.or(`telegram_id.eq.${term},referral_code.ilike.%${term}%,username.ilike.%${term}%,first_name.ilike.%${term}%`);
        } else {
          query = query.or(`referral_code.ilike.%${term}%,username.ilike.%${term}%,first_name.ilike.%${term}%`);
        }
      }

      const { data, error } = await query;
      if (error) return json({ error: "Failed to load player records" }, 500);
      return json({ players: data ?? [] });
    }

    // READ-ONLY EVENT PARTICIPANT DIRECTORY for the selected event.
    if (body.action === "list_event_participants") {
      const eventId = typeof body.eventId === "string" ? body.eventId : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) {
        return json({ error: "A valid event ID is required" }, 400);
      }
      const [
        { data, error },
        { data: eventRow, error: eventError },
        { data: eventActivities, error: activitiesError },
      ] = await Promise.all([
        db
          .from("game_event_participations")
          .select("id, event_id, player_id, status, progress, registered_at, updated_at, completed_at, zp_reward_approved_at, zp_reward_approved_by, zp_reward_amount, players!inner(telegram_id, username, first_name, referral_code)")
          .eq("event_id", eventId)
          .order("registered_at", { ascending: false })
          .limit(500),
        db.from("game_events").select("id, starts_at, ends_at, timezone, objectives, requirements, reward_zp, reward_zap").eq("id", eventId).maybeSingle(),
        db.from("game_event_activities").select("id, mission_id, activity_type, is_required, config").eq("event_id", eventId),
      ]);
      if (error || eventError || activitiesError) {
        console.error("Event participant lookup failed:", error ?? eventError ?? activitiesError);
        return json({ error: "Failed to load event participants and verification rules" }, 500);
      }
      // Refresh trusted evidence from server records whenever an administrator opens
      // the participant list. This removes dependence on the player reopening the Mini App.
      let refreshedParticipants;
      try {
        refreshedParticipants = await mapInBatches(data ?? [], 8, async (participant) => {
          if (participant.status === "withdrawn" || !eventRow?.starts_at || !eventRow?.ends_at) {
            return participant;
          }
          const refreshed = await verifyConfiguredEventActivities(
            db,
            participant.player_id,
            eventRow,
            participant,
            eventActivities ?? [],
          );
          return { ...participant, ...refreshed };
        });
      } catch (verificationError) {
        console.error("Admin-triggered event verification failed:", verificationError);
        return json({ error: "Could not refresh verified event progress. Participant data was not marked complete." }, 500);
      }
      const participants = refreshedParticipants.map((participant) => ({
        ...participant,
        event_ends_at: eventRow?.ends_at ?? null,
        event_reward_zp: eventRow?.reward_zp ?? 0,
        event_reward_zap: eventRow?.reward_zap ?? 0,
      }));
      return json({ participants, participantLimit: 500, verificationRefreshed: true });
    }

    // ADMIN EVENT ACTIVITY MANAGEMENT. Configuration only; it does not mark player progress or issue rewards.
    if (body.action === "list_event_activities") {
      const eventId = typeof body.eventId === "string" ? body.eventId : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) {
        return json({ error: "A valid event ID is required" }, 400);
      }
      const { data, error } = await db
        .from("game_event_activities")
        .select("id, event_id, mission_id, activity_type, title, description, instructions, config, is_required, sort_order, created_at, updated_at")
        .eq("event_id", eventId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) return json({ error: "Failed to load event activities" }, 500);
      return json({ activities: data ?? [] });
    }

    if (body.action === "save_event_activity") {
      const activity = body.activity;
      const eventId = typeof activity?.eventId === "string" ? activity.eventId : "";
      const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const activityTypes = ["creator_submission_approved", "gameplay_verification"];
      if (!activity || !validUuid.test(eventId)) return json({ error: "A valid event is required" }, 400);
      if (typeof activity.title !== "string" || !activity.title.trim() || activity.title.trim().length > 120) {
        return json({ error: "Activity title must be between 1 and 120 characters" }, 400);
      }
      if (typeof activity.description !== "string" || activity.description.length > 2000 ||
          typeof activity.instructions !== "string" || activity.instructions.length > 5000) {
        return json({ error: "Activity description or instructions are too long" }, 400);
      }
      if (typeof activity.activityType !== "string" || !activityTypes.includes(activity.activityType)) {
        return json({ error: "Invalid activity type" }, 400);
      }
      const missionRequired = activity.activityType === "creator_submission_approved";
      if (missionRequired && (typeof activity.missionId !== "string" || !activity.missionId.trim())) {
        return json({ error: "Choose the mission this activity must verify" }, 400);
      }
      if (!missionRequired && activity.missionId) {
        return json({ error: "This activity type cannot reference a mission" }, 400);
      }
      if (typeof activity.isRequired !== "boolean" ||
          !Number.isSafeInteger(activity.sortOrder) || (activity.sortOrder ?? -1) < 0) {
        return json({ error: "Invalid required flag or display order" }, 400);
      }
      let config = activity.config ?? {};
      if (!config || typeof config !== "object" || Array.isArray(config) || JSON.stringify(config).length > 10000) {
        return json({ error: "Activity configuration must be a JSON object under 10,000 characters" }, 400);
      }
      if (activity.activityType === "gameplay_verification") {
        const target = config.fixesPerFragmentPerDay;
        const allowedFragments = ["top", "bottom", "left", "right"];
        const fragments = config.fragmentIds === undefined ? allowedFragments : config.fragmentIds;
        if (config.action !== "fragment_fixed" ||
            !Number.isSafeInteger(target) || target < 1 || target > 100 ||
            !Array.isArray(fragments) || fragments.length < 1 || fragments.length > 4 ||
            fragments.some((id: unknown) => typeof id !== "string" || !allowedFragments.includes(id)) ||
            new Set(fragments).size !== fragments.length) {
          return json({ error: "Gameplay challenges need 1–100 fixes per selected fragment per day and at least one unique valid fragment" }, 400);
        }
        config = { action: "fragment_fixed", fixesPerFragmentPerDay: target, fragmentIds: fragments };
      } else {
        config = {};
      }
      const { data: eventRow, error: eventError } = await db
        .from("game_events").select("id, starts_at").eq("id", eventId).maybeSingle();
      if (eventError || !eventRow) return json({ error: "Event not found" }, 404);
      if (eventRow.starts_at && new Date(eventRow.starts_at).getTime() <= Date.now()) {
        return json({ error: "Event activities are locked once the event starts." }, 409);
      }

      if (missionRequired) {
        const { data: mission, error: missionError } = await db
          .from("mission_tasks").select("id, kind").eq("id", activity.missionId).maybeSingle();
        if (missionError || !mission) return json({ error: "Selected mission was not found" }, 404);
        if (activity.activityType === "creator_submission_approved" && mission.kind !== "creator") {
          return json({ error: "Choose a Creator Ops mission for this activity" }, 400);
        }
      }

      const row = {
        event_id: eventId,
        mission_id: missionRequired ? activity.missionId : null,
        activity_type: activity.activityType,
        title: activity.title.trim(),
        description: activity.description.trim(),
        instructions: activity.instructions.trim(),
        config,
        is_required: activity.isRequired,
        sort_order: activity.sortOrder,
        updated_at: new Date().toISOString(),
      };
      if (activity.id) {
        if (!validUuid.test(activity.id)) return json({ error: "A valid activity ID is required" }, 400);
        const { data, error } = await db.from("game_event_activities")
          .update(row).eq("id", activity.id).eq("event_id", eventId).select("id").maybeSingle();
        if (error) return json({ error: "Failed to update event activity" }, 500);
        if (!data) return json({ error: "Event activity not found" }, 404);
        return json({ success: true, id: data.id });
      }
      const { data, error } = await db.from("game_event_activities")
        .insert(row).select("id").single();
      if (error || !data) return json({ error: "Failed to create event activity" }, 500);
      return json({ success: true, id: data.id });
    }

    if (body.action === "delete_event_activity") {
      const activityId = typeof body.activityId === "string" ? body.activityId : "";
      const eventId = typeof body.eventId === "string" ? body.eventId : "";
      const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!validUuid.test(activityId) || !validUuid.test(eventId)) {
        return json({ error: "Valid event and activity IDs are required" }, 400);
      }
      const { data: eventRow, error: eventError } = await db
        .from("game_events").select("starts_at").eq("id", eventId).maybeSingle();
      if (eventError || !eventRow) return json({ error: "Event not found" }, 404);
      if (eventRow.starts_at && new Date(eventRow.starts_at).getTime() <= Date.now()) {
        return json({ error: "Event activities are locked once the event starts." }, 409);
      }
      const { data, error } = await db.from("game_event_activities")
        .delete().eq("id", activityId).eq("event_id", eventId).select("id").maybeSingle();
      if (error) return json({ error: "Failed to delete event activity" }, 500);
      if (!data) return json({ error: "Event activity not found" }, 404);
      return json({ success: true });
    }

    // ADMIN-REVIEWED EVENT PARTICIPANT STATUS. Update and audit are one database transaction.
    if (body.action === "update_event_participant_status") {
      const participationId = typeof body.participationId === "string" ? body.participationId : "";
      const status = body.participationStatus;
      const allowedStatuses = ["registered", "in_progress", "submitted", "completed", "withdrawn"];
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(participationId)) {
        return json({ error: "A valid participation ID is required" }, 400);
      }
      if (typeof status !== "string" || !allowedStatuses.includes(status)) {
        return json({ error: "Invalid participant status" }, 400);
      }
      if (status === "completed") {
        const { data: participation, error: participationError } = await db
          .from("game_event_participations")
          .select("id, event_id, progress")
          .eq("id", participationId)
          .maybeSingle();
        if (participationError || !participation) {
          return json({ error: "Participant record not found" }, 404);
        }
        const { data: requiredActivities, error: activitiesError } = await db
          .from("game_event_activities")
          .select("id")
          .eq("event_id", participation.event_id)
          .eq("is_required", true);
        if (activitiesError) {
          return json({ error: "Could not verify required event activities" }, 500);
        }
        const progress = participation.progress && typeof participation.progress === "object" && !Array.isArray(participation.progress)
          ? participation.progress as Record<string, unknown>
          : {};
        const activityProgress = progress.activities && typeof progress.activities === "object" && !Array.isArray(progress.activities)
          ? progress.activities as Record<string, unknown>
          : {};
        const required = requiredActivities ?? [];
        const allRequiredVerified = required.length > 0 && required.every((activity) => {
          const evidence = activityProgress[activity.id];
          return !!evidence && typeof evidence === "object" && (evidence as Record<string, unknown>).verified === true;
        });
        if (!allRequiredVerified) {
          return json({ error: "Completion can only be recorded after every required activity has server-verified evidence." }, 409);
        }
      }
      const { data, error } = await db.rpc("admin_update_event_participant_status", {
        p_participation_id: participationId,
        p_status: status,
        p_admin_actor: ADMIN_USERNAME,
      });
      if (error) {
        console.error("Event participant status review failed:", error);
        return json({ error: "Failed to update and audit participant status" }, 500);
      }
      if (!data) return json({ error: "Event participant record not found" }, 404);
      return json({ success: true, participation: data, auditRecorded: true, rewardsIssued: false });
    }

    if (body.action === "approve_event_participant_reward") {
      const participationId = typeof body.participationId === "string" ? body.participationId : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(participationId)) {
        return json({ error: "A valid participation ID is required" }, 400);
      }
      const { data, error } = await db.rpc("admin_approve_event_participant_reward", {
        p_participation_id: participationId,
        p_admin_actor: ADMIN_USERNAME,
      });
      if (error) {
        console.error("Event reward approval failed:", error);
        return json({ error: error.message || "Event reward approval failed" }, 409);
      }
      if (!data || data.success !== true) {
        return json({ error: "Event reward approval could not be completed" }, 409);
      }
      return json(data);
    }

    // READ-ONLY PLAYER ECONOMY AND LEDGER DETAIL.
    if (body.action === "get_player_economy") {
      const playerId = typeof body.playerId === "string" ? body.playerId : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(playerId)) {
        return json({ error: "A valid player ID is required" }, 400);
      }

      const [economyRes, ledgerRes] = await Promise.all([
        db
          .from("player_economy")
          .select("player_id, zp_balance, lifetime_zp, pending_kickback, created_at, updated_at, last_accrued_at")
          .eq("player_id", playerId)
          .maybeSingle(),
        db
          .from("economy_ledger")
          .select("id, player_id, transaction_type, amount, balance_after, reference_id, description, created_at")
          .eq("player_id", playerId)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

      if (economyRes.error || ledgerRes.error) {
        return json({ error: "Failed to load player economy history" }, 500);
      }

      return json({
        economy: economyRes.data ?? null,
        ledger: ledgerRes.data ?? [],
        ledgerLimit: 50,
        zapBalanceAvailable: false,
      });
    }

    // REVIEW SUBMISSION AND CREDIT THE ACTUAL PLAYER
    if (body.action === "review_submission") {
      if (!body.submissionId || !body.decision) {
        return json(
          { error: "submissionId and decision required" },
          400
        );
      }

      if (
        body.decision !== "approved" &&
        body.decision !== "rejected"
      ) {
        return json({ error: "Invalid decision" }, 400);
      }

      // PostgreSQL handles the review and reward credit atomically.
      const { data, error } = await db.rpc(
        "admin_review_creator_submission",
        {
          p_submission_id: body.submissionId,
          p_decision: body.decision,
        }
      );

      if (error || !data || data.success !== true) {
        return json(
          {
            error:
              "Submission review failed. It may already have been reviewed, or the player's balance could not be updated.",
          },
          409
        );
      }

      return json(data);
    }

    if (body.action === "bulk_approve_submissions") {
      const ids = body.submissionIds;
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 ||
          ids.some((id) => typeof id !== "string" || !uuidPattern.test(id))) {
        return json({ error: "Select between 1 and 100 valid pending submissions" }, 400);
      }
      const { data, error } = await db.rpc("admin_bulk_approve_creator_submissions", {
        p_submission_ids: [...new Set(ids)],
      });
      if (error || !data || data.success !== true) {
        console.error("Bulk Creator Ops approval failed:", error);
        return json({ error: "Bulk approval could not be completed." }, 500);
      }
      return json(data);
    }


    // ADMIN OBJECTIVE REVIEW. Only this authenticated admin route can approve or reject evidence.
    if (body.action === "list_expedition_objective_reviews") {
      const expeditionId = typeof body.expeditionId === "string" ? body.expeditionId : "";
      const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (expeditionId && !validUuid.test(expeditionId)) return json({ error: "A valid Expedition ID is required" }, 400);
      let individualQuery = db.from("expedition_objective_progress")
        .select("id, expedition_id, objective_id, player_id, status, evidence, created_at, expedition_objectives!inner(title, objective_type, completion_scope)")
        .eq("status", "submitted").order("created_at", { ascending: true }).limit(100);
      let teamQuery = db.from("expedition_team_objective_progress")
        .select("id, expedition_id, objective_id, team_id, status, evidence, created_at, expedition_objectives!inner(title, objective_type, completion_scope), expedition_teams!inner(name)")
        .eq("status", "submitted").order("created_at", { ascending: true }).limit(100);
      if (expeditionId) {
        individualQuery = individualQuery.eq("expedition_id", expeditionId);
        teamQuery = teamQuery.eq("expedition_id", expeditionId);
      }
      const [individualRes, teamRes] = await Promise.all([individualQuery, teamQuery]);
      if (individualRes.error || teamRes.error) {
        console.error("Expedition objective review queue failed:", individualRes.error || teamRes.error);
        return json({ error: "Could not load submitted Expedition objectives" }, 500);
      }

      // expedition_id is intentionally not a declared PostgREST relationship on
      // either progress table. Resolve titles with a separate lookup instead of
      // embedding expeditions!inner(title), which fails with PGRST200.
      const individualRows = individualRes.data ?? [];
      const teamRows = teamRes.data ?? [];
      const expeditionIds = [...new Set([...individualRows, ...teamRows]
        .map((row) => row.expedition_id)
        .filter((id): id is string => typeof id === "string"))];
      let expeditionTitles = new Map<string, string>();
      if (expeditionIds.length > 0) {
        const { data: expeditionRows, error: expeditionError } = await db
          .from("expeditions").select("id, title").in("id", expeditionIds);
        if (expeditionError) {
          console.error("Expedition objective review title lookup failed:", expeditionError);
          return json({ error: "Could not load Expedition titles for submitted objectives" }, 500);
        }
        expeditionTitles = new Map((expeditionRows ?? []).map((row) => [row.id, row.title]));
      }
      return json({
        success: true,
        individualSubmissions: individualRows.map((row) => ({
          ...row,
          expeditions: { title: expeditionTitles.get(row.expedition_id) ?? "Expedition" },
        })),
        teamSubmissions: teamRows.map((row) => ({
          ...row,
          expeditions: { title: expeditionTitles.get(row.expedition_id) ?? "Expedition" },
        })),
        limitPerQueue: 100,
      });
    }

    if (body.action === "review_expedition_objective") {
      const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (typeof body.progressId !== "string" || !validUuid.test(body.progressId) ||
        (body.progressScope !== "individual" && body.progressScope !== "team") ||
        (body.objectiveDecision !== "verified" && body.objectiveDecision !== "rejected")) {
        return json({ error: "A valid submission, scope, and review decision are required" }, 400);
      }
      const reason = typeof body.reviewReason === "string" ? body.reviewReason.trim() : "";
      if (reason.length > 500) return json({ error: "Review reason must be 500 characters or fewer" }, 400);
      const { data, error } = await db.rpc("admin_review_expedition_objective", {
        p_progress_id: body.progressId, p_scope: body.progressScope,
        p_decision: body.objectiveDecision, p_actor: ADMIN_USERNAME, p_reason: reason || null,
      });
      if (error || !data || data.success !== true) {
        console.error("Expedition objective review failed:", error);
        return json({ error: error?.message || "Objective review could not be completed" }, 409);
      }
      return json({ ...data, rewardsIssued: false });
    }

    if (body.action === "issue_expedition_rewards") {
      const expeditionId = typeof body.expeditionId === "string" ? body.expeditionId : "";
      const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!validUuid.test(expeditionId)) return json({ error: "A valid Expedition ID is required" }, 400);

      const { data: prepared, error: prepareError } = await db.rpc("prepare_expedition_reward_issuances", { p_expedition_id: expeditionId });
      if (prepareError) {
        console.error("Expedition reward preparation failed:", prepareError);
        return json({ error: prepareError.message || "Could not prepare eligible rewards" }, 409);
      }

      const { data, error } = await db.rpc("admin_issue_expedition_rewards", {
        p_expedition_id: expeditionId,
        p_admin_actor: ADMIN_USERNAME,
      });
      if (error || !data || data.success !== true) {
        console.error("Expedition reward issuance failed:", error);
        return json({ error: error?.message || "Reward issuance could not be verified" }, 409);
      }
      return json({ ...data, pendingIssuancesCreated: Number(prepared ?? 0), balancesChanged: Number(data.issuedCount ?? 0) > 0 });
    }

    if (body.action === "prepare_expedition_rewards") {
      const expeditionId = typeof body.expeditionId === "string" ? body.expeditionId : "";
      const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
      if (!validUuid.test(expeditionId)) return json({ error: "A valid Expedition ID is required" }, 400);
      const { data, error } = await db.rpc("prepare_expedition_reward_issuances", { p_expedition_id: expeditionId });
      if (error) {
        console.error("Expedition reward preparation failed:", error);
        return json({ error: error.message || "Could not prepare pending reward records" }, 409);
      }
      return json({ success: true, pendingIssuancesCreated: Number(data ?? 0), balancesChanged: false });
    }

    // CREATE AN UNPUBLISHED EXPEDITION DRAFT. All writes use the service-role client
    // only after the existing server-side admin credential and rate-limit checks.
    if (body.action === "reschedule_expedition") {
      const id = body.expeditionId;
      if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "A valid Expedition ID is required" }, 400);
      if (typeof body.startsAt !== "string" || typeof body.endsAt !== "string") return json({ error: "Choose both a new start and end date" }, 400);
      const startsAt = new Date(body.startsAt);
      const endsAt = new Date(body.endsAt);
      const now = new Date();
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || startsAt <= now || endsAt <= startsAt) {
        return json({ error: "Choose a future start date and an end date later than the start" }, 400);
      }
      const { data: current, error: readError } = await db.from("expeditions")
        .select("id, title, status, starts_at, ends_at, registration_closes_at")
        .eq("id", id).maybeSingle();
      if (readError || !current) return json({ error: "Expedition not found" }, 404);
      if (!["scheduled", "registration_open"].includes(current.status) ||
          !current.starts_at || new Date(current.starts_at) <= now ||
          (current.registration_closes_at && new Date(current.registration_closes_at) <= now)) {
        return json({ error: "Only an Expedition that has not started and whose registration has not closed can be rescheduled" }, 409);
      }
      const { count, error: participationError } = await db.from("expedition_participations")
        .select("id", { count: "exact", head: true }).eq("expedition_id", id);
      if (participationError) return json({ error: "Could not verify Expedition registrations" }, 500);
      if ((count ?? 0) > 0) return json({ error: "This Expedition already has registered players or teams. Duplicate it to change its schedule." }, 409);
      const beforeState = { starts_at: current.starts_at, ends_at: current.ends_at, status: current.status };
      const { data: updated, error: updateError } = await db.from("expeditions").update({
        starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
        updated_by: ADMIN_USERNAME, updated_at: now.toISOString(),
      }).eq("id", id).eq("status", current.status).gt("starts_at", now.toISOString())
        .select("id").maybeSingle();
      if (updateError || !updated) return json({ error: "The Expedition could not be rescheduled. Refresh and try again." }, 409);
      const rollbackSchedule = async () => {
        const { error: rollbackError } = await db.from("expeditions").update({
          starts_at: current.starts_at, ends_at: current.ends_at, updated_by: ADMIN_USERNAME,
          updated_at: new Date().toISOString(),
        }).eq("id", id).eq("status", current.status);
        if (rollbackError) console.error("Expedition schedule rollback failed:", rollbackError);
        return !rollbackError;
      };
      const { count: registrationsAfterUpdate, error: finalCheckError } = await db.from("expedition_participations")
        .select("id", { count: "exact", head: true }).eq("expedition_id", id);
      if (finalCheckError || (registrationsAfterUpdate ?? 0) > 0) {
        const rolledBack = await rollbackSchedule();
        if (!rolledBack) return json({ error: "Reschedule conflict detected and automatic rollback failed. Contact support before changing this Expedition again." }, 500);
        return json({ error: finalCheckError ? "Could not re-check registrations; the schedule change was rolled back." : "A player registered during the change. The schedule was rolled back; duplicate this Expedition instead." }, finalCheckError ? 500 : 409);
      }
      const { error: auditError } = await db.from("expedition_audit_log").insert({
        expedition_id: id, actor: ADMIN_USERNAME, action: "rescheduled",
        before_state: beforeState, after_state: { starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), status: current.status },
      });
      if (auditError) {
        console.error("Expedition reschedule audit failed:", auditError);
        const rolledBack = await rollbackSchedule();
        return json({ error: rolledBack ? "Rescheduling was rolled back because its audit record could not be saved" : "Audit failed and automatic rollback failed. Contact support before changing this Expedition again." }, 500);
      }
      return json({ success: true });
    }

    if (body.action === "list_expeditions") {
      const { data: rows, error } = await db.from("expeditions")
        .select("id, slug, title, description, category, access_mode, participation_mode, status, starts_at, ends_at, timezone, min_team_size, max_team_size, min_individual_contributions")
        .order("created_at", { ascending: false }).limit(100);
      if (error) {
        console.error("Expedition list failed:", error);
        return json({ error: "Could not load saved Expeditions" }, 500);
      }
      const ids = (rows ?? []).map((row) => row.id);
      const [objectivesRes, rewardsRes] = ids.length ? await Promise.all([
        db.from("expedition_objectives").select("id, expedition_id, objective_type, title, completion_scope, sort_order").in("expedition_id", ids).order("sort_order"),
        db.from("expedition_rewards").select("expedition_id, reward_type, amount, recipient_scope").in("expedition_id", ids),
      ]) : [{ data: [], error: null }, { data: [], error: null }];
      if (objectivesRes.error || rewardsRes.error) {
        console.error("Expedition detail list failed:", objectivesRes.error || rewardsRes.error);
        return json({ error: "Could not load Expedition details" }, 500);
      }
      const objectivesById = new Map<string, unknown[]>();
      for (const item of objectivesRes.data ?? []) {
        const current = objectivesById.get(item.expedition_id) ?? [];
        current.push({ id: item.id, objective_type: item.objective_type, title: item.title, completion_scope: item.completion_scope, sort_order: item.sort_order });
        objectivesById.set(item.expedition_id, current);
      }
      const rewardById = new Map((rewardsRes.data ?? []).map((item) => [item.expedition_id, {
        reward_type: item.reward_type, amount: Number(item.amount), recipient_scope: item.recipient_scope,
      }]));
      return json({ success: true, expeditions: (rows ?? []).map((row) => ({
        ...row, objectives: objectivesById.get(row.id) ?? [], reward: rewardById.get(row.id) ?? null,
      })) });
    }

    if (body.action === "publish_expedition") {
      const id = body.expeditionId;
      if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "A valid Expedition ID is required" }, 400);
      const { data: current, error: readError } = await db.from("expeditions").select("id, status, title, starts_at, participation_mode").eq("id", id).maybeSingle();
      if (readError || !current) return json({ error: "Expedition not found" }, 404);
      if (current.status !== "draft") return json({ error: "Only an unpublished draft can be published" }, 409);
      const [{ count: objectiveCount, error: objectiveError }, { data: reward, error: rewardError }] = await Promise.all([
        db.from("expedition_objectives").select("id", { count: "exact", head: true }).eq("expedition_id", id),
        db.from("expedition_rewards").select("reward_type, amount").eq("expedition_id", id).maybeSingle(),
      ]);
      if (objectiveError || rewardError) return json({ error: "Could not validate Expedition before publishing" }, 500);
      if (!objectiveCount || !reward) return json({ error: "Add objectives and reward configuration before publishing" }, 400);
      if (["team", "both"].includes(current.participation_mode) && !current.starts_at) {
        return json({ error: "Set a future start date before publishing a team Expedition" }, 400);
      }
      // Publish changes only the admin lifecycle state. No player-facing read/claim path is enabled by this action.
      const nextStatus = current.starts_at && new Date(current.starts_at).getTime() > Date.now() ? "scheduled" : "registration_open";
      const { error: updateError } = await db.from("expeditions").update({
        status: nextStatus, updated_by: ADMIN_USERNAME, updated_at: new Date().toISOString(),
      }).eq("id", id).eq("status", "draft");
      if (updateError) {
        console.error("Expedition publish failed:", updateError);
        return json({ error: "Could not publish this Expedition" }, 500);
      }
      const { error: auditError } = await db.from("expedition_audit_log").insert({
        expedition_id: id, actor: ADMIN_USERNAME, action: "published",
        before_state: { status: "draft" }, after_state: { status: nextStatus },
      });
      if (auditError) {
        console.error("Expedition publish audit failed:", auditError);
        await db.from("expeditions").update({ status: "draft", updated_by: ADMIN_USERNAME }).eq("id", id).eq("status", nextStatus);
        return json({ error: "Publishing was rolled back because its audit record could not be saved" }, 500);
      }
      return json({ success: true, status: nextStatus, playerVisibility: true, rewardIssuance: "not_enabled" });
    }

    if (body.action === "save_expedition_draft") {
      const expedition = body.expedition;
      if (!expedition || typeof expedition !== "object") return json({ error: "Expedition details are required" }, 400);
      const title = typeof expedition.title === "string" ? expedition.title.trim() : "";
      const description = typeof expedition.description === "string" ? expedition.description.trim() : "";
      const categories: Record<string, string> = {
        "Open": "open", "Progressive": "progressive", "Seasonal": "seasonal", "Community": "community",
        "Competitive": "competitive", "Team": "team", "Special limited-time": "special_limited_time",
      };
      const objectiveKinds = ["briefing", "quiz", "game", "community", "external", "milestone"];
      const accessMode = expedition.accessMode;
      const participationMode = expedition.participationMode;
      const rewardType = expedition.rewardType;
      const rewardAmount = expedition.rewardAmount;
      const objectives = expedition.objectives;
      if (!title || title.length > 160) return json({ error: "Expedition name must be between 1 and 160 characters" }, 400);
      if (description.length > 2000) return json({ error: "Description must be 2,000 characters or fewer" }, 400);
      if (!expedition.category || !categories[expedition.category]) return json({ error: "Invalid Expedition category" }, 400);
      if (accessMode !== "open" && accessMode !== "progressive") return json({ error: "Invalid access mode" }, 400);
      if (!["solo", "team", "both"].includes(String(participationMode))) return json({ error: "Invalid participation mode" }, 400);
      const minTeam = expedition.minTeamSize;
      const maxTeam = expedition.maxTeamSize;
      const minContributions = expedition.minIndividualContributions;
      if (typeof minTeam !== "number" || !Number.isSafeInteger(minTeam) ||
          typeof maxTeam !== "number" || !Number.isSafeInteger(maxTeam) ||
          typeof minContributions !== "number" || !Number.isSafeInteger(minContributions) ||
          minTeam < 2 || maxTeam > 100 || maxTeam < minTeam || minContributions < 0) {
        return json({ error: "Invalid team size or contribution requirements" }, 400);
      }
      if (!["zp", "zap", "none"].includes(String(rewardType))) return json({ error: "Invalid reward type" }, 400);
      if (rewardType === "none" ? rewardAmount !== 0 : (!Number.isSafeInteger(rewardAmount) || Number(rewardAmount) <= 0)) {
        return json({ error: "Reward amount must be a positive whole number, or zero for no reward" }, 400);
      }
      if (!Array.isArray(objectives) || objectives.length < 1 || objectives.length > 20 ||
          objectives.some((item) => !item || !objectiveKinds.includes(String(item.kind)) ||
            typeof item.title !== "string" || !item.title.trim() || item.title.trim().length > 160 ||
            (item.scope !== undefined && !["individual", "team", "both"].includes(String(item.scope))))) {
        return json({ error: "Add between 1 and 20 valid objectives (maximum 160 characters each)" }, 400);
      }
      const startsAt = expedition.startsAt ? new Date(expedition.startsAt) : null;
      const endsAt = expedition.endsAt ? new Date(expedition.endsAt) : null;
      if ((expedition.startsAt && (!startsAt || Number.isNaN(startsAt.getTime()))) ||
          (expedition.endsAt && (!endsAt || Number.isNaN(endsAt.getTime()))) ||
          (startsAt && endsAt && startsAt >= endsAt)) {
        return json({ error: "Expedition schedule dates are invalid" }, 400);
      }
      const timezone = typeof expedition.timezone === "string" && expedition.timezone.trim() ? expedition.timezone.trim() : "UTC";
      try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); }
      catch { return json({ error: "Timezone must be a valid IANA timezone" }, 400); }

      const isUpdate = typeof body.expeditionId === "string" && /^[0-9a-f-]{36}$/i.test(body.expeditionId);
      let expeditionId = body.expeditionId;
      let slug = "";
      let beforeState: Record<string, unknown> = {};
      if (isUpdate) {
        const { data: current, error: currentError } = await db.from("expeditions")
          .select("id, slug, status, title, description, category, access_mode, participation_mode, starts_at, ends_at, timezone, min_team_size, max_team_size, min_individual_contributions")
          .eq("id", expeditionId!).maybeSingle();
        if (currentError || !current) return json({ error: "Expedition draft not found" }, 404);
        if (current.status !== "draft") return json({ error: "Only unpublished drafts can be edited" }, 409);
        const { count, error: participationError } = await db.from("expedition_participations")
          .select("id", { count: "exact", head: true }).eq("expedition_id", expeditionId!);
        if (participationError || (count ?? 0) > 0) return json({ error: "This Expedition already has participation and can no longer be edited as a draft" }, 409);
        slug = current.slug;
        beforeState = {
          title: current.title, description: current.description, category: current.category,
          access_mode: current.access_mode, participation_mode: current.participation_mode,
          starts_at: current.starts_at, ends_at: current.ends_at, timezone: current.timezone,
          min_team_size: current.min_team_size, max_team_size: current.max_team_size,
          min_individual_contributions: current.min_individual_contributions, status: current.status,
        };
        const { error: updateError } = await db.from("expeditions").update({
          title, description, category: categories[expedition.category], access_mode: accessMode,
          participation_mode: participationMode, starts_at: startsAt?.toISOString() ?? null,
          ends_at: endsAt?.toISOString() ?? null, timezone, min_team_size: minTeam, max_team_size: maxTeam,
          min_individual_contributions: minContributions, updated_by: ADMIN_USERNAME, updated_at: new Date().toISOString(),
        }).eq("id", expeditionId!).eq("status", "draft");
        if (updateError) return json({ error: "Could not update the Expedition draft" }, 500);
      } else {
        const slugBase = slugify(title).slice(0, 60) || "expedition";
        slug = `${slugBase}-${crypto.randomUUID().slice(0, 8)}`;
        const { data: created, error: createError } = await db.from("expeditions").insert({
          slug, title, description, category: categories[expedition.category], access_mode: accessMode,
          participation_mode: participationMode, status: "draft",
          starts_at: startsAt?.toISOString() ?? null, ends_at: endsAt?.toISOString() ?? null, timezone,
          min_team_size: minTeam, max_team_size: maxTeam, min_individual_contributions: minContributions,
          require_shared_team_objectives: true, created_by: ADMIN_USERNAME, updated_by: ADMIN_USERNAME,
        }).select("id, slug").single();
        if (createError || !created) {
          console.error("Expedition draft creation failed:", createError);
          return json({ error: "Could not create the Expedition draft" }, 500);
        }
        expeditionId = created.id;
      }

      const { data: oldObjectives } = isUpdate ? await db.from("expedition_objectives")
        .select("id, objective_type, title, sort_order").eq("expedition_id", expeditionId!) : { data: [] };
      const { data: oldReward } = isUpdate ? await db.from("expedition_rewards")
        .select("reward_type, amount, recipient_scope").eq("expedition_id", expeditionId!).maybeSingle() : { data: null };
      if (isUpdate) {
        const { error: deleteError } = await db.from("expedition_objectives").delete().eq("expedition_id", expeditionId!);
        if (deleteError) return json({ error: "Could not replace draft objectives" }, 500);
      }
      const objectiveRows = objectives.map((item, index) => ({
        expedition_id: expeditionId, objective_type: item.kind, title: item.title!.trim(),
        completion_scope: item.scope === "team" || item.scope === "both" ? item.scope : "individual", sort_order: index,
      }));
      const { error: objectiveError } = await db.from("expedition_objectives").insert(objectiveRows);
      const rewardPayload = {
        expedition_id: expeditionId, reward_type: rewardType, amount: rewardAmount,
        recipient_scope: participationMode === "team" ? "each_eligible_team_member" : "each_eligible_participant",
        updated_at: new Date().toISOString(),
      };
      const { error: rewardError } = objectiveError ? { error: null } :
        await db.from("expedition_rewards").upsert(rewardPayload, { onConflict: "expedition_id" });
      const { error: auditError } = objectiveError || rewardError ? { error: null } : await db.from("expedition_audit_log").insert({
        expedition_id: expeditionId, actor: ADMIN_USERNAME, action: isUpdate ? "draft_updated" : "draft_created",
        before_state: beforeState,
        after_state: { title, category: categories[expedition.category], status: "draft", objective_count: objectives.length },
      });
      if (objectiveError || rewardError || auditError) {
        console.error("Expedition draft detail save failed:", objectiveError || rewardError || auditError);
        if (isUpdate) {
          await db.from("expedition_objectives").delete().eq("expedition_id", expeditionId!);
          if (oldObjectives?.length) await db.from("expedition_objectives").insert(oldObjectives.map((item) => ({ ...item, expedition_id: expeditionId })));
          if (oldReward) await db.from("expedition_rewards").upsert({ expedition_id: expeditionId, ...oldReward }, { onConflict: "expedition_id" });
          await db.from("expeditions").update({
            title: beforeState.title, description: beforeState.description, category: beforeState.category,
            access_mode: beforeState.access_mode, participation_mode: beforeState.participation_mode,
            starts_at: beforeState.starts_at, ends_at: beforeState.ends_at, timezone: beforeState.timezone,
            min_team_size: beforeState.min_team_size, max_team_size: beforeState.max_team_size,
            min_individual_contributions: beforeState.min_individual_contributions,
            status: "draft", updated_by: ADMIN_USERNAME,
          }).eq("id", expeditionId!);
        } else {
          await db.from("expeditions").delete().eq("id", expeditionId!);
        }
        return json({ error: "Expedition draft could not be saved completely; changes were rolled back where possible" }, 500);
      }
      return json({ success: true, id: expeditionId, slug, status: "draft" });
    }


    // Intelligence Briefings admin actions run only after the existing admin credential and rate-limit checks.
    if (body.action === "list_briefings") {
      const { data: rows, error } = await db.from("briefings")
        .select("id, slug, title, summary, category, content, status, access_mode, prerequisite_briefing_id, sort_order, passing_score, reward_type, reward_amount, published_at, created_at, updated_at")
        .order("sort_order", { ascending: true }).order("created_at", { ascending: false }).limit(100);
      if (error) return json({ error: "Could not load Intelligence Briefings." }, 500);
      const ids = (rows ?? []).map((row) => row.id);
      const questionsRes = ids.length ? await db.from("briefing_questions")
        .select("id, briefing_id, prompt, options, correct_option_index, explanation, sort_order")
        .in("briefing_id", ids).order("sort_order", { ascending: true }) : { data: [], error: null };
      if (questionsRes.error) return json({ error: "Could not load briefing questions." }, 500);
      const byId = new Map<string, unknown[]>();
      for (const q of questionsRes.data ?? []) {
        const list = byId.get(q.briefing_id) ?? [];
        list.push({ id: q.id, prompt: q.prompt, options: q.options, correctOptionIndex: q.correct_option_index, explanation: q.explanation, sortOrder: q.sort_order });
        byId.set(q.briefing_id, list);
      }
      return json({ success: true, briefings: (rows ?? []).map((row) => ({ ...row, questions: byId.get(row.id) ?? [] })) });
    }

    if (body.action === "save_briefing_draft") {
      const item = body.briefing;
      if (!item || typeof item !== "object") return json({ error: "Briefing details are required." }, 400);
      const title = typeof item.title === "string" ? item.title.trim() : "";
      const summary = typeof item.summary === "string" ? item.summary.trim() : "";
      const category = typeof item.category === "string" ? item.category.trim().slice(0, 40) : "general";
      const content = item.content;
      const questions = item.questions;
      const rewardType = item.rewardType;
      const rewardAmount = item.rewardAmount;
      const passingScore = item.passingScore;
      const accessMode = item.accessMode;
      const prerequisiteId = item.prerequisiteBriefingId || null;
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (title.length < 3 || title.length > 120) return json({ error: "Briefing title must be 3–120 characters." }, 400);
      if (summary.length > 500) return json({ error: "Briefing summary must be 500 characters or fewer." }, 400);
      if (!["open", "progressive"].includes(String(accessMode))) return json({ error: "Choose open or progressive access." }, 400);
      if (accessMode === "progressive" && (!prerequisiteId || !uuid.test(String(prerequisiteId)))) return json({ error: "Choose a valid prerequisite briefing." }, 400);
      if (prerequisiteId && (!uuid.test(String(prerequisiteId)) || prerequisiteId === item.id)) return json({ error: "Invalid prerequisite briefing." }, 400);
      if (!Array.isArray(content) || content.length < 1 || content.length > 30 || content.some((block) =>
        !block || typeof block !== "object" || !["text", "image", "video"].includes(String(block.type)) ||
        (block.title !== undefined && (typeof block.title !== "string" || block.title.length > 160)) ||
        (block.body !== undefined && (typeof block.body !== "string" || block.body.length > 6000)) ||
        (block.url !== undefined && (typeof block.url !== "string" || block.url.length > 1000)))) {
        return json({ error: "Add 1–30 valid content blocks. Text, image and video blocks are supported." }, 400);
      }
      if (!Array.isArray(questions) || questions.length < 3 || questions.length > 10 || questions.some((q) =>
        !q || typeof q.prompt !== "string" || q.prompt.trim().length < 3 || q.prompt.length > 1000 ||
        !Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6 ||
        q.options.some((option) => typeof option !== "string" || !option.trim() || option.length > 300) ||
        !Number.isSafeInteger(q.correctOptionIndex) || q.correctOptionIndex < 0 || q.correctOptionIndex >= q.options.length ||
        (q.explanation !== undefined && (typeof q.explanation !== "string" || q.explanation.length > 1000)))) {
        return json({ error: "Add 3–10 valid quiz questions, each with 2–6 options and one correct answer." }, 400);
      }
      if (!["none", "zp", "zap"].includes(String(rewardType)) ||
          (rewardType === "none" ? rewardAmount !== 0 : (!Number.isSafeInteger(rewardAmount) || Number(rewardAmount) <= 0))) {
        return json({ error: "Set no reward, or a positive whole-number ZP/ZAP reward." }, 400);
      }
      if (!Number.isSafeInteger(passingScore) || Number(passingScore) < 1 || Number(passingScore) > 100) return json({ error: "Passing score must be 1–100." }, 400);
      if (prerequisiteId) {
        const { data: prerequisite } = await db.from("briefings").select("id, status").eq("id", prerequisiteId).maybeSingle();
        if (!prerequisite || prerequisite.status !== "published") return json({ error: "The prerequisite must be an existing published briefing." }, 400);
      }

      const isUpdate = typeof item.id === "string" && uuid.test(item.id);
      let id = item.id;
      if (isUpdate) {
        const { data: current, error: currentError } = await db.from("briefings").select("id, status").eq("id", id!).maybeSingle();
        if (currentError || !current) return json({ error: "Briefing draft not found." }, 404);
        if (current.status !== "draft") return json({ error: "Only draft briefings can be edited." }, 409);
        const { error: updateError } = await db.from("briefings").update({
          title, summary, category, content, access_mode: accessMode,
          prerequisite_briefing_id: prerequisiteId, passing_score: passingScore,
          reward_type: rewardType, reward_amount: rewardAmount, updated_by: ADMIN_USERNAME,
          updated_at: new Date().toISOString(),
        }).eq("id", id!).eq("status", "draft");
        if (updateError) return json({ error: "Could not update the briefing draft." }, 500);
        const { error: deleteError } = await db.from("briefing_questions").delete().eq("briefing_id", id!);
        if (deleteError) return json({ error: "Could not replace the briefing questions." }, 500);
      } else {
        const slug = (slugify(title) || "briefing") + "-" + crypto.randomUUID().slice(0, 8);
        const { data: created, error: createError } = await db.from("briefings").insert({
          slug, title, summary, category, content, access_mode: accessMode,
          prerequisite_briefing_id: prerequisiteId, passing_score: passingScore,
          reward_type: rewardType, reward_amount: rewardAmount, status: "draft",
          created_by: ADMIN_USERNAME, updated_by: ADMIN_USERNAME,
        }).select("id").single();
        if (createError || !created) return json({ error: "Could not create the briefing draft." }, 500);
        id = created.id;
      }
      const questionRows = questions.map((q, index) => ({
        briefing_id: id, prompt: q.prompt.trim(), options: q.options,
        correct_option_index: q.correctOptionIndex, explanation: q.explanation ?? "", sort_order: index,
      }));
      const { error: questionError } = await db.from("briefing_questions").insert(questionRows);
      if (questionError) {
        console.error("Briefing question save failed:", questionError);
        return json({ error: "Briefing was saved, but its questions could not be saved. Keep it as a draft and retry." }, 500);
      }
      return json({ success: true, id, status: "draft" });
    }

    if (body.action === "publish_briefing") {
      const id = typeof body.briefingId === "string" ? body.briefingId : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return json({ error: "A valid briefing ID is required." }, 400);
      const { data: current, error: readError } = await db.from("briefings").select("id, status, content").eq("id", id).maybeSingle();
      if (readError || !current) return json({ error: "Briefing not found." }, 404);
      if (current.status !== "draft") return json({ error: "Only a draft briefing can be published." }, 409);
      const { count, error: questionError } = await db.from("briefing_questions").select("id", { count: "exact", head: true }).eq("briefing_id", id);
      if (questionError || !count || !Array.isArray(current.content) || current.content.length === 0) return json({ error: "Add briefing content and quiz questions before publishing." }, 400);
      const { error: updateError } = await db.from("briefings").update({ status: "published", published_at: new Date().toISOString(), updated_by: ADMIN_USERNAME, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "draft");
      if (updateError) return json({ error: "Could not publish this briefing." }, 500);
      return json({ success: true, status: "published" });
    }

    // SAVE OR UPDATE TASK
    if (body.action === "save_task") {
      const task = body.task;

      if (!task) {
        return json({ error: "task is required" }, 400);
      }

      const validationError = validateTask(task);

      if (validationError) {
        return json({ error: validationError }, 400);
      }

      const row = {
        kind: task.kind,
        title: task.title!.trim(),
        description: task.description!.trim(),
        reward: task.reward,
        platform:
          task.kind === "creator"
            ? task.platform || null
            : null,
        action_url: task.actionUrl?.trim() || null,
        telegram_chat_id: task.telegramChatId?.trim() || null,
        reward_currency: task.rewardCurrency ?? "ZP",
        unlock_cost_zp: task.unlockCostZp ?? 0,
        status: task.status ?? "draft",
        objectives: task.objectives ?? [],
        requirements: task.requirements ?? [],
        updated_at: new Date().toISOString(),
      };

      if (task.id) {
        const { data, error } = await db
          .from("mission_tasks")
          .update(row)
          .eq("id", task.id)
          .select("id")
          .maybeSingle();

        if (error) {
          return json(
            { error: "Failed to update task" },
            500
          );
        }

        if (!data) {
          return json({ error: "Task not found" }, 404);
        }

        return json({ success: true, id: data.id });
      }

      const id = `${slugify(row.title)}-${Date.now().toString(36)}`;

      const { data, error } = await db
        .from("mission_tasks")
        .insert({ id, ...row })
        .select("id")
        .single();

      if (error || !data) {
        return json(
          { error: "Failed to create task" },
          500
        );
      }

      return json({ success: true, id: data.id });
    }

    // UPDATE VAULT RESERVES
    if (body.action === "save_vault_reserves") {
      const reserves = body.vaultReserves;
      const ton = reserves?.tonReserve;
      const zp = reserves?.zpReserve;

      if (
        typeof ton !== "number" ||
        !Number.isFinite(ton) ||
        ton < 0
      ) {
        return json(
          { error: "TON reserve must be 0 or more" },
          400
        );
      }

      if (
        typeof zp !== "number" ||
        !Number.isInteger(zp) ||
        zp < 0
      ) {
        return json(
          { error: "ZP reserve must be a whole number of 0 or more" },
          400
        );
      }

      const { data, error } = await db
        .from("vault_reserves")
        .upsert(
          {
            id: "global",
            ton_reserve: ton,
            zp_reserve: zp,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" },
        )
        .select("id")
        .single();

      if (error || data?.id !== "global") {
        console.error("Vault reserve upsert failed:", error);
        return json(
          { error: "Failed to update vault reserves" },
          500
        );
      }

      return json({ success: true, id: data.id });
    }

    // CREATE OR UPDATE EVENT
    if (body.action === "save_event") {
      const event = body.event;
      if (!event) return json({ error: "event is required" }, 400);

      const categories = ["daily", "weekly", "monthly", "special"];
      const statuses = ["draft", "published", "cancelled"];
      if (!event.title?.trim() || event.title.trim().length > 120) {
        return json({ error: "Event title must be between 1 and 120 characters" }, 400);
      }
      if (!event.category || !categories.includes(event.category)) {
        return json({ error: "Invalid event category" }, 400);
      }
      if (!event.status || !statuses.includes(event.status)) {
        return json({ error: "Invalid event status" }, 400);
      }
      if (typeof event.rewardZp !== "number" || !Number.isSafeInteger(event.rewardZp) || event.rewardZp < 0) {
        return json({ error: "Event ZP reward must be a whole number of 0 or more" }, 400);
      }
      const rewardZap = event.rewardZap ?? 0;
      if (typeof rewardZap !== "number" || !Number.isSafeInteger(rewardZap) || rewardZap < 0) {
        return json({ error: "Event ZAP reward must be a whole number of 0 or more" }, 400);
      }
      const minParticipants = event.minParticipants ?? null;
      const maxParticipants = event.maxParticipants ?? null;
      if (minParticipants !== null && (!Number.isSafeInteger(minParticipants) || minParticipants < 1)) {
        return json({ error: "Minimum participants must be a whole number of at least 1, or left blank" }, 400);
      }
      if (maxParticipants !== null && (!Number.isSafeInteger(maxParticipants) || maxParticipants < 1)) {
        return json({ error: "Maximum participants must be a whole number of at least 1, or left blank" }, 400);
      }
      if (minParticipants !== null && maxParticipants !== null && minParticipants > maxParticipants) {
        return json({ error: "Minimum participants cannot be greater than maximum participants" }, 400);
      }
      if (event.objectives !== undefined && !Array.isArray(event.objectives)) {
        return json({ error: "Objectives must be a JSON array" }, 400);
      }
      if (event.requirements !== undefined && !Array.isArray(event.requirements)) {
        return json({ error: "Requirements must be a JSON array" }, 400);
      }
      if (event.participationRules !== undefined && typeof event.participationRules !== "string") {
        return json({ error: "Participation rules must be plain text" }, 400);
      }

      const startsAt = event.startsAt ? new Date(event.startsAt) : null;
      const endsAt = event.endsAt ? new Date(event.endsAt) : null;
      if ((event.startsAt && (!startsAt || Number.isNaN(startsAt.getTime()))) ||
          (event.endsAt && (!endsAt || Number.isNaN(endsAt.getTime())))) {
        return json({ error: "Event dates must be valid timestamps" }, 400);
      }
      if (startsAt && endsAt && startsAt >= endsAt) {
        return json({ error: "Event end must be after its start" }, 400);
      }
      if (startsAt && endsAt && endsAt.getTime() - startsAt.getTime() > 365 * 24 * 60 * 60 * 1000) {
        return json({ error: "Events cannot run longer than 365 days." }, 400);
      }
      if (event.status === "published" && (!startsAt || !endsAt)) {
        return json({ error: "Add both start and end dates before publishing an event" }, 400);
      }
      const description = typeof event.description === "string" ? event.description.trim() : "";
      if (description.length > 2000) {
        return json({ error: "Event description must be 2,000 characters or fewer" }, 400);
      }
      const timezone = typeof event.timezone === "string" && event.timezone.trim()
        ? event.timezone.trim()
        : "UTC";
      if (timezone.length > 100) {
        return json({ error: "Timezone must be a valid IANA timezone" }, 400);
      }
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      } catch {
        return json({ error: "Timezone must be a valid IANA timezone" }, 400);
      }
      const objectives = event.objectives ?? [];
      const requirements = event.requirements ?? [];
      if (objectives.length > 50 || objectives.some((item: unknown) => typeof item !== "string" || item.length > 300)) {
        return json({ error: "Provide up to 50 objectives, each 300 characters or fewer" }, 400);
      }
      if (requirements.length > 50 || requirements.some((item: unknown) => typeof item !== "string" || item.length > 300)) {
        return json({ error: "Provide up to 50 requirements, each 300 characters or fewer" }, 400);
      }
      const participationRulesText = event.participationRules ?? "";
      if (participationRulesText.length > 10000) {
        return json({ error: "Participation rules must be 10,000 characters or fewer" }, 400);
      }

      if (event.id) {
        const { data: existingEvent, error: existingEventError } = await db
          .from("game_events")
          .select("starts_at, ends_at, timezone, reward_zp, reward_zap, min_participants, max_participants")
          .eq("id", event.id)
          .maybeSingle();
        if (existingEventError || !existingEvent) return json({ error: "Event not found" }, 404);
        if (existingEvent.starts_at && new Date(existingEvent.starts_at).getTime() <= Date.now()) {
          const scheduleChanged =
            new Date(existingEvent.starts_at).getTime() !== (startsAt?.getTime() ?? NaN) ||
            new Date(existingEvent.ends_at ?? "").getTime() !== (endsAt?.getTime() ?? NaN) ||
            existingEvent.timezone !== timezone;
          const rewardChanged =
            Number(existingEvent.reward_zp) !== event.rewardZp ||
            Number(existingEvent.reward_zap ?? 0) !== rewardZap;
          const capacityChanged =
            (existingEvent.min_participants ?? null) !== minParticipants ||
            (existingEvent.max_participants ?? null) !== maxParticipants;
          if (scheduleChanged || rewardChanged || capacityChanged) {
            return json({ error: "Event schedule, reward amounts, and participant limits are locked once the event starts." }, 409);
          }
        }
      }

      const row = {
        title: event.title.trim(),
        description,
        category: event.category,
        status: event.status,
        starts_at: startsAt?.toISOString() ?? null,
        ends_at: endsAt?.toISOString() ?? null,
        timezone,
        reward_zp: event.rewardZp,
        reward_zap: rewardZap,
        min_participants: minParticipants,
        max_participants: maxParticipants,
        objectives,
        requirements,
        participation_rules: participationRulesText,
        updated_at: new Date().toISOString(),
        published_at: event.status === "published" ? new Date().toISOString() : null,
        cancelled_at: event.status === "cancelled" ? new Date().toISOString() : null,
      };

      if (event.id) {
        const { data, error } = await db.from("game_events").update(row).eq("id", event.id).select("id").maybeSingle();
        if (error) return json({ error: "Failed to update event" }, 500);
        if (!data) return json({ error: "Event not found" }, 404);
        return json({ success: true, id: data.id });
      }

      const { data, error } = await db.from("game_events").insert(row).select("id").single();
      if (error || !data) return json({ error: "Failed to create event" }, 500);
      return json({ success: true, id: data.id });
    }

    // DELETE EVENT
    if (body.action === "delete_event") {
      if (!body.eventId) return json({ error: "eventId required" }, 400);
      const { data: eventToDelete, error: lookupError } = await db
        .from("game_events").select("starts_at").eq("id", body.eventId).maybeSingle();
      if (lookupError || !eventToDelete) return json({ error: "Event not found" }, 404);
      if (eventToDelete.starts_at && new Date(eventToDelete.starts_at).getTime() <= Date.now()) {
        return json({ error: "Events cannot be deleted after they start. Cancel the event instead." }, 409);
      }
      const { error } = await db.from("game_events").delete().eq("id", body.eventId);
      if (error) return json({ error: "Failed to delete event" }, 500);
      return json({ success: true });
    }

    // DELETE TASK
    if (body.action === "delete_task") {
      if (!body.taskId) {
        return json({ error: "taskId required" }, 400);
      }

      const { error } = await db
        .from("mission_tasks")
        .delete()
        .eq("id", body.taskId);

      if (error) {
        return json(
          { error: "Failed to delete task" },
          500
        );
      }

      return json({ success: true });
    }

    // Reserve the complete prize pool before any raffle can be published.
    // The database RPC locks the raffle and reserve rows and is idempotent.
    if (body.action === "reserve_raffle_prize") {
      const raffleId = typeof body.raffle?.id === "string" ? body.raffle.id : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raffleId)) {
        return json({ error: "A valid raffle ID is required." }, 400);
      }
      const { data, error } = await db.rpc("reserve_raffle_prize", {
        p_raffle_id: raffleId,
        p_admin: ADMIN_USERNAME,
      });
      if (error || !data) {
        console.error("Raffle prize reservation failed:", error);
        const message = error?.message ?? "Could not reserve this prize pool.";
        return json({ error: message }, 409);
      }
      return json(data);
    }

    // Publish only after the database verifies an exact, fully reserved prize pool.
    if (body.action === "publish_raffle") {
      const raffleId = typeof body.raffle?.id === "string" ? body.raffle.id : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raffleId)) {
        return json({ error: "A valid raffle ID is required." }, 400);
      }
      const { data, error } = await db.rpc("publish_raffle", {
        p_raffle_id: raffleId,
        p_admin: ADMIN_USERNAME,
      });
      if (error || !data || data.success !== true || data.status !== "published") {
        console.error("Raffle publishing failed:", error);
        const message = error?.message ?? data?.error ?? "Could not verify raffle publishing.";
        return json({ error: message }, 409);
      }
      return json(data);
    }

    // Record externally sourced ZAP only after the signed-in Admin has checked the
    // deposit outside ZORD. The database RPC atomically audits and increases the
    // separate raffle reserve; it never credits a player wallet.
    if (body.action === "list_raffles") {
      const { data: raffles, error } = await db
        .from("raffles")
        .select("id,title,description,reward_type,reward_code,prize_pool_amount,prize_currency,funding_source,min_bet_zap,entry_mode,winner_count,winner_method,status,starts_at,ends_at,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) {
        console.error("Admin raffle list failed:", error);
        return json({ error: "Could not load raffles." }, 500);
      }
      return json({ success: true, raffles: raffles ?? [] });
    }

    if (body.action === "save_raffle_draft") {
      const raffle = body.raffle;
      if (!raffle || typeof raffle !== "object") return json({ error: "Raffle details are required." }, 400);
      const title = typeof raffle.title === "string" ? raffle.title.trim() : "";
      const description = typeof raffle.description === "string" ? raffle.description.trim() : "";
      const rewardType = raffle.rewardType;
      const rewardCode = raffle.rewardCode ?? null;
      const amount = Number(raffle.prizePoolAmount);
      const minBet = Number(raffle.minBetZap);
      const winnerCount = Number(raffle.winnerCount);
      const entryMode = raffle.entryMode;
      const winnerMethod = raffle.winnerMethod;
      const fundingSource = rewardType === "ton" ? "external" : raffle.fundingSource;
      const startsAt = raffle.startsAt ?? null;
      const endsAt = raffle.endsAt ?? null;

      if (title.length < 3 || title.length > 120 || description.length > 2000) return json({ error: "Enter a title between 3 and 120 characters and a description under 2,000 characters." }, 400);
      if (!["ton", "zap"].includes(String(rewardType))) return json({ error: "Only TON and ZAP prizes are supported." }, 400);
      if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(minBet) || minBet <= 0) return json({ error: "Prize pool and minimum bet must be positive amounts." }, 400);
      if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 100) return json({ error: "Winner count must be between 1 and 100." }, 400);
      if (!["one_bet_one_entry", "proportional"].includes(String(entryMode))) return json({ error: "Choose a valid entry method." }, 400);
      if (!["random", "admin"].includes(String(winnerMethod))) return json({ error: "Choose a valid winner selection method." }, 400);
      if (!["treasury", "external"].includes(String(fundingSource))) return json({ error: "Choose a valid prize funding source." }, 400);
      if (rewardCode !== null) return json({ error: "Agent prizes are no longer supported." }, 400);
      if (startsAt && (!Number.isFinite(Date.parse(startsAt)))) return json({ error: "The start date is invalid." }, 400);
      if (endsAt && (!Number.isFinite(Date.parse(endsAt)))) return json({ error: "The closing date is invalid." }, 400);
      if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) return json({ error: "The closing date must be after the start date." }, 400);

      const values = {
        title,
        description,
        reward_type: rewardType,
        reward_code: rewardCode,
        prize_pool_amount: amount,
        prize_currency: rewardType === "ton" ? "TON" : "ZAP",
        funding_source: fundingSource,
        min_bet_zap: minBet,
        entry_mode: entryMode,
        winner_count: winnerCount,
        winner_method: winnerMethod,
        status: "draft",
        starts_at: startsAt,
        ends_at: endsAt,
        updated_by: ADMIN_USERNAME,
        updated_at: new Date().toISOString(),
      };

      let saved;
      if (raffle.id) {
        const { data, error } = await db.from("raffles").update(values).eq("id", raffle.id).eq("status", "draft").select("*").maybeSingle();
        if (error) {
          console.error("Admin raffle draft update failed:", error);
          return json({ error: "Could not update this raffle draft." }, 500);
        }
        if (!data) return json({ error: "Only an existing draft can be edited." }, 409);
        saved = data;
      } else {
        const { data, error } = await db.from("raffles").insert({ ...values, created_by: ADMIN_USERNAME }).select("*").single();
        if (error || !data) {
          console.error("Admin raffle draft creation failed:", error);
          return json({ error: "Could not save the raffle draft." }, 500);
        }
        saved = data;
      }

      const { error: auditError } = await db.from("raffle_audit_log").insert({
        raffle_id: saved.id,
        actor: ADMIN_USERNAME,
        action: "draft_saved",
        details: { title: saved.title, rewardType: saved.reward_type, prizePoolAmount: saved.prize_pool_amount },
      });
      if (auditError) console.error("Raffle draft audit record failed:", auditError);

      return json({ success: true, raffle: saved });
    }

    if (body.action === "confirm_external_zap_funding") {
      const amount = body.zapAmount;
      const reference = typeof body.transactionReference === "string"
        ? body.transactionReference.trim()
        : "";
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 ||
          Number(amount.toFixed(8)) !== amount) {
        return json({ error: "Enter a positive ZAP amount with up to 8 decimal places" }, 400);
      }
      if (reference.length < 3 || reference.length > 200) {
        return json({ error: "Enter a transaction reference between 3 and 200 characters" }, 400);
      }
      const { data, error } = await db.rpc("confirm_external_raffle_zap_funding", {
        p_amount: amount,
        p_transaction_reference: reference,
        p_confirmed_by: ADMIN_USERNAME,
      });
      if (error) {
        if (error.code === "23505") {
          return json({ error: "This transaction reference has already been recorded" }, 409);
        }
        console.error("External ZAP funding confirmation failed:", error);
        return json({ error: "Could not confirm external ZAP funding" }, 500);
      }
      return json(data);
    }

    // Read-only funding history and current verified raffle reserve.
    if (body.action === "list_external_zap_funding") {
      const { data, error } = await db.rpc("get_external_raffle_zap_funding");
      if (error || !data || typeof data !== "object") {
        console.error("External ZAP funding history lookup failed:", error);
        return json({ error: "Could not load external ZAP funding records" }, 500);
      }
      return json(data);
    }

    if (body.action === "confirm_external_ton_funding") {
      const amount = body.tonAmount;
      const reference = typeof body.transactionReference === "string"
        ? body.transactionReference.trim()
        : "";
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 ||
          Number(amount.toFixed(9)) !== amount) {
        return json({ error: "Enter a positive TON amount with up to 9 decimal places" }, 400);
      }
      if (reference.length < 32 || reference.length > 200) {
        return json({ error: "Enter the TON transaction hash/reference (32–200 characters)" }, 400);
      }
      const { data, error } = await db.rpc("confirm_external_raffle_ton_funding", {
        p_amount: amount,
        p_transaction_reference: reference,
        p_confirmed_by: ADMIN_USERNAME,
      });
      if (error) {
        if (error.code === "23505") {
          return json({ error: "This TON transaction reference has already been recorded" }, 409);
        }
        console.error("External TON funding confirmation failed:", error);
        return json({ error: "Could not confirm external TON funding" }, 500);
      }
      return json(data);
    }

    if (body.action === "list_external_ton_funding") {
      const { data, error } = await db.rpc("get_external_raffle_ton_funding");
      if (error || !data || typeof data !== "object") {
        console.error("External TON funding history lookup failed:", error);
        return json({ error: "Could not load external TON funding records" }, 500);
      }
      return json(data);
    }

    if (body.action === "get_referral_kickback_budget") {
      const { data, error } = await db.rpc("admin_get_referral_kickback_budget");
      if (error || !data || typeof data !== "object") {
        console.error("Referral kickback budget lookup failed:", error);
        return json({ error: "Could not load referral kickback budget." }, 500);
      }
      return json(data);
    }

    if (body.action === "set_referral_kickback_budget") {
      const amount = body.monthlyKickbackBudgetZp;
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || Number(amount.toFixed(6)) !== amount) {
        return json({ error: "Enter a non-negative monthly ZP budget with up to 6 decimal places." }, 400);
      }
      const { data, error } = await db.rpc("admin_set_referral_kickback_budget", {
        p_budget_zp: amount,
        p_admin_username: ADMIN_USERNAME,
      });
      if (error || !data || typeof data !== "object") {
        console.error("Referral kickback budget update failed:", error);
        const message = error?.message ?? "Could not update referral kickback budget.";
        return json({ error: message }, /allocated|reduce|below/i.test(message) ? 409 : 500);
      }
      return json(data);
    }

    if (body.action === "list_referral_management") {
      const { data, error } = await db.rpc("admin_get_referral_management");
      if (error || !data || typeof data !== "object") {
        console.error("Referral management lookup failed:", error);
        return json({ error: "Could not load referral management records." }, 500);
      }
      return json({ success: true, ...data });
    }

    if (body.action === "set_referral_account_status") {
      const playerId = typeof body.playerId === "string" ? body.playerId : "";
      const status = body.referralStatus;
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!validUuid.test(playerId)) return json({ error: "A valid player account is required." }, 400);
      if (!["active", "held", "suspended"].includes(String(status))) return json({ error: "Choose a valid referral account status." }, 400);
      if (reason.length > 500) return json({ error: "The referral account reason must be 500 characters or fewer." }, 400);
      const { data, error } = await db.rpc("admin_set_referral_kickback_account_status", {
        p_player_id: playerId,
        p_status: status,
        p_reason: reason || null,
        p_admin_username: ADMIN_USERNAME,
      });
      if (error || !data || typeof data !== "object" || data.success !== true || data.status !== status) {
        console.error("Referral account status update failed:", error);
        return json({ error: error?.message ?? "Could not update the referral account." }, 409);
      }
      return json(data);
    }

    if (body.action === "list_ton_withdrawals") {
      const { data, error } = await db.rpc("admin_list_ton_withdrawals");
      if (error || !data || typeof data !== "object") {
        console.error("TON withdrawal queue lookup failed:", error);
        return json({ error: "Could not load TON withdrawal requests" }, 500);
      }
      return json(data);
    }

    if (body.action === "review_ton_withdrawal") {
      const requestId = typeof body.tonWithdrawalId === "string" ? body.tonWithdrawalId : "";
      const action = body.withdrawalAction;
      const note = typeof body.adminNote === "string" ? body.adminNote.trim() : "";
      const transactionHash = typeof body.transactionHash === "string" ? body.transactionHash.trim() : "";
      const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!validUuid.test(requestId)) return json({ error: "A valid withdrawal request is required" }, 400);
      if (!["approve", "reject", "processing", "paid"].includes(String(action))) {
        return json({ error: "Choose a valid withdrawal action" }, 400);
      }
      if (note.length > 1000) return json({ error: "Admin note must be 1,000 characters or fewer" }, 400);
      if (action === "paid" && (transactionHash.length < 32 || transactionHash.length > 200 || /\s/.test(transactionHash))) {
        return json({ error: "Enter the TON transaction hash or reference (32–200 characters, no spaces)" }, 400);
      }
      const { data, error } = await db.rpc("admin_transition_ton_withdrawal", {
        p_request_id: requestId,
        p_action: action,
        p_admin_username: ADMIN_USERNAME,
        p_admin_note: note || null,
        p_transaction_hash: transactionHash || null,
      });
      if (error || !data || typeof data !== "object") {
        console.error("TON withdrawal review failed:", error);
        const message = error?.message ?? "Could not update this withdrawal request";
        const status = /not found/i.test(message) ? 404 : 409;
        return json({ error: message }, status);
      }
      return json(data);
    }


    // ADMIN OPERATIONS: all writes remain behind the same server-side admin
    // credential check and use service-role access only inside this function.
    if (body.action === "get_global_mining_settings") {
      const { data, error } = await db.rpc("admin_get_global_gameplay_settings");
      if (error || !data || typeof data !== "object") {
        console.error("Global mining settings lookup failed:", error);
        return json({ error: "Could not load global mining settings. Apply the Admin operations Preview migration first." }, 503);
      }
      return json(data);
    }

    if (body.action === "set_global_mining_settings") {
      if (typeof body.miningEnabled !== "boolean" ||
          typeof body.miningRateMultiplier !== "number" ||
          !Number.isFinite(body.miningRateMultiplier) ||
          body.miningRateMultiplier < 0.10 || body.miningRateMultiplier > 5.00 ||
          Math.round(body.miningRateMultiplier * 100) !== body.miningRateMultiplier * 100) {
        return json({ error: "Mining rate must be between 0.10 and 5.00 with up to two decimal places." }, 400);
      }
      const { data, error } = await db.rpc("admin_set_global_gameplay_settings", {
        p_enabled: body.miningEnabled,
        p_rate_multiplier: body.miningRateMultiplier,
        p_admin_username: ADMIN_USERNAME,
      });
      if (error || !data || typeof data !== "object") {
        console.error("Global mining settings update failed:", error);
        return json({ error: error?.message ?? "Could not update global mining settings." }, 409);
      }
      return json(data);
    }

    if (body.action === "flush_api_cache") {
      const { data, error } = await db.rpc("admin_flush_api_schema_cache");
      if (error || !data || typeof data !== "object" || data.success !== true) {
        console.error("PostgREST schema cache refresh failed:", error);
        return json({ error: "Could not refresh the PostgREST API schema cache." }, 503);
      }
      return json(data);
    }

    if (body.action === "export_player_data") {
      const pageSize = 1000;
      const playerRows: Array<{
        id: string; username: string | null; first_name: string | null;
        referral_code: string; created_at: string;
      }> = [];
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await db.from("players")
          .select("id, username, first_name, referral_code, created_at")
          .order("created_at", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) {
          console.error("Admin player export lookup failed:", error);
          return json({ error: "Could not prepare the player export." }, 500);
        }
        playerRows.push(...(data ?? []));
        if (!data || data.length < pageSize) break;
        if (playerRows.length >= 10000) {
          return json({ error: "The export is larger than the safe 10,000-row limit. Use a filtered export workflow." }, 413);
        }
      }

      const economyByPlayer = new Map<string, { zp_balance: number; lifetime_zp: number }>();
      for (let offset = 0; offset < playerRows.length; offset += pageSize) {
        const ids = playerRows.slice(offset, offset + pageSize).map((player) => player.id);
        if (!ids.length) continue;
        const { data, error } = await db.from("player_economy")
          .select("player_id, zp_balance, lifetime_zp")
          .in("player_id", ids);
        if (error) {
          console.error("Admin player economy export lookup failed:", error);
          return json({ error: "Could not prepare the player economy export." }, 500);
        }
        for (const row of data ?? []) {
          economyByPlayer.set(row.player_id, {
            zp_balance: Number(row.zp_balance ?? 0),
            lifetime_zp: Number(row.lifetime_zp ?? 0),
          });
        }
      }

      return json({
        success: true,
        rows: playerRows.map((player) => ({
          player_id: player.id,
          username: player.username,
          first_name: player.first_name,
          referral_code: player.referral_code,
          account_created_at: player.created_at,
          zp_balance: economyByPlayer.get(player.id)?.zp_balance ?? 0,
          lifetime_zp: economyByPlayer.get(player.id)?.lifetime_zp ?? 0,
        })),
        excludedFields: ["telegram_id", "wallet addresses", "authentication credentials", "secrets"],
      });
    }

    if (body.action === "send_broadcast") {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const message = typeof body.message === "string" ? body.message.trim() : "";
      const channels = Array.isArray(body.channels) ? [...new Set(body.channels)] : [];
      if (!title || title.length > 120 || !message || message.length > 4000 ||
          title.length + message.length + 2 > 4096 ||
          channels.length < 1 || channels.some((channel) => !["in_app", "telegram"].includes(channel))) {
        return json({ error: "Provide a title, a message of up to 4,000 characters, and at least one valid delivery channel. Combined Telegram text must be 4,096 characters or fewer." }, 400);
      }

      const sendTelegram = channels.includes("telegram");
      const botToken = Deno.env.get("BOT_TOKEN") ?? "";
      if (sendTelegram && !botToken) {
        return json({ error: "Telegram delivery is unavailable because the server-side BOT_TOKEN is not configured." }, 503);
      }

      let recipients: Array<{ telegram_id: number | string }> = [];
      if (sendTelegram) {
        const { data, error } = await db.from("players")
          .select("telegram_id")
          .not("telegram_id", "is", null)
          .order("created_at", { ascending: true })
          .limit(1001);
        if (error) {
          console.error("Telegram broadcast recipient lookup failed:", error);
          return json({ error: "Could not load Telegram broadcast recipients." }, 500);
        }
        recipients = data ?? [];
        if (recipients.length > 1000) {
          return json({ error: "This broadcast exceeds the safe 1,000-recipient Preview batch. Split the audience before sending." }, 413);
        }
      }

      const { data: announcement, error: announcementError } = await db
        .from("zord_announcements")
        .insert({
          title,
          message,
          in_app_enabled: channels.includes("in_app"),
          telegram_enabled: sendTelegram,
          created_by: ADMIN_USERNAME,
          expires_at: channels.includes("in_app") ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null,
        })
        .select("id")
        .single();
      if (announcementError || !announcement) {
        console.error("Admin announcement insert failed:", announcementError);
        return json({ error: "Could not publish the in-app announcement." }, 500);
      }

      let telegramSent = 0;
      let telegramFailed = 0;
      let telegramSkipped = 0;
      if (sendTelegram) {
        const text = title + "\\n\\n" + message;
        const sendOne = async (chatId: number | string) => {
          try {
            const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
            });
            const result = await response.json().catch(() => null);
            if (response.ok && result?.ok === true) return "sent" as const;
            if (response.status === 403 || result?.error_code === 403) return "skipped" as const;
            return "failed" as const;
          } catch {
            return "failed" as const;
          }
        };

        for (let offset = 0; offset < recipients.length; offset += 20) {
          const batch = recipients.slice(offset, offset + 20);
          const results = await Promise.all(batch.map((recipient) => sendOne(recipient.telegram_id)));
          telegramSent += results.filter((result) => result === "sent").length;
          telegramSkipped += results.filter((result) => result === "skipped").length;
          telegramFailed += results.filter((result) => result === "failed").length;
          if (offset + 20 < recipients.length) await new Promise((resolve) => setTimeout(resolve, 700));
        }

        const { error: statsError } = await db.from("zord_announcements")
          .update({ telegram_sent: telegramSent, telegram_failed: telegramFailed })
          .eq("id", announcement.id);
        if (statsError) console.error("Could not save Telegram broadcast delivery counts:", statsError);
      }

      return json({
        success: true,
        announcementId: announcement.id,
        inAppPublished: channels.includes("in_app"),
        telegramSent,
        telegramFailed,
        telegramSkipped,
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch {
    return json({ error: "Request failed" }, 500);
  }
});
