import { createClient } from "npm:@supabase/supabase-js@2";
import { GetObjectCommand, PutObjectCommand, S3Client } from "npm:@aws-sdk/client-s3@3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const R2_ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID") ?? "";
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
const R2_BUCKET_NAME = Deno.env.get("R2_BUCKET_NAME") ?? "";
const R2_ENDPOINT = Deno.env.get("R2_ENDPOINT") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return bytesToHex(await crypto.subtle.digest("SHA-256", bytes));
}

async function transform(bytes: Uint8Array, format: "gzip" | "gunzip"): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(
    format === "gzip" ? new CompressionStream("gzip") : new DecompressionStream("gzip"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function bodyToBytes(body: unknown): Promise<Uint8Array> {
  if (!body || typeof body !== "object" || !("transformToByteArray" in body)) {
    throw new Error("R2 returned an unreadable object body.");
  }
  const result = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
  return new Uint8Array(result);
}

function getR2Endpoint(): string {
  const configured = R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const url = new URL(configured);
  if (url.pathname.replace(/\/$/, "") === `/${R2_BUCKET_NAME}`) url.pathname = "";
  return url.toString().replace(/\/$/, "");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY ||
      !R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY ||
      !R2_BUCKET_NAME || !R2_ENDPOINT) {
    console.error("History archive service configuration is incomplete.");
    return json({ error: "History archive service is not configured." }, 500);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return json({ error: "Sign in to run the archive verification." }, 401);

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

    const payload = await req.json().catch(() => ({}));
    if (payload?.action !== "copy-test") return json({ error: "Unsupported archive action." }, 400);

    const { data: rows, error: ledgerError } = await admin
      .from("economy_ledger")
      .select("id, player_id, transaction_type, amount, balance_after, reference_id, description, created_at")
      .eq("player_id", player.id)
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(10);
    if (ledgerError) {
      console.error("ZP ledger test batch lookup failed:", ledgerError);
      return json({ error: "Could not read the ZP history test batch." }, 500);
    }
    if (!rows?.length) return json({ success: true, copied: 0, verified: true, message: "No ZP ledger records exist for this player yet." });

    const exportedAt = new Date().toISOString();
    const document = {
      schema_version: 1,
      archive_type: "zord.zp_economy_ledger.test_copy",
      exported_at: exportedAt,
      player_id: player.id,
      row_count: rows.length,
      oldest_created_at: rows.reduce((v, row) => !v || (row.created_at && row.created_at < v) ? row.created_at : v, null as string | null),
      newest_created_at: rows.reduce((v, row) => !v || (row.created_at && row.created_at > v) ? row.created_at : v, null as string | null),
      records: rows,
    };

    const plainBytes = new TextEncoder().encode(JSON.stringify(document));
    const checksum = await sha256(plainBytes);
    const compressedBytes = await transform(plainBytes, "gzip");
    const objectKey = `test-copies/economy-ledger/player=${player.id}/exported_at=${exportedAt.replace(/[:.]/g, "-")}.json.gz`;

    const s3 = new S3Client({
      region: "auto",
      endpoint: getR2Endpoint(),
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    });

    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: objectKey,
      Body: compressedBytes,
      ContentType: "application/json",
      ContentEncoding: "gzip",
      Metadata: {
        "schema-version": "1",
        "row-count": String(rows.length),
        "sha256": checksum,
        "archive-type": "zord.zp_economy_ledger.test_copy",
      },
    }));

    const downloaded = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: objectKey }));
    const downloadedCompressed = await bodyToBytes(downloaded.Body);
    const downloadedPlain = await transform(downloadedCompressed, "gunzip");
    const downloadedChecksum = await sha256(downloadedPlain);
    const restored = JSON.parse(new TextDecoder().decode(downloadedPlain));
    const verified = downloadedChecksum === checksum &&
      Array.isArray(restored.records) &&
      restored.records.length === rows.length &&
      restored.row_count === rows.length &&
      restored.player_id === player.id;

    if (!verified) {
      console.error("R2 copy verification failed for test object:", objectKey);
      return json({ error: "The R2 test copy was uploaded but did not pass read-back verification.", copied: rows.length }, 502);
    }

    return json({
      success: true,
      copied: rows.length,
      verified: true,
      checksum,
      objectKey,
      source: "public.economy_ledger",
      note: "Copy-only test. No Supabase records were changed or deleted.",
    });
  } catch (error) {
    console.error("History archive test failed:", error);
    return json({ error: "The history archive test could not be completed." }, 500);
  }
});
