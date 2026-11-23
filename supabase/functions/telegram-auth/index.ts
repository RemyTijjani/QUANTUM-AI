
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
// Telegram initData is signed and still subject to the 24-hour age limit.
const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface ValidatedTelegramData {
  user: TelegramUser;
  startParam: string | null;
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
): Promise<ValidatedTelegramData | null> {
  if (!BOT_TOKEN) {
    console.error("BOT_TOKEN is missing");
    return null;
  }

  try {
    if (initData.length > 8192) return null;
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");

    if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
      console.error("Telegram hash is missing or invalid");
      return null;
    }

    // Exclude hash from the data-check string.
    // Keep signature because it is not part of HMAC exclusion.
    params.delete("hash");

    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const encoder = new TextEncoder();

    // Telegram HMAC validation:
    // Secret key = HMAC-SHA256(key: WebAppData, message: BOT_TOKEN)
    const secretKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode("WebAppData"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const secret = await crypto.subtle.sign(
      "HMAC",
      secretKey,
      encoder.encode(BOT_TOKEN),
    );

    // Calculate HMAC of the data-check string.
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

    // Validate authentication timestamp.
    const authDate = Number(params.get("auth_date"));
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (
      !Number.isSafeInteger(authDate) ||
      authDate <= 0 ||
      nowSeconds - authDate > MAX_INIT_DATA_AGE_SECONDS ||
      authDate > nowSeconds + 60
    ) {
      console.error("Telegram authentication data expired");
      return null;
    }

    // Read verified Telegram user.
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

    // start_param is read only after successful signature validation.
    // It is part of the signed Telegram initData when provided.
    return {
      user,
      startParam: params.get("start_param"),
    };
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


function emailForTelegram(telegramId: number): string {
  return `tg${telegramId}@zord.local`;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight.
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Authentication only accepts POST.
  if (req.method !== "POST") {
    return jsonResponse(
      { error: "Method not allowed. Use POST." },
      405,
    );
  }

  // Check environment configuration.
  if (!BOT_TOKEN || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("Required environment variables are missing");

    return jsonResponse(
      { error: "Server configuration error" },
      500,
    );
  }

  try {
    // Safely parse the request body.
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

    if (
      typeof initData !== "string" ||
      initData.length === 0
    ) {
      return jsonResponse(
        { error: "initData is required" },
        400,
      );
    }

    // Verify Telegram signature before trusting any launch data.
    const tgData = await validateInitData(initData);

    if (!tgData) {
      return jsonResponse(
        { error: "Invalid or expired Telegram authentication" },
        401,
      );
    }

    const tgUser = tgData.user;

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

    // Find an existing player. The Auth user ID is the player ID.
    const {
      data: existing,
      error: lookupError,
    } = await admin
      .from("players")
      .select("id, referral_code, entity_number")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (lookupError) {
      console.error("Player lookup failed:", lookupError);
      return jsonResponse({ error: "Could not retrieve player" }, 500);
    }

    let referralCode: string;
    let authUserId: string;
    let entityNumber: number | null = null;

    if (existing) {
      authUserId = existing.id;
      entityNumber = typeof existing.entity_number === "number" ? existing.entity_number : null;
      referralCode = typeof existing.referral_code === "string"
        ? existing.referral_code.trim().toUpperCase()
        : "";

      // Repair legacy player rows that predate mandatory referral codes.
      // A successful auth response must always contain a usable referral code.
      if (!/^ZORD-[A-Z0-9]{6}$/.test(referralCode)) {
        let repairedCode = "";
        for (let attempt = 0; attempt < 10; attempt++) {
          const candidate = makeReferralCode();
          const { data: conflict, error: conflictError } = await admin
            .from("players")
            .select("id")
            .eq("referral_code", candidate)
            .maybeSingle();

          if (conflictError) {
            console.error("Referral repair lookup failed:", {
              code: conflictError.code,
            });
            return jsonResponse({ error: "Could not repair player referral information" }, 500);
          }

          if (!conflict) {
            repairedCode = candidate;
            break;
          }
        }

        if (!repairedCode) {
          return jsonResponse({ error: "Could not generate a player referral code" }, 500);
        }

        const { error: referralUpdateError } = await admin
          .from("players")
          .update({ referral_code: repairedCode })
          .eq("id", existing.id);

        if (referralUpdateError) {
          console.error("Referral repair failed:", {
            code: referralUpdateError.code,
          });
          return jsonResponse({ error: "Could not save player referral information" }, 500);
        }

        referralCode = repairedCode;
      }

      const { error: updateError } = await admin
        .from("players")
        .update({ username, first_name: firstName })
        .eq("id", existing.id);

      if (updateError) {
        console.error("Player update failed:", { code: updateError.code });
      }
    } else {
      // Create a random, undisclosed password. Telegram sign-in uses a
      // one-time Supabase magic-link token, never a reusable derived password.
      const randomPassword = crypto.randomUUID() + crypto.randomUUID();
      const {
        data: authResult,
        error: authError,
      } = await admin.auth.admin.createUser({
        email,
        password: randomPassword,
        email_confirm: true,
        user_metadata: { telegram_id: telegramId },
        app_metadata: { telegram_auth_version: 2 },
      });

      if (authError || !authResult.user) {
        // Recover an Auth user if a prior registration stopped before the
        // player record was created. The legacy password is rotated below.
        const {
          data: existingAuth,
          error: authLookupError,
        } = await admin.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });

        if (authLookupError) {
          console.error("Auth lookup failed:", authLookupError);
          return jsonResponse({ error: "Could not create or retrieve auth user" }, 500);
        }

        const recoveredUser = existingAuth.users.find((user) => user.email === email);
        if (!recoveredUser) {
          console.error("Auth user creation failed:", authError);
          return jsonResponse({ error: "Failed to create auth user" }, 500);
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
          console.error("Referral code lookup failed:", conflictError);
          return jsonResponse({ error: "Could not generate referral code" }, 500);
        }

        if (!conflict) {
          code = candidate;
          uniqueCodeFound = true;
          break;
        }
      }

      if (!uniqueCodeFound) {
        return jsonResponse({ error: "Could not generate unique referral code" }, 500);
      }

      referralCode = code;
      const { data: createdPlayer, error: playerError } = await admin
        .from("players")
        .insert({
          id: authUserId,
          telegram_id: telegramId,
          username,
          first_name: firstName,
          referral_code: referralCode,
        })
        .select("entity_number")
        .single();

      if (playerError) {
        console.error("Player creation failed:", playerError);
        return jsonResponse({ error: "Failed to create player record" }, 500);
      }
      entityNumber = typeof createdPlayer?.entity_number === "number" ? createdPlayer.entity_number : null;
    }

    // Migrate legacy deterministic-password accounts once. After migration,
    // the Auth password is random and never returned to the browser.
    const { data: authUserResult, error: authUserError } =
      await admin.auth.admin.getUserById(authUserId);

    if (authUserError || !authUserResult.user) {
      console.error("Auth user lookup failed:", authUserError);
      return jsonResponse({ error: "Could not retrieve the Auth identity" }, 500);
    }

    const currentAppMetadata = authUserResult.user.app_metadata ?? {};
    if (currentAppMetadata.telegram_auth_version !== 2) {
      const { error: rotateError } = await admin.auth.admin.updateUserById(authUserId, {
        password: crypto.randomUUID() + crypto.randomUUID(),
        user_metadata: {
          ...(authUserResult.user.user_metadata ?? {}),
          telegram_id: telegramId,
        },
        app_metadata: {
          ...currentAppMetadata,
          telegram_auth_version: 2,
        },
      });

      if (rotateError) {
        console.error("Legacy Telegram Auth password rotation failed:", rotateError);
        return jsonResponse({ error: "Could not secure the Auth identity. Please retry." }, 500);
      }
    }

    // Supabase generates a one-time token hash; it does not send an email.
    const { data: magicLink, error: magicLinkError } =
      await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });

    const tokenHash = magicLink?.properties?.hashed_token;
    if (magicLinkError || typeof tokenHash !== "string" || !tokenHash) {
      console.error("Telegram magic-link generation failed:", magicLinkError);
      return jsonResponse({ error: "Could not establish a secure Telegram session. Please retry." }, 500);
    }

    // Register referrals using ONLY the signed Telegram start_param.
    // This also retries for existing players without a referral record.
    // The database function prevents duplicate attribution and never
    // replaces an existing referral.

    const signedStartParam = tgData.startParam?.trim() ?? "";

    const normalizedCode = signedStartParam
      .replace(/^ref_/i, "")
      .toUpperCase();

    if (/^ZORD-[A-Z0-9]{6}$/.test(normalizedCode)) {
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
          // Do not block authentication.
          // A later authenticated launch can retry registration.
          console.error(
            "Referral registration failed:",
            referralError,
          );
        } else {
          console.log("Referral registration attempted successfully:", {
            referrer: referrerPlayer.telegram_id,
            recruit: telegramId,
          });
        }
      } else {
        console.log(
          "Referral skipped: referrer not found or self-referral",
        );
      }
    } else if (signedStartParam) {
      console.log("Referral skipped: invalid signed start parameter");
    }

    // Return only a one-time Auth token; never expose a reusable password.
    return jsonResponse({
      tokenHash,
      telegramId,
      username,
      firstName,
      referralCode,
      entityNumber,
    });
  } catch (error) {
    console.error("telegram-auth failed:", error);

    return jsonResponse(
      { error: "Authentication failed" },
      500,
    );
  }
});
