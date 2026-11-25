import { createClient } from "npm:@supabase/supabase-js@2";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "npm:@aws-sdk/client-s3";

const env = (key: string) => Deno.env.get(key) ?? "";
const SUPABASE_URL = env("SUPABASE_URL"), SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const ACCOUNT = env("R2_ACCOUNT_ID"), ACCESS = env("R2_ACCESS_KEY_ID"), SECRET = env("R2_SECRET_ACCESS_KEY");
const BUCKET = env("R2_BUCKET_NAME"), ENDPOINT = env("R2_ENDPOINT");
const RETENTION_DAYS = 90, MAX_DELETE_OBJECTS = 10, BACKFILL_PAGE_SIZE = 100, INDEX_CONCURRENCY = 10;

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function sha256(bytes: Uint8Array) {
  const safe = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", safe.buffer);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
async function gunzip(bytes: Uint8Array) {
  const safe = new Uint8Array(bytes);
  const stream = new Blob([safe.buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function bodyBytes(body: unknown) {
  if (!body || typeof body !== "object" || !("transformToByteArray" in body)) throw new Error("Unreadable R2 object body.");
  return new Uint8Array(await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray());
}
function s3Client() {
  const endpoint = new URL(ENDPOINT);
  if (endpoint.pathname.replace(/\/$/, "") === `/${BUCKET}`) endpoint.pathname = "";
  return new S3Client({
    region: "auto", endpoint: endpoint.toString().replace(/\/$/, ""),
    responseChecksumValidation: "WHEN_REQUIRED", requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: { accessKeyId: ACCESS, secretAccessKey: SECRET },
  });
}

async function readVerified(client: S3Client, key: string, expectedType: string, expectedCount?: number, expectedHash?: string) {
  const stored = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const plain = await gunzip(await bodyBytes(stored.Body));
  const checksum = await sha256(plain);
  const document = JSON.parse(new TextDecoder().decode(plain)) as {
    archive_type?: string; row_count?: number; records?: Record<string, unknown>[];
  };
  if (
    document.archive_type !== expectedType || !Array.isArray(document.records) ||
    document.row_count !== document.records.length ||
    Number(stored.Metadata?.["row-count"]) !== document.records.length ||
    !stored.Metadata?.sha256 || checksum !== stored.Metadata.sha256 ||
    (expectedCount !== undefined && expectedCount !== document.records.length) ||
    (expectedHash !== undefined && expectedHash !== checksum)
  ) throw new Error(`R2 archive integrity verification failed: ${key}`);
  return { records: document.records, checksum, rowCount: document.records.length };
}

async function indexPrefixPage(
  db: ReturnType<typeof createClient>, client: S3Client, prefix: string,
  table: string, archiveType: string, timeField: string, cursor: string | null,
) {
  const page = await client.send(new ListObjectsV2Command({
    Bucket: BUCKET, Prefix: prefix, ContinuationToken: cursor ?? undefined, MaxKeys: BACKFILL_PAGE_SIZE,
  }));
  const objects = (page.Contents ?? []).filter(object => object.Key?.endsWith(".json.gz"));
  for (let offset = 0; offset < objects.length; offset += INDEX_CONCURRENCY) {
    const batch = objects.slice(offset, offset + INDEX_CONCURRENCY);
    await Promise.all(batch.map(async object => {
      if (!object.Key) return;
      const verified = await readVerified(client, object.Key, archiveType);
      const times = verified.records.map(row => row[timeField]).filter((value): value is string =>
        typeof value === "string" && Number.isFinite(Date.parse(value)));
      if (times.length !== verified.rowCount) throw new Error(`Archive has missing/invalid ${timeField}: ${object.Key}`);
      times.sort();
      const now = new Date().toISOString();
      const { error } = await db.from("history_archive_manifest").upsert({
        archive_key: object.Key, table_name: table, archive_type: archiveType,
        sha256: verified.checksum, row_count: verified.rowCount,
        oldest_record_at: times[0], newest_record_at: times[times.length - 1],
        archived_at: now, verified_at: now,
      }, { onConflict: "archive_key" });
      if (error) throw new Error(`Could not index verified R2 object ${object.Key}`);
    }));
  }
  if (page.IsTruncated && !page.NextContinuationToken) throw new Error("R2 returned an incomplete backfill cursor.");
  return {
    scanned: objects.length,
    cursor: page.IsTruncated ? page.NextContinuationToken ?? null : null,
    complete: !page.IsTruncated,
  };
}

Deno.serve(async req => {
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY || !ACCOUNT || !ACCESS || !SECRET || !BUCKET || !ENDPOINT) {
    return reply({ error: "Archive pruning is not configured." }, 503);
  }
  const token = req.headers.get("x-zord-archive-token") ?? "";
  if (token.length < 32) return reply({ error: "Unauthorized." }, 401);
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: archiveControl, error: archiveControlError } = await db.from("history_archive_control")
    .select("cron_token_hash").eq("id", true).maybeSingle();
  if (archiveControlError || !archiveControl || !safeEqual(await sha256(new TextEncoder().encode(token)), archiveControl.cron_token_hash ?? "")) {
    return reply({ error: "Unauthorized." }, 401);
  }

  const lease = crypto.randomUUID(), now = new Date();
  const { data: control, error: claimError } = await db.from("history_archive_prune_control")
    .update({ lease_token: lease, lease_until: new Date(now.getTime() + 5 * 60_000).toISOString() })
    .eq("id", true).or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
    .select("*").maybeSingle();
  if (claimError) return reply({ error: "Could not claim prune lease." }, 503);
  if (!control) return reply({ success: true, skipped: true, reason: "another prune run holds the lease" });

  const release = async (result?: unknown) => {
    await db.from("history_archive_prune_control").update({
      lease_token: null, lease_until: null, last_run_at: new Date().toISOString(),
      ...(result === undefined ? {} : { last_result: result }),
    }).eq("id", true).eq("lease_token", lease);
  };

  try {
    const client = s3Client();
    if (!control.economy_backfill_complete) {
      const page = await indexPrefixPage(db, client, "history/economy-ledger/", "economy_ledger",
        "zord.zp_economy_ledger", "created_at", control.economy_backfill_cursor);
      const { error } = await db.from("history_archive_prune_control").update({
        economy_backfill_cursor: page.cursor, economy_backfill_complete: page.complete,
      }).eq("id", true).eq("lease_token", lease);
      if (error) throw new Error("Could not persist economy archive backfill cursor.");
      const result = { success: true, backfill: "economy_ledger", ...page, complete: page.complete };
      await release(result);
      return reply(result);
    }

    if (!control.fragment_backfill_complete) {
      const page = await indexPrefixPage(db, client, "history/other/fragment_mining_accruals/",
        "fragment_mining_accruals", "zord.history.fragment_mining_accruals", "credited_at",
        control.fragment_backfill_cursor);
      const completedAt = page.complete ? new Date().toISOString() : null;
      const { error } = await db.from("history_archive_prune_control").update({
        fragment_backfill_cursor: page.cursor, fragment_backfill_complete: page.complete,
        ...(completedAt ? { backfill_completed_at: completedAt } : {}),
      }).eq("id", true).eq("lease_token", lease);
      if (error) throw new Error("Could not persist fragment archive backfill cursor.");
      const result = { success: true, backfill: "fragment_mining_accruals", ...page, complete: page.complete };
      await release(result);
      return reply(result);
    }

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60_000).toISOString();
    const { data: manifests, error: manifestError } = await db.from("history_archive_manifest")
      .select("archive_key,table_name,archive_type,sha256,row_count")
      .in("table_name", ["economy_ledger", "fragment_mining_accruals"])
      .eq("deletion_status", "pending").lte("newest_record_at", cutoff)
      .order("newest_record_at", { ascending: true }).limit(MAX_DELETE_OBJECTS);
    if (manifestError) throw new Error("Could not load pending verified archive manifests.");

    const results: Array<Record<string, unknown>> = [];
    for (const manifest of manifests ?? []) {
      try {
        const verified = await readVerified(client, manifest.archive_key, manifest.archive_type, manifest.row_count, manifest.sha256);
        const { data: deletion, error: deleteError } = await db.rpc("history_archive_delete_verified_batch", {
          p_table_name: manifest.table_name, p_records: verified.records, p_cutoff: cutoff,
        });
        if (deleteError || !deletion) throw new Error("Verified archive deletion RPC failed.");
        const complete = Number(deletion.deleted ?? 0) + Number(deletion.already_absent ?? 0) === verified.rowCount &&
          Number(deletion.changed_or_not_matching ?? 0) === 0 &&
          Number(deletion.blocked_by_foreign_key ?? 0) === 0;
        const status = complete ? "completed" : "blocked";
        const { error: updateError } = await db.from("history_archive_manifest").update({
          deletion_status: status, deleted_rows: Number(deletion.deleted ?? 0),
          last_delete_checked_at: new Date().toISOString(),
          last_error: complete ? null : "Some source rows changed, were missing from the exact archive match, or are protected by a foreign key. Remaining rows were preserved.",
        }).eq("archive_key", manifest.archive_key);
        if (updateError) throw new Error("Could not update archive manifest deletion status.");
        results.push({ key: manifest.archive_key, table: manifest.table_name, ...deletion, status });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown archive pruning error";
        await db.from("history_archive_manifest").update({
          deletion_status: "blocked", last_delete_checked_at: new Date().toISOString(), last_error: message.slice(0, 500),
        }).eq("archive_key", manifest.archive_key);
        results.push({ key: manifest.archive_key, status: "blocked", error: message });
      }
    }
    const result = { success: true, retentionDays: RETENTION_DAYS, cutoff, manifestsChecked: results.length, results };
    await release(result);
    return reply(result);
  } catch (error) {
    await release({ success: false, error: error instanceof Error ? error.message : "Unknown error" });
    console.error("R2 history pruning failed:", error);
    return reply({ error: "Archive pruning failed safely; no unverified records were deleted." }, 500);
  }
});
