import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Cache-Control": "no-store",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return json({ error: "Method not allowed. Use GET." }, 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("Public events service is missing Supabase configuration.");
    return json({ error: "Events service is not configured." }, 500);
  }

  try {
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const now = new Date().toISOString();
    const { data, error } = await db
      .from("game_events")
      .select("id, title, description, category, starts_at, ends_at, timezone, reward_zp, reward_zap, objectives, requirements")
      .eq("status", "published")
      .not("starts_at", "is", null)
      .not("ends_at", "is", null)
      .gt("ends_at", now)
      .order("starts_at", { ascending: true })
      .limit(100);

    if (error) {
      console.error("Published events query failed:", error.message);
      return json({ error: "Could not load published events." }, 500);
    }

    return json({
      events: data ?? [],
      fetchedAt: now,
    });
  } catch (error) {
    console.error("Public events request failed:", error);
    return json({ error: "Could not load published events." }, 500);
  }
});
