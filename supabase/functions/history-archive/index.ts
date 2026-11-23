import { createClient } from "npm:@supabase/supabase-js@2";
import { GetObjectCommand, PutObjectCommand, S3Client } from "npm:@aws-sdk/client-s3@3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_USERNAME = Deno.env.get("ADMIN_USERNAME") ?? "";
const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") ?? "";
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

async function archiveBatch(
  s3: S3Client,
  rows: Array<Record<string, unknown>>,
  exportedAt: string,
  prefix: string,
) {
  const document = {
    schema_version: 1,
    archive_type: "zord.zp_economy_ledger",
    exported_at: exportedAt,
    player_count: new Set(rows.map((row) => row.player_id)).size,
    row_count: rows.length,
    oldest_created_at: rows.reduce((v, row) => !v || (row.created_at && String(row.created_at) < v) ? String(row.created_at) : v, null as string | null),
    newest_created_at: rows.reduce((v, row) => !v || (row.created_at && String(row.created_at) > v) ? String(row.created_at) : v, null as string | null),
    records: rows,
  };
  const plainBytes = new TextEncoder().encode(JSON.stringify(document));
  const checksum = await sha256(plainBytes);
  const compressedBytes = await transform(plainBytes, "gzip");
  const firstId = String(rows[0].id);
  const lastId = String(rows[rows.length - 1].id);
  const objectKey = `${prefix}/from=${firstId}/to=${lastId}.json.gz`;

  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: objectKey,
    Body: compressedBytes,
    ContentType: "application/gzip",
    Metadata: {
      "schema-version": "1",
      "row-count": String(rows.length),
      "sha256": checksum,
      "archive-type": "zord.zp_economy_ledger",
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
    restored.player_count === new Set(rows.map((row) => row.player_id)).size;
  if (!verified) throw new Error(`R2 checksum or row-count verification failed for ${objectKey}`);
  return { checksum, objectKey, playerCount: document.player_count, rowCount: rows.length };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ADMIN_USERNAME || !ADMIN_PASSWORD ||
      !R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY ||
      !R2_BUCKET_NAME || !R2_ENDPOINT) {
    console.error("History archive service configuration is incomplete.");
    return json({ error: "History archive service is not configured." }, 500);
  }

  try {
    const payload = await req.json().catch(() => ({}));
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD ||
        payload?.adminUsername !== ADMIN_USERNAME ||
        payload?.adminPassword !== ADMIN_PASSWORD) {
      return json({ error: "Unauthorized. Admin access is required." }, 401);
    }
    if (payload?.action !== "copy-test" && payload?.action !== "copy-batch") {
      return json({ error: "Unsupported archive action." }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const columns = "id, player_id, transaction_type, amount, balance_after, reference_id, description, created_at";
    const exportedAt = new Date().toISOString();
    const s3 = new S3Client({
      region: "auto",
      endpoint: getR2Endpoint(),
      responseChecksumValidation: "WHEN_REQUIRED",
      requestChecksumCalculation: "WHEN_REQUIRED",
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    });

    if (payload?.action === "copy-test") {
      const { data: rows, error: ledgerError } = await admin
        .from("economy_ledger")
        .select(columns)
        .order("created_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(10);
      if (ledgerError) {
        console.error("ZP ledger test batch lookup failed:", ledgerError);
        return json({ error: "Could not read the ZP history test batch." }, 500);
      }
      if (!rows?.length) return json({ success: true, copied: 0, verified: true, message: "No ZP ledger records are available to copy." });
      const result = await archiveBatch(s3, rows, exportedAt, "test-copies/economy-ledger");
      return json({ success: true, copied: rows.length, verified: true, ...result,
        source: "public.economy_ledger",
        note: "Copy-only test. No Supabase records were changed or deleted." });
    }

    const batchSize = Math.min(200, Math.max(1, Number.isInteger(payload?.batchSize) ? payload.batchSize : 200));
    let highWater = payload?.cursor?.highWater ?? null;
    let after = payload?.cursor?.after ?? null;

    if (payload?.cursor && (!highWater?.created_at || !highWater?.id || !after?.created_at || !after?.id)) {
      return json({ error: "Invalid archive cursor." }, 400);
    }

    if (!highWater) {
      const { data: newest, error: newestError } = await admin
        .from("economy_ledger")
        .select("id, created_at")
        .order("created_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (newestError) {
        console.error("Could not establish ZP ledger archive boundary:", newestError);
        return json({ error: "Could not establish the archive boundary." }, 500);
      }
      if (!newest) return json({ success: true, copied: 0, verified: true, done: true, cursor: null });
      highWater = { id: newest.id, created_at: newest.created_at };
    }

    let query = admin.from("economy_ledger").select(columns)
      .lte("created_at", highWater.created_at)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(batchSize);
    if (after) {
      query = query.or(`created_at.lt.${after.created_at},and(created_at.eq.${after.created_at},id.lt.${after.id})`);
    }
    const { data: rows, error: ledgerError } = await query;
    if (ledgerError) {
      console.error("ZP ledger archive batch lookup failed:", ledgerError);
      return json({ error: "Could not read the next ZP history batch." }, 500);
    }
    if (!rows?.length) return json({ success: true, copied: 0, verified: true, done: true, cursor: null });

    const result = await archiveBatch(s3, rows, exportedAt, "history/economy-ledger");
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === batchSize
      ? { highWater, after: { id: last.id, created_at: last.created_at } }
      : null;

    return json({
      success: true,
      copied: rows.length,
      verified: true,
      ...result,
      done: nextCursor === null,
      cursor: nextCursor,
      source: "public.economy_ledger",
      batch_size: batchSize,
      note: "Copy-only archive. No Supabase records were changed or deleted.",
    });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: rows, error: ledgerError } = await admin
      .from("economy_ledger")
      .select("id, player_id, transaction_type, amount, balance_after, reference_id, description, created_at")
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(10);
    if (ledgerError) {
      console.error("ZP ledger test batch lookup failed:", ledgerError);
      return json({ error: "Could not read the ZP history test batch." }, 500);
    }
    if (!rows?.length) return json({ success: true, copied: 0, verified: true, message: "No ZP ledger records are available to copy." });

    const exportedAt = new Date().toISOString();
    const document = {
      schema_version: 1,
      archive_type: "zord.zp_economy_ledger.test_copy",
      exported_at: exportedAt,
      player_count: new Set(rows.map((row) => row.player_id)).size,
      row_count: rows.length,
      oldest_created_at: rows.reduce((v, row) => !v || (row.created_at && row.created_at < v) ? row.created_at : v, null as string | null),
      newest_created_at: rows.reduce((v, row) => !v || (row.created_at && row.created_at > v) ? row.created_at : v, null as string | null),
      records: rows,
    };

    const plainBytes = new TextEncoder().encode(JSON.stringify(document));
    const checksum = await sha256(plainBytes);
    const compressedBytes = await transform(plainBytes, "gzip");
    const objectKey = `test-copies/economy-ledger/batch=${exportedAt.replace(/[:.]/g, "-")}.json.gz`;

    const s3 = new S3Client({
      region: "auto",
      endpoint: getR2Endpoint(),
      // R2's optional CRC32 response header can conflict with the SDK's
      // automatic validation. The archive payload is independently verified
      // after download using the SHA-256 digest below.
      responseChecksumValidation: "WHEN_REQUIRED",
      requestChecksumCalculation: "WHEN_REQUIRED",
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    });

    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: objectKey,
      Body: compressedBytes,
      // Store the gzip bytes as an archive object, but do not set HTTP
      // Content-Encoding: clients may transparently decompress GetObject bodies.
      ContentType: "application/gzip",
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
      restored.player_count === new Set(rows.map((row) => row.player_id)).size;

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
