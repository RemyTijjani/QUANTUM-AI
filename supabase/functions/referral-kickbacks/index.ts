import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    console.error("Referral kickback service configuration is incomplete.");
    return json({ error: "Referral rewards service is not configured." }, 500);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const tokenMatch = authorization.match(/^Bearer\\s+(.+)$/i);
  if (!tokenMatch) return json({ error: "Sign in to claim referral rewards." }, 401);

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
    if (rawBody.length > 2048) return json({ error: "Referral claim request is too large." }, 413);

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json({ error: "Invalid referral claim request." }, 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid referral claim request." }, 400);
    }

    if (body.action !== "claim_referral_kickbacks") {
      return json({ error: "Unknown referral rewards action." }, 400);
    }
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    if (!UUID_PATTERN.test(idempotencyKey)) {
      return json({ error: "A valid claim request ID is required." }, 400);
    }

    const { data, error } = await admin.rpc("claim_player_referral_kickbacks", {
      p_player_id: player.id,
      p_idempotency_key: idempotencyKey,
    });
    if (error) {
      console.error("Referral kickback claim failed:", error);
      return json({ error: "Could not claim referral kickbacks." }, 409);
    }
    return json(data);
  } catch (error) {
    console.error("Referral kickback request failed:", error);
    return json({ error: "Could not claim referral kickbacks." }, 500);
  }
});
