
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BOT_TOKEN = Deno.env.get("BOT_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

async function validateInitData(
  initData: string,
): Promise<TelegramUser | null> {
  if (!BOT_TOKEN) {
    console.error("BOT_TOKEN is missing");
    return null;
  }

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");

    if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
      console.error("Telegram hash is missing or invalid");
      return null;
    }

    params.delete("hash");
    params.delete("signature");

    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const encoder = new TextEncoder();

    // Telegram WebApp HMAC key derivation.
    const secretKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(BOT_TOKEN),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const secret = await crypto.subtle.sign(
      "HMAC",
      secretKey,
      encoder.encode("WebAppData"),
    );

    const derivedKey = await crypto.subtle.importKey(
      "raw",
      secret,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const calculatedHash = await crypto.subtle.sign(
      "HMAC",
      derivedKey,
      encoder.encode(dataCheckString),
    );

    const calculatedHex = Array.from(
      new Uint8Array(calculatedHash),
    )
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    if (calculatedHex !== hash.toLowerCase()) {
      console.error("Telegram signature verification failed");
      return null;
    }

    const authDate = Number(params.get("auth_date"));
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (
      !Number.isFinite(authDate) ||
      authDate <= 0 ||
      nowSeconds - authDate > 86400 ||
      authDate > nowSeconds + 60
    ) {
      console.error("Telegram authentication data expired");
      return null;
    }

    const userJson = params.get("user");

    if (!userJson) {
      console.error("Telegram user data missing");
      return null;
    }

    const user = JSON.parse(userJson) as TelegramUser;

    if (!Number.isSafeInteger(user.id) || user.id <= 0) {
      console.error("Invalid Telegram user ID");
      return null;
    }

    return user;
  } catch (error) {
    console.error("Telegram validation failed:", error);
    return null;
  }
}

function makeReferralCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const random = new Uint8Array(6);
  crypto.getRandomValues(random);

  return (
    "ZORD-" +
    Array.from(random)
      .map((byte) => chars[byte % chars.length])
      .join("")
  );
}

async function derivePassword(
  telegramId: number,
): Promise<string> {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(BOT_TOKEN),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(String(telegramId)),
  );

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function emailForTelegram(telegramId: number): string {
  return `tg${telegramId}@zord.local`;
}

Deno.serve(async (req: Request) => {
  // Handle browser and frontend CORS preflight requests.
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Only POST requests are allowed for authentication.
  if (req.method !== "POST") {
    return jsonResponse(
      { error: "Method not allowed. Use POST." },
      405,
    );
  }

  // Verify required Supabase and Telegram configuration.
  if (!BOT_TOKEN || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("Required environment variables are missing");

    return jsonResponse(
      { error: "Server configuration error" },
      500,
    );
  }

  try {
    // Safely read JSON instead of allowing an empty body to crash.
    let body: Record<string, unknown>;

    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        { error: "Invalid or empty JSON request body" },
        400,
      );
    }

    const initData = body?.initData;
    const clientReferrerCode = body?.referrerCode;

    if (
      typeof initData !== "string" ||
      initData.length === 0
    ) {
      return jsonResponse(
        { error: "initData is required" },
        400,
      );
    }

    // Verify Telegram authentication data.
    const tgUser = await validateInitData(initData);

    if (!tgUser) {
      return jsonResponse(
        { error: "Invalid or expired Telegram authentication" },
        401,
      );
    }

    // Create Supabase admin client.
    const admin = createClient(
      SUPABASE_URL,
      SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    const telegramId = tgUser.id;
    const username = tgUser.username ?? null;
    const firstName = tgUser.first_name ?? null;

    const email = emailForTelegram(telegramId);
    const password = await derivePassword(telegramId);

    // Find an existing player.
    const {
      data: existing,
      error: lookupError,
    } = await admin
      .from("players")
      .select("id, referral_code")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (lookupError) {
      console.error("Player lookup failed:", lookupError);

      return jsonResponse(
        { error: "Could not retrieve player" },
        500,
      );
    }

    let referralCode: string;
    let isNewUser = false;

    if (existing) {
      referralCode = existing.referral_code;

      const { error: updateError } = await admin
        .from("players")
        .update({
          username,
          first_name: firstName,
        })
        .eq("id", existing.id);

      if (updateError) {
        console.error("Player update failed:", updateError);
      }
    } else {
      isNewUser = true;

      // Create the Supabase Auth user.
      const {
        data: authResult,
        error: authError,
      } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          telegram_id: telegramId,
        },
      });

      let authUserId: string;

      if (authError || !authResult.user) {
        // Recover an Auth user if an earlier registration
        // was interrupted before player creation.
        const {
          data: existingAuth,
          error: authLookupError,
        } = await admin.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });

        if (authLookupError) {
          console.error("Auth lookup failed:", authLookupError);

          return jsonResponse(
            { error: "Could not create or retrieve auth user" },
            500,
          );
        }

        const recoveredUser = existingAuth.users.find(
          (user) => user.email === email,
        );

        if (!recoveredUser) {
          console.error("Auth user creation failed:", authError);

          return jsonResponse(
            { error: "Failed to create auth user" },
            500,
          );
        }

        authUserId = recoveredUser.id;
      } else {
        authUserId = authResult.user.id;
      }

      // Generate a unique referral code.
      let code = "";
      let uniqueCodeFound = false;

      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = makeReferralCode();

        const {
          data: conflict,
          error: conflictError,
        } = await admin
          .from("players")
          .select("id")
          .eq("referral_code", candidate)
          .maybeSingle();

        if (conflictError) {
          console.error(
            "Referral code lookup failed:",
            conflictError,
          );

          return jsonResponse(
            { error: "Could not generate referral code" },
            500,
          );
        }

        if (!conflict) {
          code = candidate;
          uniqueCodeFound = true;
          break;
        }
      }

      if (!uniqueCodeFound) {
        return jsonResponse(
          { error: "Could not generate unique referral code" },
          500,
        );
      }

      referralCode = code;

      // Create the player record.
      const { error: playerError } = await admin
        .from("players")
        .insert({
          id: authUserId,
          telegram_id: telegramId,
          username,
          first_name: firstName,
          referral_code: referralCode,
        });

      if (playerError) {
        console.error("Player creation failed:", playerError);

        return jsonResponse(
          { error: "Failed to create player record" },
          500,
        );
      }
    }

    // Register referral for a newly registered player.
    if (
      isNewUser &&
      typeof clientReferrerCode === "string" &&
      clientReferrerCode.trim()
    ) {
      const normalizedCode = clientReferrerCode
        .trim()
        .replace(/^ref_/i, "")
        .toUpperCase();

      const {
        data: referrerPlayer,
        error: referrerError,
      } = await admin
        .from("players")
        .select("telegram_id")
        .eq("referral_code", normalizedCode)
        .maybeSingle();

      if (referrerError) {
        console.error("Referrer lookup failed:", referrerError);
      } else if (
        referrerPlayer &&
        Number(referrerPlayer.telegram_id) !== telegramId
      ) {
        const { error: referralError } = await admin.rpc(
          "register_referral",
          {
            p_referrer_tg_id: referrerPlayer.telegram_id,
            p_referred_tg_id: telegramId,
          },
        );

        if (referralError) {
          console.error(
            "Referral registration failed:",
            referralError,
          );
        } else {
          console.log("Referral successfully registered:", {
            referrer: referrerPlayer.telegram_id,
            recruit: telegramId,
          });
        }
      } else {
        console.log(
          "Referral skipped: invalid code or self-referral",
        );
      }
    }

    // Return credentials to the frontend.
    return jsonResponse({
      email,
      password,
      telegramId,
      username,
      firstName,
      referralCode,
    });
  } catch (error) {
    console.error("telegram-auth failed:", error);

    return jsonResponse(
      { error: "Authentication failed" },
      500,
    );
  }
});
