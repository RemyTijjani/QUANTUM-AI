import { createClient } from "npm:@supabase/supabase-js@2";
import { Address, Cell } from "npm:@ton/ton";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TONCENTER_API_KEY = Deno.env.get("TONCENTER_API_KEY") ?? "";
const TONCENTER_TRANSACTIONS_ENDPOINT = "https://toncenter.com/api/v2/getTransactions";
const CLAIM_AMOUNT_NANO = "100000000";
const INTENT_TTL_MS = 15 * 60 * 1000;
const MAX_BODY_BYTES = 8 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function rawAddress(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    return Address.parse(value).toRawString();
  } catch {
    return "";
  }
}

function decodeComment(message: Record<string, unknown>): string {
  if (typeof message.message === "string" && message.message.length > 0) return message.message;
  const rawBody = message.msg_data && typeof message.msg_data === "object"
    ? (message.msg_data as Record<string, unknown>).body
    : null;
  if (typeof rawBody !== "string" || !rawBody) return "";
  try {
    const slice = Cell.fromBase64(rawBody).beginParse();
    if (slice.remainingBits < 32 || slice.loadUint(32) !== 0) return "";
    return slice.loadStringTail();
  } catch {
    return "";
  }
}

async function authenticate(req: Request) {
  const authorization = req.headers.get("Authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return { response: json({ error: "Sign in to claim a ZAP achievement." }, 401) };

  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.getUser(match[1]);
  if (error || !data.user) return { response: json({ error: "Your session is invalid or expired." }, 401) };

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: player, error: playerError } = await admin
    .from("players").select("id").eq("id", data.user.id).maybeSingle();
  if (playerError || !player) return { response: json({ error: "Your ZORD player profile was not found." }, 403) };
  return { admin, player };
}

async function findVerifiedPayment(intent: Record<string, unknown>) {
  if (!TONCENTER_API_KEY) throw new Error("Gram payment verification is not configured. Contact support.");
  const destination = rawAddress(intent.destinationWallet);
  const sender = rawAddress(intent.senderWallet);
  const memo = typeof intent.memo === "string" ? intent.memo : "";
  const amount = String(intent.amountNano ?? "");
  const createdAt = Date.parse(String(intent.createdAt ?? ""));
  const expiresAt = Date.parse(String(intent.expiresAt ?? ""));
  if (!destination || !sender || !memo || amount !== CLAIM_AMOUNT_NANO ||
      !Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) {
    throw new Error("The achievement payment request is invalid.");
  }

  const response = await fetch(TONCENTER_TRANSACTIONS_ENDPOINT, {
    method: "POST",
    headers: { "X-API-Key": TONCENTER_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ address: destination, limit: 100 }),
  });
  if (!response.ok) throw new Error("The Gram network verifier is temporarily unavailable.");
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || (payload as Record<string, unknown>).ok !== true) {
    throw new Error("The Gram network verifier returned an invalid response.");
  }
  const transactions = (payload as Record<string, unknown>).result;
  if (!Array.isArray(transactions)) throw new Error("The Gram network verifier returned invalid transaction data.");

  for (const item of transactions) {
    if (!item || typeof item !== "object") continue;
    const tx = item as Record<string, unknown>;
    const inbound = tx.in_msg && typeof tx.in_msg === "object"
      ? tx.in_msg as Record<string, unknown>
      : null;
    if (!inbound) continue;

    const txTime = Number(tx.utime) * 1000;
    const txSender = rawAddress(inbound.source);
    const txDestination = rawAddress(inbound.destination);
    const txAmount = String(inbound.value ?? "");
    const txMemo = decodeComment(inbound);
    const txId = tx.transaction_id && typeof tx.transaction_id === "object"
      ? (tx.transaction_id as Record<string, unknown>).hash
      : null;

    if (
      txSender === sender &&
      txDestination === destination &&
      txAmount === amount &&
      txMemo === memo &&
      typeof txId === "string" && txId.length > 10 &&
      Number.isFinite(txTime) && txTime >= createdAt - 60_000 && txTime <= expiresAt
    ) {
      return { transactionHash: txId, senderWallet: sender, destinationWallet: String(intent.destinationWallet), amountNano: amount, memo };
    }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) return json({ error: "Achievement claim service is not configured." }, 503);

  try {
    const identity = await authenticate(req);
    if ("response" in identity) return identity.response;
    const { admin, player } = identity;

    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) return json({ error: "Request is too large." }, 413);
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "Invalid request." }, 400);
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "A valid request body is required." }, 400);
    }

    if (body.action === "create") {
      const level = Number(body.level);
      if (!Number.isSafeInteger(level) || level < 1 || level > 1000000) return json({ error: "Choose a valid achievement level." }, 400);
      const memo = "ZORD-ACH-" + crypto.randomUUID().replace(/-/g, "").toUpperCase();
      const { data, error } = await admin.rpc("zap_achievement_create_claim_intent", {
        p_player_id: player.id,
        p_level: level,
        p_payment_memo: memo,
        p_expires_at: new Date(Date.now() + INTENT_TTL_MS).toISOString(),
      });
      if (error || !data?.success) {
        const message = error?.message ?? "Could not prepare this achievement claim.";
        return json({ error: message }, /wallet|reach|threshold/i.test(message) ? 409 : 400);
      }
      return json({ success: true, intent: data });
    }

    if (body.action === "verify") {
      const intentId = typeof body.intentId === "string" ? body.intentId : "";
      if (!/^[0-9a-f-]{36}$/i.test(intentId)) return json({ error: "A valid payment request is required." }, 400);

      const { data: intent, error: intentError } = await admin.rpc("zap_achievement_get_claim_intent", {
        p_player_id: player.id,
        p_intent_id: intentId,
      });
      if (intentError || !intent) return json({ error: "Achievement payment request was not found." }, 404);
      if (intent.status === "confirmed") {
        return json({ success: true, claimed: true, alreadyApplied: true, level: intent.level });
      }
      if (intent.status !== "pending" || Date.parse(intent.expiresAt) <= Date.now()) {
        return json({ error: "This payment request has expired. Start the claim again." }, 410);
      }

      const payment = await findVerifiedPayment(intent);
      if (!payment) {
        return json({
          success: false,
          pending: true,
          error: "Payment has not appeared on the Gram network yet. Wait briefly, then verify again.",
        }, 202);
      }

      const { data: completed, error: completeError } = await admin.rpc("zap_achievement_complete_claim", {
        p_player_id: player.id,
        p_intent_id: intentId,
        p_transaction_hash: payment.transactionHash,
        p_sender_wallet: payment.senderWallet,
        p_destination_wallet: payment.destinationWallet,
        p_amount_nano: payment.amountNano,
        p_payment_memo: payment.memo,
      });
      if (completeError || !completed?.success) {
        const message = completeError?.message ?? "The verified payment could not complete the achievement claim.";
        return json({ error: message }, 409);
      }
      return json({ success: true, claimed: true, alreadyApplied: Boolean(completed.alreadyApplied), level: completed.level });
    }

    return json({ error: "Unknown achievement claim action." }, 400);
  } catch (error) {
    console.error("ZAP achievement claim failed", error);
    return json({ error: error instanceof Error ? error.message : "Could not process the achievement claim." }, 503);
  }
});
