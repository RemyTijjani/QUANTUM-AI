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
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Method not allowed. Use GET or POST." }, 405);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    console.error("Event participation service configuration is incomplete");
    return json({ error: "Event participation service is not configured" }, 500);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const tokenMatch = authorization.match(/^Bearer\\s+(.+)$/i);
  if (!tokenMatch) return json({ error: "Sign in to register for an event." }, 401);

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
      .from("players").select("id").eq("id", authData.user.id).maybeSingle();
    if (playerError || !player) return json({ error: "Player profile was not found." }, 403);

    if (req.method === "GET") {
      const { data: registrations, error: registrationsError } = await admin
        .from("game_event_participations")
        .select("id, event_id, status, registered_at, updated_at, completed_at, game_events(id, title, category, starts_at, ends_at, timezone)")
        .eq("player_id", player.id)
        .order("registered_at", { ascending: false })
        .limit(100);
      if (registrationsError) {
        console.error("Event history lookup failed:", registrationsError);
        return json({ error: "Could not load your event history." }, 500);
      }
      return json({ registrations: registrations ?? [] });
    }

    let body: { eventId?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "A valid JSON request body is required." }, 400);
    }
    if (!body || typeof body.eventId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.eventId)) {
      return json({ error: "A valid event ID is required." }, 400);
    }

    const { data: event, error: eventError } = await admin
      .from("game_events")
      .select("id, status, starts_at, ends_at")
      .eq("id", body.eventId)
      .maybeSingle();
    if (eventError) return json({ error: "Could not verify this event." }, 500);
    if (!event || event.status !== "published" || !event.starts_at || !event.ends_at) {
      return json({ error: "This event is not open for registration." }, 409);
    }
    if (new Date(event.ends_at).getTime() <= Date.now()) {
      return json({ error: "Registration for this event has closed." }, 409);
    }

    const { data: existing, error: existingError } = await admin
      .from("game_event_participations")
      .select("id, status, registered_at")
      .eq("event_id", event.id)
      .eq("player_id", player.id)
      .maybeSingle();
    if (existingError) return json({ error: "Could not check your existing registration." }, 500);
    if (existing) return json({ success: true, alreadyRegistered: true, participation: existing });

    const { data: participation, error: insertError } = await admin
      .from("game_event_participations")
      .insert({ event_id: event.id, player_id: player.id })
      .select("id, status, registered_at")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return json({ success: true, alreadyRegistered: true });
      }
      console.error("Event registration insert failed:", insertError);
      return json({ error: "Could not register for this event. Please try again." }, 500);
    }

    return json({ success: true, alreadyRegistered: false, participation });
  } catch (error) {
    console.error("Event registration failed:", error);
    return json({ error: "Event registration could not be completed." }, 500);
  }
});
