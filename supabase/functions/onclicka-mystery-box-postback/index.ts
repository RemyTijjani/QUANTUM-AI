import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function text(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return text(405, "Method not allowed");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return text(503, "Callback service unavailable");

  const url = new URL(req.url);
  const prefix = "/functions/v1/onclicka-mystery-box-postback/";
  if (!url.pathname.startsWith(prefix)) return text(404, "Not found");

  const suppliedToken = url.pathname.slice(prefix.length).replace(/\/$/, "");
  if (!/^[a-f0-9]{64}$/i.test(suppliedToken)) return text(403, "Forbidden");

  const telegramUserId = url.searchParams.get("USERID") ?? url.searchParams.get("userId") ?? "";
  if (!/^\d{1,20}$/.test(telegramUserId) || BigInt(telegramUserId) <= 0n) {
    return text(400, "Invalid USERID");
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const suppliedHash = await sha256(suppliedToken);
  const { data: isValidToken, error: credentialError } = await admin.rpc(
    "is_valid_onclicka_callback_secret",
    { p_secret_hash: suppliedHash },
  );

  if (credentialError) {
    console.error("OnClicka Mystery Box callback credential lookup failed:", credentialError);
    return text(503, "Callback verification unavailable");
  }
  if (isValidToken !== true) return text(403, "Forbidden");

  const { data, error } = await admin.rpc("record_onclicka_mystery_box_view", {
    p_telegram_id: telegramUserId,
  });
  if (error) {
    console.error("OnClicka Mystery Box callback could not be recorded:", error);
    return text(500, "Could not record rewarded view");
  }
  if (data?.reason === "no_eligible_session" || data?.reason === "player_not_found") {
    return text(200, "No eligible pending Mystery Box session");
  }
  return text(200, data?.completed ? "Mystery Box reward recorded" : "View confirmation recorded");
});
