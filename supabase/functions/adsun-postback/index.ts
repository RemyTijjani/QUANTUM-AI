import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function reply(status: number, message: string) {
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
  if (req.method !== "GET") return reply(405, "Method not allowed");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return reply(503, "Callback service unavailable");

  const url = new URL(req.url);
  const telegramUserId = url.searchParams.get("userid") ?? url.searchParams.get("userId") ?? "";
  const blockId = url.searchParams.get("block") ?? "";
  const secret = url.searchParams.get("secret") ?? "";

  if (!/^\\d{1,20}$/.test(telegramUserId) || BigInt(telegramUserId) <= 0n) {
    return reply(400, "Invalid userid");
  }
  if (blockId !== "50344" || !/^[a-f0-9]{64}$/i.test(secret)) {
    return reply(403, "Invalid callback parameters");
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: validSecret, error: secretError } = await admin.rpc(
    "is_valid_adsun_callback_secret",
    { p_secret_hash: await sha256(secret) },
  );
  if (secretError) {
    console.error("Adsun callback credential lookup failed:", secretError);
    return reply(503, "Callback verification unavailable");
  }
  if (validSecret !== true) return reply(403, "Forbidden");

  const { data, error } = await admin.rpc("record_adsun_fragment_reward", {
    p_telegram_id: telegramUserId,
    p_block_id: blockId,
  });
  if (error) {
    console.error("Adsun reward callback could not be recorded:", error);
    return reply(503, "Could not record reward");
  }
  if (data?.reason === "no_eligible_session" || data?.reason === "player_not_found") {
    // Adsun retries 5xx responses; do not acknowledge a callback that arrived
    // before its matching authenticated session can be found.
    return reply(503, "Waiting for matching Fragment session");
  }
  if (data?.success !== true) return reply(409, "Reward callback was not eligible");
  return reply(200, data.alreadyCompleted ? "Reward already recorded" : "Capacitor Fragment unlocked");
});
