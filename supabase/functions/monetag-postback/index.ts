import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const POSTBACK_SECRET = Deno.env.get("MONETAG_POSTBACK_SECRET") ?? "";
const MONETAG_ZONE_ID = "12235928";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return response(405, "Method not allowed");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !POSTBACK_SECRET) {
    console.error("Monetag postback endpoint is missing server configuration.");
    return response(503, "Postback endpoint not configured");
  }

  const params = new URL(req.url).searchParams;
  const suppliedSecret = params.get("secret") ?? "";
  if (!constantTimeEqual(suppliedSecret, POSTBACK_SECRET)) {
    return response(403, "Forbidden");
  }

  const ymid = params.get("ymid") ?? "";
  const zoneId = params.get("zone_id") ?? "";
  const eventType = params.get("event_type") ?? "";
  const rewardEventType = params.get("reward_event_type") ?? "";
  const requestVar = params.get("request_var") ?? "";

  // Clicks, non-valued impressions, other zones and other placements never
  // unlock a Fragment. Monetag's Rewarded Interstitial impression postback
  // must be valued and matched to this one-time player ad session.
  if (
    zoneId !== MONETAG_ZONE_ID ||
    eventType !== "impression" ||
    rewardEventType !== "valued" ||
    requestVar !== "fragment_right" ||
    !UUID_PATTERN.test(ymid)
  ) {
    return response(200, "Event ignored");
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: session, error: updateError } = await admin
    .from("fragment_unlock_sessions")
    .update({ monetag_valued_at: new Date().toISOString() })
    .eq("monetag_ymid", ymid)
    .eq("ad_provider", "monetag")
    .eq("fragment_id", "right")
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .is("monetag_valued_at", null)
    .select("id")
    .maybeSingle();

  if (updateError) {
    console.error("Monetag valued postback could not be recorded:", updateError);
    return response(500, "Could not record event");
  }

  if (!session?.id) {
    // Monetag retries are safe. A duplicate, expired, already-used or unknown
    // ymid must never create a second reward.
    return response(200, "No eligible session");
  }

  const { data: completion, error: completionError } = await admin.rpc(
    "try_complete_monetag_fragment_unlock",
    { p_session_id: session.id },
  );

  if (completionError) {
    console.error("Monetag Fragment completion failed:", completionError);
    return response(500, "Could not complete verified session");
  }

  return response(200, completion?.completed ? "Fragment unlocked" : "Verification recorded");
});
