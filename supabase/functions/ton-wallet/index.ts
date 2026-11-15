import { createClient } from "npm:@supabase/supabase-js@2";
import {
  Address,
  Cell,
  contractAddress,
  domainSignVerify,
  loadStateInit,
  WalletContractV1R1,
  WalletContractV1R2,
  WalletContractV1R3,
  WalletContractV2R1,
  WalletContractV2R2,
  WalletContractV3R1,
  WalletContractV3R2,
  WalletContractV4,
  WalletContractV5R1,
  type Slice,
  type StateInit,
} from "npm:@ton/ton";
import { Buffer } from "npm:buffer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TON_CONNECT_DOMAIN = (Deno.env.get("TON_CONNECT_DOMAIN") ?? "").trim().toLowerCase();
const CHALLENGE_TTL_SECONDS = 5 * 60;
const PROOF_TTL_SECONDS = 10 * 60;
const MAX_BODY_BYTES = 16 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

function randomPayload(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return hex(bytes);
}

async function authenticate(req: Request) {
  const authorization = req.headers.get("Authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return { response: json({ error: "Sign in to use your TON wallet." }, 401) };

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

function parseWalletPublicKey(stateInit: StateInit): Buffer | null {
  if (!stateInit.code || !stateInit.data) return null;
  const loadV1 = (slice: Slice) => {
    slice.loadUint(32);
    return slice.loadBuffer(32);
  };
  const loadV2 = (slice: ReturnType<typeof stateInit.data.beginParse>) => {
    slice.loadUint(32);
    return slice.loadBuffer(32);
  };
  const loadV3 = (slice: ReturnType<typeof stateInit.data.beginParse>) => {
    slice.loadUint(32);
    slice.loadUint(32);
    return slice.loadBuffer(32);
  };
  const loadV4 = (slice: ReturnType<typeof stateInit.data.beginParse>) => {
    slice.loadUint(32);
    slice.loadUint(32);
    return slice.loadBuffer(32);
  };
  const loadV5 = (slice: ReturnType<typeof stateInit.data.beginParse>) => {
    slice.loadBoolean();
    slice.loadUint(32);
    slice.loadUint(32);
    return slice.loadBuffer(32);
  };
  const zeroKey = Buffer.alloc(32);
  const known = [
    { code: WalletContractV1R1.create({ workchain: 0, publicKey: zeroKey }).init.code, load: loadV1 },
    { code: WalletContractV1R2.create({ workchain: 0, publicKey: zeroKey }).init.code, load: loadV1 },
    { code: WalletContractV1R3.create({ workchain: 0, publicKey: zeroKey }).init.code, load: loadV1 },
    { code: WalletContractV2R1.create({ workchain: 0, publicKey: zeroKey }).init.code, load: loadV2 },
    { code: WalletContractV2R2.create({ workchain: 0, publicKey: zeroKey }).init.code, load: loadV2 },
    { code: WalletContractV3R1.create({ workchain: 0, publicKey: zeroKey }).init.code, load: loadV3 },
    { code: WalletContractV3R2.create({ workchain: 0, publicKey: zeroKey }).init.code, load: loadV3 },
    { code: WalletContractV4.create({ workchain: 0, publicKey: zeroKey }).init.code, load: loadV4 },
    { code: WalletContractV5R1.create({ workchain: 0, publicKey: zeroKey }).init.code, load: loadV5 },
  ];
  for (const item of known) {
    try {
      if (item.code.equals(stateInit.code)) return item.load(stateInit.data.beginParse());
    } catch {
      // A code/layout mismatch is rejected; continue only through known wallet versions.
    }
  }
  return null;
}

function signatureDomain(network: string) {
  if (network === "-239" || network === "-3") return { type: "empty" as const };
  return { type: "l2" as const, globalId: Number(network) };
}

async function verifyTonProof(body: Record<string, unknown>, expectedPayload: string) {
  const addressText = typeof body.address === "string" ? body.address : "";
  const network = typeof body.network === "string" ? body.network : "";
  const proof = body.proof && typeof body.proof === "object" && !Array.isArray(body.proof)
    ? body.proof as Record<string, unknown>
    : null;
  if (!proof || network !== "-239" || !TON_CONNECT_DOMAIN || !addressText) return null;

  const timestampValue = proof.timestamp;
  const timestamp = typeof timestampValue === "number"
    ? timestampValue
    : typeof timestampValue === "string" && /^\d{1,12}$/.test(timestampValue)
      ? Number(timestampValue)
      : NaN;
  const domain = proof.domain && typeof proof.domain === "object"
    ? proof.domain as Record<string, unknown>
    : null;
  const domainValue = typeof domain?.value === "string" ? domain.value : "";
  const domainLength = domain?.lengthBytes;
  const payload = typeof proof.payload === "string" ? proof.payload : "";
  const signatureText = typeof proof.signature === "string" ? proof.signature : "";
  const stateInitText = typeof proof.state_init === "string" ? proof.state_init : "";
  const publicKeyHint = typeof body.public_key === "string" ? body.public_key : "";

  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return null;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > PROOF_TTL_SECONDS) return null;
  if (domainValue !== TON_CONNECT_DOMAIN || domainLength !== new TextEncoder().encode(domainValue).length) return null;
  if (payload !== expectedPayload || new TextEncoder().encode(payload).length > 128) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(publicKeyHint)) return null;

  let address: Address;
  let stateInit: StateInit;
  let signature: Buffer;
  try {
    address = Address.parse(addressText);
    stateInit = loadStateInit(Cell.fromBase64(stateInitText).beginParse());
    signature = Buffer.from(signatureText, "base64");
  } catch {
    return null;
  }
  if (signature.length !== 64) return null;

  const derivedAddress = contractAddress(address.workChain, stateInit);
  if (!derivedAddress.equals(address)) return null;

  const publicKey = parseWalletPublicKey(stateInit);
  if (!publicKey || publicKey.length !== 32) return null;
  if (!publicKey.equals(Buffer.from(publicKeyHint, "hex"))) return null;

  const workchain = Buffer.alloc(4);
  workchain.writeInt32BE(address.workChain, 0);
  const domainBytes = Buffer.from(domainValue, "utf8");
  const domainLengthBytes = Buffer.alloc(4);
  domainLengthBytes.writeUInt32LE(domainBytes.length, 0);
  const timestampBytes = Buffer.alloc(8);
  timestampBytes.writeBigUInt64LE(BigInt(timestamp), 0);
  const message = Buffer.concat([
    Buffer.from("ton-proof-item-v2/", "utf8"),
    workchain,
    address.hash,
    domainLengthBytes,
    domainBytes,
    timestampBytes,
    Buffer.from(payload, "utf8"),
  ]);

  const messageHash = new Uint8Array(await crypto.subtle.digest("SHA-256", message));
  const digestInput = Buffer.concat([Buffer.from([0xff, 0xff]), Buffer.from("ton-connect", "utf8"), Buffer.from(messageHash)]);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", digestInput));
  const valid = await domainSignVerify({
    data: digest,
    signature: new Uint8Array(signature),
    publicKey: new Uint8Array(publicKey),
    domain: signatureDomain(network),
  });
  return valid ? { address: address.toString({ bounceable: false }), publicKey: publicKey.toString("hex"), timestamp } : null;
}

async function readWallet(admin: ReturnType<typeof createClient>, playerId: string) {
  const db = admin.schema("app_private");
  const [walletResult, balanceResult, ledgerResult, requestsResult] = await Promise.all([
    db.from("player_ton_wallets").select("id,wallet_address,network,verification_status,verified_at").eq("player_id", playerId).maybeSingle(),
    db.from("player_ton_balances").select("available_nano,reserved_nano,updated_at").eq("player_id", playerId).maybeSingle(),
    db.from("player_ton_ledger").select("id,entry_type,direction,amount_nano,available_after_nano,reference_type,created_at").eq("player_id", playerId).order("created_at", { ascending: false }).limit(10),
    db.from("ton_withdrawal_requests").select("id,amount_nano,status,wallet_address,transaction_hash,admin_note,created_at,updated_at,paid_at").eq("player_id", playerId).order("created_at", { ascending: false }).limit(10),
  ]);
  if (walletResult.error || balanceResult.error || ledgerResult.error || requestsResult.error) {
    console.error("TON wallet read failed", walletResult.error ?? balanceResult.error ?? ledgerResult.error ?? requestsResult.error);
    throw new Error("Could not load the TON wallet.");
  }
  return {
    wallet: walletResult.data,
    balance: {
      availableNano: balanceResult.data?.available_nano ?? "0",
      reservedNano: balanceResult.data?.reserved_nano ?? "0",
      updatedAt: balanceResult.data?.updated_at ?? null,
    },
    transactions: ledgerResult.data ?? [],
    withdrawals: requestsResult.data ?? [],
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) return json({ error: "TON wallet service is not configured." }, 503);

  try {
    const identity = await authenticate(req);
    if ("response" in identity) return identity.response;
    const { admin, player } = identity;
    const db = admin.schema("app_private");

    if (req.method === "GET") {
      return json({ success: true, ...(await readWallet(admin, player.id)) });
    }

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

    const action = typeof body.action === "string" ? body.action : "";
    if (action === "challenge") {
      const { count, error: countError } = await db.from("ton_wallet_proof_challenges")
        .select("id", { count: "exact", head: true })
        .eq("player_id", player.id)
        .is("consumed_at", null)
        .gt("expires_at", new Date().toISOString());
      if (countError) return json({ error: "Could not prepare wallet verification." }, 500);
      if ((count ?? 0) >= 3) return json({ error: "Please wait for an existing wallet verification attempt to expire." }, 429);

      const payload = randomPayload();
      const payloadHash = await sha256Hex(payload);
      const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString();
      const { error } = await db.from("ton_wallet_proof_challenges").insert({
        player_id: player.id,
        payload_hash: payloadHash,
        expires_at: expiresAt,
      });
      if (error) {
        console.error("TON challenge creation failed", error);
        return json({ error: "Could not prepare wallet verification. Please try again." }, 500);
      }
      return json({ success: true, payload, expiresAt });
    }

    if (action === "verify") {
      const proof = body.proof && typeof body.proof === "object" && !Array.isArray(body.proof)
        ? body.proof as Record<string, unknown>
        : null;
      const payload = typeof proof?.payload === "string" ? proof.payload : "";
      if (!/^[a-f0-9]{64}$/.test(payload)) return json({ error: "The wallet proof is missing or invalid. Reconnect and try again." }, 400);

      const payloadHash = await sha256Hex(payload);
      const { data: challenge, error: challengeError } = await db.from("ton_wallet_proof_challenges")
        .select("id")
        .eq("player_id", player.id)
        .eq("payload_hash", payloadHash)
        .is("consumed_at", null)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (challengeError || !challenge) return json({ error: "This verification request expired or was already used. Reconnect your wallet." }, 409);

      const verified = await verifyTonProof(body, payload);
      if (!verified) return json({ error: "Wallet ownership could not be verified. Make sure you use a TON mainnet wallet that supports TON proof." }, 400);

      const { data: consumed, error: consumeError } = await db.from("ton_wallet_proof_challenges")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", challenge.id)
        .eq("player_id", player.id)
        .is("consumed_at", null)
        .gt("expires_at", new Date().toISOString())
        .select("id")
        .maybeSingle();
      if (consumeError || !consumed) return json({ error: "This verification request was already used. Please reconnect your wallet." }, 409);

      const { data: savedWallet, error: saveError } = await db.from("player_ton_wallets").upsert({
        player_id: player.id,
        wallet_address: verified.address,
        network: "-239",
        verification_status: "verified",
        proof_public_key: verified.publicKey,
        proof_timestamp: new Date(verified.timestamp * 1000).toISOString(),
        verified_at: new Date().toISOString(),
        revoked_at: null,
      }, { onConflict: "player_id" }).select("id,wallet_address,network,verification_status,verified_at").single();

      if (saveError || !savedWallet) {
        console.error("Verified TON wallet could not be saved", saveError);
        return json({ error: "The proof was valid, but the wallet could not be linked. Contact support if this continues." }, 409);
      }
      return json({ success: true, wallet: savedWallet });
    }

    if (action === "withdraw") {
      const amountNano = typeof body.amountNano === "string"
        ? body.amountNano
        : typeof body.amountNano === "number" && Number.isSafeInteger(body.amountNano)
          ? String(body.amountNano)
          : "";
      const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
      if (!/^[1-9][0-9]{0,29}$/.test(amountNano)) return json({ error: "Enter a valid whole nanoTON amount." }, 400);
      if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return json({ error: "A valid withdrawal request key is required." }, 400);

      const { data: result, error } = await admin.rpc("request_ton_withdrawal", {
        p_player_id: player.id,
        p_amount_nano: amountNano,
        p_idempotency_key: idempotencyKey,
      });
      if (error || !result?.success) {
        const message = error?.message ?? "The withdrawal request could not be created.";
        const status = /insufficient/i.test(message) ? 409 : /verified TON wallet/i.test(message) ? 409 : 400;
        return json({ error: message }, status);
      }
      return json({ success: true, result, ...(await readWallet(admin, player.id)) });
    }

    return json({ error: "Unknown TON wallet action." }, 400);
  } catch (error) {
    console.error("TON wallet request failed", error);
    return json({ error: error instanceof Error ? error.message : "Could not process the TON wallet request." }, 500);
  }
});
