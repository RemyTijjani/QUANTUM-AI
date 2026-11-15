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

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY || !BOT_TOKEN) {
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

    const missionId = typeof body.missionId === "string" ? body.missionId.trim() : "";
    if (!missionId || missionId.length > 120) return json({ error: "Choose a valid mission." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: player, error: playerError } = await admin
      .from("players")
      .select("id, telegram_id")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (playerError || !player || !Number.isSafeInteger(Number(player.telegram_id))) {
      return json({ error: "Your verified Telegram player profile could not be found." }, 403);
    }

    const { data: mission, error: missionError } = await admin
      .from("mission_tasks")
      .select("id, kind, title, reward, reward_currency, unlock_cost_zp, status, telegram_chat_id")
      .eq("id", missionId)
      .maybeSingle();

    if (missionError || !mission) return json({ error: "Mission not found." }, 404);
    if (
      mission.kind !== "social" ||
      mission.status !== "published" ||
      mission.reward_currency !== "ZP" ||
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
