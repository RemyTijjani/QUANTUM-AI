import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BOT_TOKEN = Deno.env.get("BOT_TOKEN") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function telegramMemberStatus(chatId: string, userId: number): Promise<{ member: boolean; botAdminIssue: boolean }> {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, user_id: userId }),
    signal: AbortSignal.timeout(8000),
  });

  let result: { ok?: boolean; result?: { status?: string; is_member?: boolean }; description?: string };
  try {
    result = await response.json();
  } catch {
    throw new Error("Telegram returned an unreadable membership response.");
  }

  if (!response.ok || result.ok !== true || !result.result) {
    console.error("Telegram membership verification API rejected request:", result.description ?? response.status);
    return { member: false, botAdminIssue: true };
  }

  const status = result.result.status;
  const member =
    status === "creator" ||
    status === "administrator" ||
    status === "member" ||
    (status === "restricted" && result.result.is_member === true);

  return { member, botAdminIssue: false };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    console.error("Mission verification configuration is incomplete.");
    return json({ error: "Mission verification is temporarily unavailable." }, 503);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return json({ error: "Sign in before claiming a mission." }, 401);

  try {
    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(tokenMatch[1]);
    if (authError || !authData.user) return json({ error: "Your session is invalid. Reopen the Mini App." }, 401);

    const rawBody = await req.text();
    if (rawBody.length > 2048) return json({ error: "Request is too large." }, 413);

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "Invalid request." }, 400);
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid request." }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: player, error: playerError } = await admin
      .from("players")
      .select("id, telegram_id")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (playerError || !player) {
      return json({ error: "Your verified player profile could not be found." }, 403);
    }

    if (body.action === "submit_creator_ops_submission") {
      const missionId = typeof body.missionId === "string" ? body.missionId.trim() : "";
      const linkUrl = typeof body.linkUrl === "string" ? body.linkUrl.trim() : "";
      if (!missionId || missionId.length > 120 || !linkUrl || linkUrl.length > 2048) {
        return json({ error: "A valid Creator Ops mission and submission link are required." }, 400);
      }
      const { data, error } = await admin.rpc("submit_creator_ops_submission", {
        p_player_id: player.id,
        p_mission_id: missionId,
        p_link_url: linkUrl,
      });
      if (error) {
        console.error("Creator Ops submission failed:", error);
        return json({ error: "This Creator Ops submission could not be accepted. Check the link and submission status, then try again." }, 409);
      }
      const submission = Array.isArray(data) ? data[0] : data;
      if (!submission) return json({ error: "The submission was not recorded." }, 409);
      return json({ success: true, submission });
    }

    if (body.action === "submit_x_follow_submission") {
      const xAccount = typeof body.xAccount === "string" ? body.xAccount.trim() : "";
      if (!xAccount || xAccount.length > 200) {
        return json({ error: "Enter a valid X username or profile link." }, 400);
      }
      const { data, error } = await admin.rpc("submit_x_follow_submission", {
        p_player_id: player.id,
        p_x_account: xAccount,
      });
      if (error) {
        console.error("X Follow submission failed:", error);
        return json({ error: "Your X account could not be submitted. Check the username and existing submission status." }, 409);
      }
      return json(data);
    }

    if (body.action === "get_task_statuses") {
      const utcDate = new Date().toISOString().slice(0, 10);
      const nowIso = new Date().toISOString();
      const twelveHoursAgoIso = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

      const [
        missionResult,
        dailyClaimResult,
        agentClaimResult,
        telegramClaimResult,
        creatorSubmissionResult,
        xFollowSubmissionResult,
        activeRentalResult,
        shareUplinkClaimResult,
        verifiedReferralResult,
      ] = await Promise.all([
        admin.from("mission_tasks")
          .select("id, kind, telegram_chat_id")
          .eq("status", "published")
          .in("kind", ["daily", "social", "creator"])
          .in("reward_currency", ["ZP", "ZAP"])
          .eq("unlock_cost_zp", 0)
          .gt("reward", 0)
          .neq("id", "ad-quota")
          .order("created_at", { ascending: true }),
        admin.from("daily_uplink_claims")
          .select("claim_date")
          .eq("player_id", player.id)
          .eq("claim_date", utcDate)
          .maybeSingle(),
        admin.from("agent_uptime_mission_claims")
          .select("claim_date")
          .eq("player_id", player.id)
          .eq("claim_date", utcDate)
          .maybeSingle(),
        admin.from("telegram_mission_claims")
          .select("mission_id")
          .eq("player_id", player.id),
        admin.from("creator_ops_submissions")
          .select("mission_id, status")
          .eq("player_id", player.id),
        admin.from("x_follow_submissions")
          .select("status")
          .eq("player_id", player.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        admin.from("player_agent_rentals")
          .select("id")
          .eq("player_id", player.id)
          .eq("status", "active")
          .lte("starts_at", twelveHoursAgoIso)
          .gt("expires_at", nowIso)
          .limit(1),
        admin.from("share_uplink_mission_claims")
          .select("player_id")
          .eq("player_id", player.id)
          .maybeSingle(),
        admin.from("referral_sub_nodes")
          .select("id")
          .eq("referrer_id", player.id)
          .not("recruit_id", "is", null)
          .limit(1),
      ]);

      const queryError = missionResult.error || dailyClaimResult.error ||
        agentClaimResult.error || telegramClaimResult.error ||
        creatorSubmissionResult.error || xFollowSubmissionResult.error || activeRentalResult.error ||
        shareUplinkClaimResult.error || verifiedReferralResult.error;
      if (queryError) {
        console.error("Task status summary lookup failed:", queryError);
        return json({ error: "Task progress could not be loaded right now." }, 500);
      }

      const telegramClaims = new Set((telegramClaimResult.data ?? []).map((row) => row.mission_id));
      const creatorStatuses = new Map<string, string>();
      for (const row of creatorSubmissionResult.data ?? []) {
        const previous = creatorStatuses.get(row.mission_id);
        if (row.status === "approved" || (row.status === "pending" && previous !== "approved")) {
          creatorStatuses.set(row.mission_id, row.status);
        } else if (!previous) {
          creatorStatuses.set(row.mission_id, row.status);
        }
      }

      const statuses: Record<string, "claimed" | "ready" | "locked" | "pending"> = {};
      for (const mission of missionResult.data ?? []) {
        if (mission.kind === "daily" && mission.id === "daily-uplink") {
          statuses[mission.id] = dailyClaimResult.data ? "claimed" : "ready";
        } else if (mission.kind === "daily" && mission.id === "agent-uptime") {
          statuses[mission.id] = agentClaimResult.data
            ? "claimed"
            : (activeRentalResult.data?.length ?? 0) > 0 ? "ready" : "locked";
        } else if (mission.id === "share-uplink" && mission.kind === "social") {
          statuses[mission.id] = shareUplinkClaimResult.data
            ? "claimed"
            : (verifiedReferralResult.data?.length ?? 0) > 0 ? "ready" : "locked";
        } else if (mission.kind === "social" && typeof mission.telegram_chat_id === "string" && mission.telegram_chat_id.trim()) {
          statuses[mission.id] = telegramClaims.has(mission.id) ? "claimed" : "ready";
        } else if (mission.id === "follow-signal" && mission.kind === "social") {
          const xStatus = xFollowSubmissionResult.data?.status;
          statuses[mission.id] = xStatus === "approved"
            ? "claimed"
            : xStatus === "pending" ? "pending" : "ready";
        } else if (mission.kind === "creator") {
          const creatorStatus = creatorStatuses.get(mission.id);
          statuses[mission.id] = creatorStatus === "approved"
            ? "claimed"
            : creatorStatus === "pending" ? "pending" : "ready";
        } else {
          statuses[mission.id] = "locked";
        }
      }

      const values = Object.values(statuses);
      const claimed = values.filter((status) => status === "claimed").length;
      const ready = values.filter((status) => status === "ready").length;
      return json({
        success: true,
        available: Math.max(0, values.length - claimed),
        ready,
        claimed,
        statuses,
      });
    }

    const missionId = typeof body.missionId === "string" ? body.missionId.trim() : "";
    if (!missionId || missionId.length > 120) return json({ error: "Choose a valid mission." }, 400);

    const { data: mission, error: missionError } = await admin
      .from("mission_tasks")
      .select("id, kind, title, reward, reward_currency, unlock_cost_zp, status, telegram_chat_id")
      .eq("id", missionId)
      .maybeSingle();

    if (missionError || !mission) return json({ error: "Mission not found." }, 404);

    if (missionId === "share-uplink") {
      if (
        mission.kind !== "social" ||
        mission.status !== "published" ||
        mission.reward_currency !== "ZP" ||
        Number(mission.reward) !== 300 ||
        Number(mission.unlock_cost_zp) !== 0
      ) {
        return json({ error: "Share Your Uplink is not configured for its verified referral reward." }, 409);
      }

      const { data, error } = await admin.rpc("claim_share_uplink_mission", {
        p_player_id: player.id,
      });

      if (error) {
        const message = error.message ?? "";
        if (message.includes("Complete one verified referral")) {
          return json({ error: "Invite a new player and wait until their Telegram account is successfully registered before claiming." }, 403);
        }
        console.error("Verified Share Your Uplink claim failed:", error);
        return json({ error: "The referral mission reward could not be credited. Please try again." }, 409);
      }

      return json(data);
    }

    if (missionId === "agent-uptime") {
      if (
        mission.kind !== "daily" ||
        mission.status !== "published" ||
        mission.reward_currency !== "ZAP" ||
        Number(mission.reward) !== 10 ||
        Number(mission.unlock_cost_zp) !== 0
      ) {
        return json({ error: "Agent Uptime is not configured for verified ZAP claims." }, 409);
      }

      const { data, error } = await admin.rpc("claim_agent_uptime_mission", {
        p_player_id: player.id,
      });

      if (error) {
        const message = error.message ?? "";
        if (message.includes("continuously active for 12 hours")) {
          return json({ error: "Your paid agent must remain continuously active for 12 hours before claiming." }, 403);
        }
        console.error("Verified Agent Uptime claim failed:", error);
        return json({ error: "The Agent Uptime reward could not be credited. Please try again." }, 409);
      }

      return json(data);
    }

    if (!BOT_TOKEN || !Number.isSafeInteger(Number(player.telegram_id))) {
      return json({ error: "Telegram mission verification is temporarily unavailable." }, 503);
    }
    if (
      mission.kind !== "social" ||
      mission.status !== "published" ||
      !["ZP", "ZAP"].includes(mission.reward_currency) ||
      Number(mission.unlock_cost_zp) !== 0 ||
      !Number.isSafeInteger(Number(mission.reward)) ||
      Number(mission.reward) <= 0 ||
      typeof mission.telegram_chat_id !== "string" ||
      !mission.telegram_chat_id.trim()
    ) {
      return json({ error: "This mission is not configured for verified Telegram membership claims." }, 409);
    }

    let membership: { member: boolean; botAdminIssue: boolean };
    try {
      membership = await telegramMemberStatus(mission.telegram_chat_id, Number(player.telegram_id));
    } catch (error) {
      console.error("Telegram membership check failed:", error);
      return json({ error: "Telegram could not verify membership. Please try again shortly." }, 503);
    }

    if (membership.botAdminIssue) {
      return json({ error: "Membership could not be checked. Please ask an admin to add the ZORD bot as an administrator in this channel or group." }, 503);
    }
    if (!membership.member) {
      return json({ error: "Join the Telegram channel or group first, then try again. No reward was credited." }, 403);
    }

    const { data, error } = await admin.rpc("claim_verified_telegram_mission", {
      p_player_id: player.id,
      p_mission_id: mission.id,
      p_telegram_user_id: Number(player.telegram_id),
      p_telegram_chat_id: mission.telegram_chat_id,
    });

    if (error) {
      console.error("Verified Telegram mission claim failed:", error);
      return json({ error: "The mission reward could not be credited. Please try again." }, 409);
    }

    return json(data);
  } catch (error) {
    console.error("Mission claim request failed:", error);
    return json({ error: "The mission claim could not be completed." }, 500);
  }
});
