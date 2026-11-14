import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    console.error("Mystery Box service configuration is incomplete.");
    return json({ error: "Mystery Box service is not configured." }, 500);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) {
    return json({ error: "Sign in to access Mystery Boxes." }, 401);
  }

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

    if (playerError || !player) {
      return json({ error: "Player profile was not found." }, 403);
    }

    if (req.method === "GET") {
      const { data, error } = await admin.rpc("get_mystery_box_inventory", {
        p_player_id: player.id,
      });
      if (error) {
        console.error("Mystery Box inventory lookup failed:", error);
        return json({ error: "Could not load Mystery Box inventory." }, 500);
      }
      return json({ success: true, inventory: data });
    }

    const rawBody = await req.text();
    if (rawBody.length > 2048) {
      return json({ error: "Mystery Box request is too large." }, 413);
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json({ error: "Invalid Mystery Box request." }, 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid Mystery Box request." }, 400);
    }

    if (body.action !== "open_mystery_box" ||
        typeof body.entitlementId !== "string" ||
        !UUID_PATTERN.test(body.entitlementId)) {
      return json({ error: "A valid Mystery Box entitlement is required." }, 400);
    }

    // Player identity comes only from the verified Supabase session.
    // The client can identify a box entitlement, but cannot choose its tier,
    // pool, odds, reward type, amount, or resulting balance.
    const { data, error } = await admin.rpc("open_mystery_box", {
      p_player_id: player.id,
      p_entitlement_id: body.entitlementId,
    });
    if (error) {
      console.error("Mystery Box opening failed:", error);
      return json({ error: "Could not open this Mystery Box. Check your inventory and try again." }, 409);
    }

    return json(data, data?.success === false ? 409 : 200);
  } catch (error) {
    console.error("Mystery Box request failed:", error);
    return json({ error: "Mystery Box action could not be completed." }, 500);
  }
});
