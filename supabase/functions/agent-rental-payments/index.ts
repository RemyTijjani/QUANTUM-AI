import { createClient } from "npm:@supabase/supabase-js@2";
import { Address, Cell } from "npm:@ton/core";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TONCENTER_API_KEY = Deno.env.get("TONCENTER_API_KEY") ?? "";
const TREASURY_ADDRESS = Deno.env.get("ZORD_GRAM_TREASURY_ADDRESS") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function parseComment(msg: any): string | null {
  try {
    const data = msg?.msg_data;
    if (data?.["@type"] === "msg.dataText" && typeof data.text === "string") {
      return new TextDecoder().decode(Uint8Array.from(atob(data.text), (c) => c.charCodeAt(0)));
    }
    if (data?.["@type"] === "msg.dataRaw" && typeof data.body === "string") {
      const bytes = Uint8Array.from(atob(data.body), (c) => c.charCodeAt(0));
      const root = Cell.fromBoc(bytes)[0];
      const slice = root.beginParse();
      if (slice.remainingBits < 32 || slice.loadUint(32) !== 0) return null;
      return slice.loadStringTail();
    }
    if (typeof msg?.message === "string" && msg.message.length > 0) return msg.message;
  } catch {
    return null;
  }
  return null;
}

function rawAddress(value: string): string {
  return Address.parse(value).toRawString().toLowerCase();
}

async function findMainnetPayment(reference: string, amountNano: string, createdAt: string, expiresAt: string) {
  const response = await fetch("https://toncenter.com/api/v2/getTransactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": TONCENTER_API_KEY },
    body: JSON.stringify({ address: TREASURY_ADDRESS, limit: 100 }),
  });
  if (!response.ok) throw new Error(`TON Center returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.ok !== true || !Array.isArray(payload.result)) throw new Error("TON Center returned an invalid transaction response.");

  const treasuryRaw = rawAddress(TREASURY_ADDRESS);
  const created = Math.floor(new Date(createdAt).getTime() / 1000);
  const expires = Math.floor(new Date(expiresAt).getTime() / 1000);

  for (const tx of payload.result) {
    const incoming = tx?.in_msg;
    if (!incoming || incoming.bounced === true) continue;
    if (typeof incoming.destination !== "string" || rawAddress(incoming.destination) !== treasuryRaw) continue;
    if (String(incoming.value) !== amountNano) continue;
    if (parseComment(incoming) !== reference) continue;

    const timestamp = Number(tx.utime);
    if (!Number.isFinite(timestamp) || timestamp < created || timestamp > expires) continue;
    const hash = tx?.transaction_id?.hash;
    const sender = incoming.source;
    if (typeof hash !== "string" || !hash || typeof sender !== "string" || !sender) continue;

    return { hash, sender, timestamp };
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY || !TONCENTER_API_KEY || !TREASURY_ADDRESS) {
    console.error("Agent rental payment service configuration is incomplete.");
    return json({ error: "Agent rental payments are not configured." }, 500);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return json({ error: "Sign in to continue." }, 401);

  try {
    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(tokenMatch[1]);
    if (authError || !authData.user) return json({ error: "Your session is invalid or expired." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: player, error: playerError } = await admin
      .from("players").select("id").eq("id", authData.user.id).maybeSingle();
    if (playerError || !player) return json({ error: "Player profile was not found." }, 403);

    const rawBody = await req.text();
    if (rawBody.length > 4096) return json({ error: "Request is too large." }, 413);
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "Invalid request." }, 400);
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid request." }, 400);
    }

    if (body.action === "create_intent") {
      if (body.agentType !== "alpha_miner" && body.agentType !== "overclocked_core") {
        return json({ error: "Choose a valid agent." }, 400);
      }
      const reference = `ZORD-AGENT-${crypto.randomUUID()}`;
      const { data, error } = await admin.rpc("create_agent_rental_payment_intent", {
        p_player_id: player.id,
        p_agent_type: body.agentType,
        p_payment_reference: reference,
        p_recipient_address: TREASURY_ADDRESS,
      });
      if (error || !data) {
        console.error("Agent rental payment intent creation failed:", error);
        return json({ error: "Could not create a payment request." }, 500);
      }
      return json({
        success: true,
        intent: {
          id: data.id,
          agentType: data.agent_type,
          amountNano: data.amount_nano,
          currency: "GRAM",
          network: "mainnet",
          recipientAddress: data.recipient_address,
          paymentReference: data.payment_reference,
          expiresAt: data.expires_at,
        },
      });
    }

    if (body.action === "verify_payment") {
      if (typeof body.intentId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.intentId)) {
        return json({ error: "A valid payment request is required." }, 400);
      }
      const { data: intent, error: intentError } = await admin
        .from("agent_rental_payment_intents")
        .select("id, player_id, agent_type, amount_nano, payment_reference, recipient_address, status, created_at, expires_at")
        .eq("id", body.intentId).eq("player_id", player.id).maybeSingle();
      if (intentError || !intent) return json({ error: "Payment request was not found." }, 404);

      if (intent.status === "paid") {
        const { data: rental } = await admin.from("player_agent_rentals")
          .select("expires_at").eq("player_id", player.id).eq("agent_type", intent.agent_type).maybeSingle();
        return json({ success: true, alreadyPaid: true, agentType: intent.agent_type, expiresAt: rental?.expires_at ?? null });
      }
      if (intent.status !== "pending" || new Date(intent.expires_at).getTime() <= Date.now()) {
        return json({ error: "This payment request has expired. Create a new one." }, 409);
      }
      if (rawAddress(intent.recipient_address) !== rawAddress(TREASURY_ADDRESS)) {
        return json({ error: "Payment destination configuration mismatch." }, 500);
      }

      const payment = await findMainnetPayment(
        intent.payment_reference,
        String(intent.amount_nano),
        intent.created_at,
        intent.expires_at,
      );
      if (!payment) return json({ success: false, pending: true, message: "Payment has not been confirmed on TON mainnet yet." }, 202);

      const { data: confirmed, error: confirmError } = await admin.rpc("confirm_agent_rental_payment", {
        p_intent_id: intent.id,
        p_transaction_hash: payment.hash,
        p_sender_address: payment.sender,
        p_chain_transaction_at: new Date(payment.timestamp * 1000).toISOString(),
      });
      if (confirmError || !confirmed?.success) {
        console.error("Verified agent rental payment could not be recorded:", confirmError ?? confirmed?.reason);
        return json({ error: "Payment was found but rental activation needs support review." }, 409);
      }
      return json(confirmed);
    }

    return json({ error: "Unknown payment action." }, 400);
  } catch (error) {
    console.error("Agent rental payment request failed:", error);
    return json({ error: "Could not process the agent rental payment request." }, 500);
  }
});
