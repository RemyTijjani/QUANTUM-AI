import { createClient } from "npm:@supabase/supabase-js@2";

// telegram-auth: verifies Telegram WebApp initData and creates/authenticates player sessions
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BOT_TOKEN = Deno.env.get("BOT_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

async function validateInitData(initData: string): Promise<TelegramUser | null> {
  if (!BOT_TOKEN) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  params.delete("hash");

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const encoder = new TextEncoder();

  const secretKeyData = encoder.encode("WebAppData");
  const secretKey = await crypto.subtle.importKey(
    "raw",
    secretKeyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secretBuf = await crypto.subtle.sign("HMAC", secretKey, encoder.encode(BOT_TOKEN));
  const derivedKey = await crypto.subtle.importKey(
    "raw",
    secretBuf,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const calcBuf = await crypto.subtle.sign("HMAC", derivedKey, encoder.encode(dataCheckString));
  const calcHash = Array.from(new Uint8Array(calcBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (calcHash !== hash) return null;

  const userJson = params.get("user");
  if (!userJson) return null;

  try {
    return JSON.parse(userJson) as TelegramUser;
  } catch {
    return null;
  }
}

function makeReferralCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "ZORD-";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Derives a deterministic password for a Telegram user.
 * The password is HMAC-SHA256(telegram_id, BOT_TOKEN) hex-encoded.
 * This is never shown to the user; it's only used for server-side user creation
 * and the client uses it to sign in via signInWithPassword.
 */
async function derivePassword(telegramId: number): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(BOT_TOKEN);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(String(telegramId)));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function emailForTelegram(telegramId: number): string {
  return `tg${telegramId}@zord.local`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { initData } = await req.json();
    if (typeof initData !== "string" || initData.length === 0) {
      return new Response(JSON.stringify({ error: "initData is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tgUser = await validateInitData(initData);
    if (!tgUser) {
      return new Response(JSON.stringify({ error: "Invalid Telegram signature" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const telegramId = tgUser.id;
    const username = tgUser.username ?? null;
    const firstName = tgUser.first_name ?? null;
    const email = emailForTelegram(telegramId);
    const password = await derivePassword(telegramId);

    const { data: existing } = await admin
      .from("players")
      .select("id, referral_code")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    let referralCode: string;

    if (existing) {
      referralCode = existing.referral_code;

      if (username || firstName) {
        await admin
          .from("players")
          .update({
            username: username ?? undefined,
            first_name: firstName ?? undefined,
          })
          .eq("id", existing.id);
      }
    } else {
      const { data: authUser, error: authError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { telegram_id: telegramId },
      });
      if (authError || !authUser.user) {
        return new Response(JSON.stringify({ error: "Failed to create auth user" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let code = makeReferralCode();
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: conflict } = await admin
          .from("players")
          .select("id")
          .eq("referral_code", code)
          .maybeSingle();
        if (!conflict) break;
        code = makeReferralCode();
      }
      referralCode = code;

      const { error: playerError } = await admin.from("players").insert({
        id: authUser.user.id,
        telegram_id: telegramId,
        username,
        first_name: firstName,
        referral_code: referralCode,
      });
      if (playerError) {
        return new Response(JSON.stringify({ error: "Failed to create player record" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(
      JSON.stringify({
        email,
        password,
        telegramId,
        username,
        firstName,
        referralCode,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("telegram-auth failed:", err);
    return new Response(
      JSON.stringify({ error: "Authentication failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
