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

async function getPlayer(req: Request) {
  const authorization = req.headers.get("Authorization") ?? "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) {
    return { error: json({ error: "Sign in to access your ZAP wallet." }, 401) };
  }

  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(tokenMatch[1]);
  if (authError || !authData.user) {
    return { error: json({ error: "Your session is invalid or expired." }, 401) };
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: player, error: playerError } = await admin
    .from("players").select("id").eq("id", authData.user.id).maybeSingle();

  if (playerError || !player) {
    return { error: json({ error: "Player profile was not found." }, 403) };
  }

  return { admin, player };
}

async function readWallet(admin: ReturnType<typeof createClient>, playerId: string) {
  const { data: wallet, error } = await admin.rpc("get_player_zap_wallet", {
    p_player_id: playerId,
  });
  if (error || !wallet) {
    console.error("ZAP wallet lookup failed:", error);
    return null;
  }
  return wallet;
}

async function readLeaderboard(admin: ReturnType<typeof createClient>, playerId: string) {
  const { data, error } = await admin.rpc("get_zap_leaderboard", {
    p_player_id: playerId,
    p_limit: 20,
  });
  if (error || !data) {
    console.error("ZAP leaderboard lookup failed:", error);
    return null;
  }
  return data as {
    entries: Array<{ rank: number; name: string; rankingEarned: number; isYou: boolean }>;
    me: { rank: number; name: string; rankingEarned: number; isYou: boolean };
    limit: number;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    return json({ error: "ZAP wallet service is not configured." }, 500);
  }

  try {
    const identity = await getPlayer(req);
    if ("error" in identity) return identity.error;
    const { admin, player } = identity;

    if (req.method === "GET") {
      const action = new URL(req.url).searchParams.get("action");
      if (action === "leaderboard") {
        const leaderboard = await readLeaderboard(admin, player.id);
        if (!leaderboard) return json({ error: "Could not load the ZAP leaderboard." }, 500);
        return json({ success: true, leaderboard, source: "server_zap_earnings_leaderboard" });
      }
      if (action === "achievements") {
        const { data: achievements, error: achievementsError } = await admin.rpc("get_player_zap_achievements", {
          p_player_id: player.id,
        });
        if (achievementsError || !achievements) {
          console.error("ZAP achievements lookup failed:", achievementsError);
          return json({ error: "Could not load your ZAP achievements." }, 500);
        }
        return json({ success: true, achievements, source: "server_zap_ring_achievements" });
      }
      const wallet = await readWallet(admin, player.id);
      if (!wallet) return json({ error: "Could not load your ZAP wallet." }, 500);
      const leaderboard = await readLeaderboard(admin, player.id);
      if (!leaderboard) return json({ error: "Could not load your ZAP earnings total." }, 500);
      return json({
        success: true,
        wallet: { ...wallet, rankingEarned: Number(leaderboard.me.rankingEarned) },
        source: "server_player_zap_wallet",
      });
    }

    let body: { amountZp?: unknown; idempotencyKey?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "A valid conversion request is required." }, 400);
    }

    const amountZp = typeof body.amountZp === "string"
      ? body.amountZp
      : typeof body.amountZp === "number" && Number.isSafeInteger(body.amountZp)
        ? String(body.amountZp)
        : "";
    const idempotencyKey = typeof body.idempotencyKey === "string"
      ? body.idempotencyKey.trim()
      : "";

    if (!/^[1-9][0-9]{0,22}$/.test(amountZp)) {
      return json({ error: "Enter a valid whole-number ZP amount." }, 400);
    }
    const amountBigInt = BigInt(amountZp);
    if (amountBigInt % 1000n !== 0n || amountBigInt / 1000n > 99999999999999999999n) {
      return json({ error: "Conversions must be in multiples of 1,000 ZP." }, 400);
    }
    if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      return json({ error: "A valid conversion request key is required." }, 400);
    }

    const { data: conversion, error: conversionError } = await admin.rpc("convert_zp_to_zap", {
      p_player_id: player.id,
      p_zp_amount: amountZp,
      p_idempotency_key: idempotencyKey,
    });

    if (conversionError || !conversion?.success) {
      const message = conversionError?.message ?? "The conversion could not be completed.";
      const status = /insufficient/i.test(message) ? 409 : /multiples of 1,000|valid conversion/i.test(message) ? 400 : 500;
      return json({ error: message }, status);
    }

    const wallet = await readWallet(admin, player.id);
    if (!wallet) return json({ error: "Conversion completed, but the updated wallet could not be loaded. Refresh your wallet." }, 500);
    const leaderboard = await readLeaderboard(admin, player.id);
    if (!leaderboard) return json({ error: "Conversion completed, but your ranking total could not be loaded. Refresh your wallet." }, 500);

    return json({
      success: true,
      conversion,
      wallet: { ...wallet, rankingEarned: Number(leaderboard.me.rankingEarned) },
      source: "server_atomic_zp_to_zap_conversion",
    });
  } catch (error) {
    console.error("ZAP wallet request failed:", error);
    return json({ error: "Could not process your ZAP wallet request." }, 500);
  }
});
