import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function text(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return text(405, "Method not allowed");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return text(503, "Callback service unavailable");

  const url = new URL(req.url);
  const prefix = "/functions/v1/onclicka-postback/";
  if (!url.pathname.startsWith(prefix)) return text(404, "Not found");

  const suppliedToken = url.pathname.slice(prefix.length).replace(/\/$/, "");
  if (!/^[a-f0-9]{64}$/i.test(suppliedToken)) return text(403, "Forbidden");

  const telegramUserId = url.searchParams.get("USERID") ?? "";
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
    console.error("OnClicka callback credential lookup failed:", credentialError);
    return text(503, "Callback verification unavailable");
  }
  if (isValidToken !== true || !constantTimeEqual(suppliedHash, await sha256(suppliedToken))) {
    return text(403, "Forbidden");
  }

  const { data, error } = await admin.rpc("record_onclicka_fragment_view", {
    p_telegram_id: telegramUserId,
  });

  if (error) {
    console.error("OnClicka view callback could not be recorded:", error);
    return text(500, "Could not record view");
  }

  if (data?.reason === "no_eligible_session" || data?.reason === "player_not_found") {
    return text(200, "No eligible pending session");
  }
  return text(200, data?.completed ? "Fragment unlocked" : "View confirmation recorded");
});
