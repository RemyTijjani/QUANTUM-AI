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

  const params = new URL(req.url).searchParams;
  const telegramUserId = params.get("userid") ?? params.get("userId") ?? params.get("telegramId") ?? "";
  const blockId = params.get("block") ?? "";
  const secret = params.get("secret") ?? "";

  if (!/^\\d{1,20}$/.test(telegramUserId) || BigInt(telegramUserId) <= 0n) {
    return reply(400, "Invalid userid");
  }
  if (blockId !== "61713" || !/^[a-f0-9]{64}$/i.test(secret)) {
    return reply(403, "Invalid callback parameters");
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: validSecret, error: secretError } = await admin.rpc(
    "is_valid_adsgram_callback_secret",
    { p_secret_hash: await sha256(secret) },
  );
  if (secretError) {
    console.error("AdsGram callback credential lookup failed:", secretError);
    return reply(503, "Callback verification unavailable");
  }
  if (validSecret !== true) return reply(403, "Forbidden");

  const { data, error } = await admin.rpc("record_adsgram_fragment_reward", {
    p_telegram_id: telegramUserId,
    p_block_id: blockId,
  });
  if (error) {
    console.error("AdsGram reward callback could not be recorded:", error);
    return reply(503, "Could not record reward");
  }
  if (data?.reason === "no_eligible_session" || data?.reason === "player_not_found") {
    return reply(503, "Waiting for matching Fragment session");
  }
  if (data?.success !== true) return reply(409, "Reward callback was not eligible");
  return reply(200, data.completed
    ? (data.alreadyCompleted ? "Reward already recorded" : "Capacitor Fragment unlocked")
    : "Reward callback recorded; awaiting SDK completion");
});
