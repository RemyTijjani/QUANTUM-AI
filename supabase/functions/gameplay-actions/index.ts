import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FRAGMENTS = ["top", "bottom", "left", "right"] as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    console.error("Trusted gameplay service configuration is incomplete.");
    return json({ error: "Trusted gameplay service is not configured." }, 500);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return json({ error: "Sign in to perform this gameplay action." }, 401);

  try {
    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(tokenMatch[1]);
    if (authError || !authData.user) return json({ error: "Your session is invalid or expired. Reopen the Mini App." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: player, error: playerError } = await admin
      .from("players")
      .select("id")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (playerError || !player) return json({ error: "Player profile was not found." }, 403);

    if (req.method === "GET") {
      const { data, error } = await admin
        .from("player_fragment_gameplay_state")
        .select("fragment_id, status, cooldown_until, core_mining_until, updated_at")
        .eq("player_id", player.id);
      if (error) {
        console.error("Trusted fragment state lookup failed:", error);
        return json({ error: "Could not load trusted fragment state." }, 500);
      }
      return json({ fragments: data ?? [], serverAuthoritative: true });
    }

    const rawBody = await req.text();
    if (rawBody.length > 4096) return json({ error: "Gameplay request is too large." }, 413);
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "Invalid gameplay request." }, 400);
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid gameplay request." }, 400);
    }

    if (body.action === "get_daily_streak_state") {
      const { data, error } = await admin.rpc("get_daily_streak_state", {
        p_player_id: player.id,
      });
      if (error) {
        console.error("Daily Streak state lookup failed:", error);
        return json({ error: "Could not load Daily Streak status right now." }, 500);
      }
      return json({ success: true, streak: data });
    }

    if (body.action === "claim_daily_streak") {
      // UTC date, streak day, reward draw and all grants are decided atomically
      // by the database. No client-supplied player, date, reward or amount.
      const { data, error } = await admin.rpc("claim_daily_streak", {
        p_player_id: player.id,
      });
      if (error) {
        console.error("Daily Streak claim failed:", error);
        return json({ error: "Could not claim your Daily Streak reward right now." }, 409);
      }
      return json(data, data?.success === false ? 409 : 200);
    }

    if (body.action === "claim_daily_uplink") {
      // The database derives the UTC claim date and reads the reward from the
      // published mission row. No client-supplied amount or date is accepted.
      const { data, error } = await admin.rpc("claim_daily_uplink", {
        p_player_id: player.id,
      });
      if (error) {
        console.error("Daily Uplink claim failed:", error);
        return json({ error: "Could not claim Daily Uplink right now." }, 409);
      }
      return json(data, data?.success === false ? 409 : 200);
    }

    if (body.action === "begin_fragment_unlock") {
      if (typeof body.fragmentId !== "string" || !FRAGMENTS.includes(body.fragmentId as typeof FRAGMENTS[number])) {
        return json({ error: "Choose a valid fragment." }, 400);
      }
      const { data, error } = await admin.rpc("begin_fragment_unlock", {
        p_player_id: player.id,
        p_fragment_id: body.fragmentId,
      });
      if (error) {
        console.error("Begin fragment unlock failed:", error);
        return json({ error: "Could not start the fragment unlock." }, 500);
      }
      return json(data);
    }

    if (body.action === "complete_fragment_unlock") {
      if (typeof body.sessionId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.sessionId)) {
        return json({ error: "A valid unlock session is required." }, 400);
      }
      const { data, error } = await admin.rpc("complete_fragment_unlock", {
        p_player_id: player.id,
        p_session_id: body.sessionId,
      });
      if (error) {
        console.error("Complete fragment unlock failed:", error);
        return json({ error: "Could not complete the fragment unlock." }, 500);
      }
      const status = data?.reason === "wait_required" ? 409 : data?.success === false ? 409 : 200;
      return json(data, status);
    }

    if (body.action === "fix_fragment") {
      if (typeof body.fragmentId !== "string" || !FRAGMENTS.includes(body.fragmentId as typeof FRAGMENTS[number]) ||
          typeof body.requestId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) {
        return json({ error: "A valid fragment and request ID are required." }, 400);
      }
      const { data, error } = await admin.rpc("fix_fragment_trusted", {
        p_player_id: player.id,
        p_fragment_id: body.fragmentId,
        p_request_id: body.requestId,
      });
      if (error) {
        console.error("Trusted fragment action failed:", error);
        return json({ error: "Could not verify the fragment action." }, 500);
      }
      return json(data, data?.success === false ? 409 : 200);
    }

    return json({ error: "Unknown gameplay action." }, 400);
  } catch (error) {
    console.error("Trusted gameplay request failed:", error);
    return json({ error: "Gameplay action could not be completed." }, 500);
  }
});
