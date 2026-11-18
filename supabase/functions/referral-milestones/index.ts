import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) return json({ error: "Referral milestone service is not configured." }, 500);

  const authorization = req.headers.get("Authorization") ?? "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return json({ error: "Sign in to access referral milestones." }, 401);

  try {
    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(tokenMatch[1]);
    if (authError || !authData.user) return json({ error: "Your session is invalid or expired." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: player, error: playerError } = await admin
      .from("players").select("id").eq("id", authData.user.id).maybeSingle();
    if (playerError || !player) return json({ error: "Player profile was not found." }, 403);

    if (req.method === "GET") {
      const { data, error } = await admin.rpc("get_player_referral_milestones", {
        p_player_id: player.id,
      });
      if (error || !data) {
        console.error("Referral milestone lookup failed:", error);
        return json({ error: "Could not load referral milestones." }, 500);
      }
      return json({ success: true, ...data });
    }

    const raw = await req.text();
    if (raw.length > 1024) return json({ error: "Claim request is too large." }, 413);
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "Invalid claim request." }, 400);
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid claim request." }, 400);
    }

    if (body.action !== "claim_milestone" ||
        typeof body.threshold !== "number" ||
        !Number.isSafeInteger(body.threshold) ||
        ![3, 10, 25].includes(body.threshold)) {
      return json({ error: "Select a valid referral milestone." }, 400);
    }

    const { data, error } = await admin.rpc("claim_player_referral_milestone", {
      p_player_id: player.id,
      p_referral_threshold: body.threshold,
    });
    if (error || !data) {
      const message = error?.message ?? "Could not claim referral milestone.";
      const status = /not been reached/i.test(message) ? 409 : /unknown referral milestone/i.test(message) ? 400 : 500;
      return json({ error: status === 500 ? "Could not claim referral milestone." : message }, status);
    }
    return json(data);
  } catch (error) {
    console.error("Referral milestone request failed:", error);
    return json({ error: "Could not process referral milestone request." }, 500);
  }
});
