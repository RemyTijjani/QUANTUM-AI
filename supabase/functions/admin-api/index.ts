
import { createClient } from "npm:@supabase/supabase-js@2";
import { mapInBatches, verifyConfiguredEventActivities } from "../_shared/event-verification.ts";

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
    | "list_players"
    | "get_player_economy"
    | "list_event_participants"
    | "update_event_participant_status"
    | "approve_event_participant_reward"
    | "list_event_activities"
    | "save_event_activity"
    | "delete_event_activity";
  adminUsername?: string;
  search?: string;
  playerId?: string;
  adminPassword?: string;
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
  expedition?: {
    title?: string; description?: string; category?: string; accessMode?: string; participationMode?: string;
    minTeamSize?: number; maxTeamSize?: number; minIndividualContributions?: number;
    startsAt?: string | null; endsAt?: string | null; timezone?: string;
    rewardType?: string; rewardAmount?: number;
    objectives?: Array<{ kind?: string; title?: string }>;
  };
  eventId?: string;
  participationId?: string;
  participationStatus?: string;
  activityId?: string;
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
            "id, kind, title, description, reward, platform, action_url, reward_currency, unlock_cost_zp, status, objectives, requirements"
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

    // CREATE AN UNPUBLISHED EXPEDITION DRAFT. All writes use the service-role client
    // only after the existing server-side admin credential and rate-limit checks.
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
            typeof item.title !== "string" || !item.title.trim() || item.title.trim().length > 160)) {
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

      const slugBase = slugify(title).slice(0, 60) || "expedition";
      const slug = `${slugBase}-${crypto.randomUUID().slice(0, 8)}`;
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

      const objectiveRows = objectives.map((item, index) => ({
        expedition_id: created.id, objective_type: item.kind, title: item.title!.trim(), sort_order: index,
      }));
      const { error: objectiveError } = await db.from("expedition_objectives").insert(objectiveRows);
      const { error: rewardError } = objectiveError ? { error: null } : await db.from("expedition_rewards").insert({
        expedition_id: created.id, reward_type: rewardType, amount: rewardAmount,
        recipient_scope: participationMode === "team" ? "each_eligible_team_member" : "each_eligible_participant",
      });
      const { error: auditError } = objectiveError || rewardError ? { error: null } : await db.from("expedition_audit_log").insert({
        expedition_id: created.id, actor: ADMIN_USERNAME, action: "draft_created",
        after_state: { title, category: categories[expedition.category], status: "draft", objective_count: objectives.length },
      });
      if (objectiveError || rewardError || auditError) {
        console.error("Expedition draft detail save failed:", objectiveError || rewardError || auditError);
        await db.from("expeditions").delete().eq("id", created.id);
        return json({ error: "Expedition draft could not be saved completely; the incomplete draft was rolled back" }, 500);
      }
      return json({ success: true, id: created.id, slug: created.slug, status: "draft" });
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

    return json({ error: "Unknown action" }, 400);
  } catch {
    return json({ error: "Request failed" }, 500);
  }
});
