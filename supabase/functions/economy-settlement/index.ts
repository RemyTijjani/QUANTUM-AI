import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    console.error("Economy settlement service configuration is incomplete.");
    return json({ error: "Economy settlement service is not configured." }, 500);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const tokenMatch = authorization.match(/^Bearer\\s+(.+)$/i);
  if (!tokenMatch) return json({ error: "Sign in to refresh your verified economy." }, 401);

  try {
    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(tokenMatch[1]);
    if (authError || !authData.user) {
      return json({ error: "Your session is invalid or expired. Reopen the Mini App." }, 401);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: player, error: playerError } = await admin
      .from("players")
      .select("id")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (playerError || !player) return json({ error: "Player profile was not found." }, 403);

    const rawBody = await req.text();
    if (rawBody.length > 1024) return json({ error: "Settlement request is too large." }, 413);
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json({ error: "Invalid settlement request." }, 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid settlement request." }, 400);
    }
    if (body.action !== "settle") return json({ error: "Unknown economy settlement action." }, 400);

    // All accrual and release work is performed by idempotent, server-owned
    // database routines using the player resolved from the verified session.
    const { data: agentRentalAccrual, error: agentRentalError } = await admin.rpc(
      "accrue_agent_rental_zp",
      { p_player_id: player.id },
    );
    if (agentRentalError || !agentRentalAccrual?.success) {
      console.error("Agent rental ZP settlement failed:", agentRentalError);
      return json({ error: "Could not settle verified agent mining." }, 500);
    }

    const { error: fragmentAccrualError } = await admin.rpc("accrue_fragment_mining_pending_zp", {
      p_player_id: player.id,
    });
    if (fragmentAccrualError) {
      console.error("Fragment mining accrual settlement failed:", fragmentAccrualError);
      return json({ error: "Could not settle Fragment mining." }, 500);
    }

    const { error: fragmentReleaseError } = await admin.rpc("release_fragment_mining_accruals", {
      p_player_id: player.id,
    });
    if (fragmentReleaseError) {
      console.error("Matured Fragment accrual release failed:", fragmentReleaseError);
      return json({ error: "Could not release matured Fragment rewards." }, 500);
    }

    const { error: legacyFragmentReleaseError } = await admin.rpc("release_matured_fragment_zp", {
      p_player_id: player.id,
    });
    if (legacyFragmentReleaseError) {
      console.error("Legacy Fragment reward release failed:", legacyFragmentReleaseError);
      return json({ error: "Could not release matured legacy Fragment rewards." }, 500);
    }

    return json({ success: true });
  } catch (error) {
    console.error("Economy settlement request failed:", error);
    return json({ error: "Could not refresh your verified economy." }, 500);
  }
});
