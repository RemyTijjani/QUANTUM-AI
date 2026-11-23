import { createClient } from "npm:@supabase/supabase-js@2";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "npm:@aws-sdk/client-s3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

type LedgerRow = {
  id: string;
  player_id: string;
  transaction_type: string;
  amount: number | string;
  balance_after: number | string;
  description: string | null;
  created_at: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function getR2Endpoint(): string {
  const configured = R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const url = new URL(configured);
  if (url.pathname.replace(/\/$/, "") === `/${R2_BUCKET_NAME}`) url.pathname = "";
  return url.toString().replace(/\/$/, "");
}

async function bodyToBytes(body: unknown): Promise<Uint8Array> {
  if (!body || typeof body !== "object" || !("transformToByteArray" in body)) {
    throw new Error("R2 returned an unreadable archive object.");
  }
  const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
  return new Uint8Array(bytes);
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const safeBytes = new Uint8Array(bytes);
  const stream = new Blob([safeBytes.buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const safeBytes = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", safeBytes.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toTransaction(row: LedgerRow) {
  return {
    id: row.id,
    transactionType: row.transaction_type,
    amount: Number(row.amount),
    balanceAfter: Number(row.balance_after),
    description: row.description,
    createdAt: row.created_at,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Method not allowed." }, 405);

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY || !R2_ACCOUNT_ID ||
      !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME || !R2_ENDPOINT) {
    console.error("Player history service configuration is incomplete.");
    return json({ error: "History service is temporarily unavailable." }, 503);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return json({ error: "Sign in to view your ZP history." }, 401);

  try {
    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(tokenMatch[1]);
    if (authError || !authData.user) {
      return json({ error: "Your session is invalid or expired. Reopen the Mini App." }, 401);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: player, error: playerError } = await admin
      .from("players").select("id").eq("id", authData.user.id).maybeSingle();
    if (playerError || !player) return json({ error: "Player profile was not found." }, 403);

    const { data: liveRows, error: liveError } = await admin
      .from("economy_ledger")
      .select("id, player_id, transaction_type, amount, balance_after, description, created_at")
      .eq("player_id", player.id)
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(50);
    if (liveError) {
      console.error("Live player history lookup failed:", liveError);
      return json({ error: "Could not load your ZP history." }, 500);
    }

    const s3 = new S3Client({
      region: "auto",
      endpoint: getR2Endpoint(),
      responseChecksumValidation: "WHEN_REQUIRED",
      requestChecksumCalculation: "WHEN_REQUIRED",
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    });

    const rowsById = new Map<string, LedgerRow>();
    for (const row of (liveRows ?? []) as LedgerRow[]) rowsById.set(row.id, row);

    let continuationToken: string | undefined;
    let scannedObjects = 0;
    const prefix = "history/economy-ledger/";

    do {
      const page = await s3.send(new ListObjectsV2Command({
        Bucket: R2_BUCKET_NAME,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }));

      for (const object of page.Contents ?? []) {
        if (!object.Key || !object.Key.endsWith(".json.gz")) continue;
        scannedObjects += 1;
        if (scannedObjects > 5000) {
          throw new Error("Archive contains more objects than the safe readback limit.");
        }
        const archived = await s3.send(new GetObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: object.Key,
        }));
        const compressed = await bodyToBytes(archived.Body);
        const plain = await gunzip(compressed);
        const checksum = await sha256Hex(plain);
        const expectedChecksum = archived.Metadata?.sha256;
        const document = JSON.parse(new TextDecoder().decode(plain)) as {
          archive_type?: string;
          row_count?: number;
          records?: LedgerRow[];
        };
        if (
          document.archive_type !== "zord.zp_economy_ledger" ||
          !Array.isArray(document.records) ||
          document.row_count !== document.records.length ||
          Number(archived.Metadata?.["row-count"]) !== document.records.length ||
          !expectedChecksum ||
          checksum !== expectedChecksum
        ) {
          throw new Error(`ZP history archive integrity verification failed: ${object.Key}`);
        }
        for (const row of document.records) {
          if (row && row.player_id === player.id && typeof row.id === "string") {
            rowsById.set(row.id, row);
          }
        }
      }

      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      if (page.IsTruncated && !continuationToken) {
        throw new Error("R2 archive listing returned an incomplete continuation cursor.");
      }
    } while (continuationToken);

    const transactions = Array.from(rowsById.values())
      .filter((row) => row.player_id === player.id)
      .map(toTransaction)
      .sort((a, b) => {
        const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
        const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
        return bTime - aTime || b.id.localeCompare(a.id);
      });

    return json({
      success: true,
      transactions,
      count: transactions.length,
      archivedObjectsScanned: scannedObjects,
      source: "r2_archive_and_live_ledger",
    });
  } catch (error) {
    console.error("Player ZP history readback failed:", error);
    return json({ error: "Could not retrieve your complete ZP history. Please try again." }, 502);
  }
});
