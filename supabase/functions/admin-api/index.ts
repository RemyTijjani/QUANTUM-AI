
import { createClient } from "npm:@supabase/supabase-js@2";

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
    | "fetch_dashboard"
    | "save_task"
    | "delete_task"
    | "save_vault_reserves"
    | "save_event"
    | "delete_event"
    | "list_players"
    | "get_player_economy"
    | "list_event_participants"
    | "update_event_participant_status";
  adminUsername?: string;
  search?: string;
  playerId?: string;
  adminPassword?: string;
  submissionId?: string;
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
    objectives?: unknown;
    requirements?: unknown;
    participationRules?: unknown;
  };
  eventId?: string;
  participationId?: string;
  participationStatus?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

    const isAdmin =
      ADMIN_USERNAME !== "" &&
      ADMIN_PASSWORD !== "" &&
      body.adminUsername === ADMIN_USERNAME &&
      body.adminPassword === ADMIN_PASSWORD;

    if (!isAdmin) {
      return json({ error: "Unauthorized" }, 401);
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

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
          .select("id, title, description, category, status, starts_at, ends_at, timezone, reward_zp, reward_zap, objectives, requirements, participation_rules, created_at, updated_at")
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
      const { data, error } = await db
        .from("game_event_participations")
        .select("id, event_id, status, registered_at, updated_at, completed_at, players!inner(telegram_id, username, first_name, referral_code)")
        .eq("event_id", eventId)
        .order("registered_at", { ascending: false })
        .limit(500);
      if (error) {
        console.error("Event participant lookup failed:", error);
        return json({ error: "Failed to load event participants" }, 500);
      }
      return json({ participants: data ?? [], participantLimit: 500 });
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

      const { error } = await db
        .from("vault_reserves")
        .update({
          ton_reserve: ton,
          zp_reserve: zp,
          updated_at: new Date().toISOString(),
        })
        .eq("id", "global");

      if (error) {
        return json(
          { error: "Failed to update vault reserves" },
          500
        );
      }

      return json({ success: true });
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
