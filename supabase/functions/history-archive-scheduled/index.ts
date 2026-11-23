import { createClient } from "npm:@supabase/supabase-js@2";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "npm:@aws-sdk/client-s3";

const env = (name: string) => Deno.env.get(name) ?? "";
const URL = env("SUPABASE_URL"), KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const ACCOUNT = env("R2_ACCOUNT_ID"), ACCESS = env("R2_ACCESS_KEY_ID"), SECRET = env("R2_SECRET_ACCESS_KEY");
const BUCKET = env("R2_BUCKET_NAME"), ENDPOINT = env("R2_ENDPOINT");
const PREFIX = "history/economy-ledger/", LIMIT = 200, HOLD_HOURS = 6;

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function hash(bytes: Uint8Array) {
  const b = new Uint8Array(bytes);
  const out = await crypto.subtle.digest("SHA-256", b.buffer);
  return Array.from(new Uint8Array(out), x => x.toString(16).padStart(2, "0")).join("");
}
async function zip(bytes: Uint8Array, decompress = false) {
  const b = new Uint8Array(bytes);
  const stream = new Blob([b.buffer]).stream().pipeThrough(decompress ? new DecompressionStream("gzip") : new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function bodyBytes(body: unknown) {
  if (!body || typeof body !== "object" || !("transformToByteArray" in body)) throw new Error("Unreadable R2 object body.");
  return new Uint8Array(await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray());
}
function s3Client() {
  const endpoint = new URLCtor(ENDPOINT);
  if (endpoint.pathname.replace(/\/$/, "") === `/${BUCKET}`) endpoint.pathname = "";
  return new S3Client({ region: "auto", endpoint: endpoint.toString().replace(/\/$/, ""), responseChecksumValidation: "WHEN_REQUIRED", requestChecksumCalculation: "WHEN_REQUIRED", credentials: { accessKeyId: ACCESS, secretAccessKey: SECRET } });
}
const URLCtor = globalThis.URL;

async function findExistingHighWater(s3: S3Client) {
  let token: string | undefined, newest: { id: string; created_at: string } | null = null, scanned = 0;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token, MaxKeys: 1000 }));
    for (const obj of page.Contents ?? []) {
      if (!obj.Key?.endsWith(".json.gz")) continue;
      if (++scanned > 5000) throw new Error("Archive baseline scan reached 5,000 objects.");
      const stored = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
      const plain = await zip(await bodyBytes(stored.Body), true);
      const checksum = await hash(plain), doc = JSON.parse(new TextDecoder().decode(plain));
      if (doc.archive_type !== "zord.zp_economy_ledger" || !Array.isArray(doc.records) || doc.row_count !== doc.records.length ||
          Number(stored.Metadata?.["row-count"]) !== doc.records.length || !stored.Metadata?.sha256 || checksum !== stored.Metadata.sha256) {
        throw new Error(`Existing archive integrity failure: ${obj.Key}`);
      }
      for (const row of doc.records) {
        if (!row?.id || !row?.created_at) continue;
        if (!newest || row.created_at > newest.created_at || (row.created_at === newest.created_at && row.id > newest.id)) newest = { id: row.id, created_at: row.created_at };
      }
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (page.IsTruncated && !token) throw new Error("Incomplete R2 listing cursor.");
  } while (token);
  return { newest, scanned };
}

async function upload(s3: S3Client, rows: Array<Record<string, unknown>>) {
  const doc = {
    schema_version: 1, archive_type: "zord.zp_economy_ledger", exported_at: new Date().toISOString(),
    player_count: new Set(rows.map(r => r.player_id)).size, row_count: rows.length,
    oldest_created_at: rows.reduce((v, r) => !v || String(r.created_at) < v ? String(r.created_at) : v, null as string | null),
    newest_created_at: rows.reduce((v, r) => !v || String(r.created_at) > v ? String(r.created_at) : v, null as string | null),
    records: rows,
  };
  const plain = new TextEncoder().encode(JSON.stringify(doc)), checksum = await hash(plain), compressed = await zip(plain);
  const key = `${PREFIX}auto/from=${rows[0].id}/to=${rows[rows.length - 1].id}.json.gz`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: compressed, ContentType: "application/gzip", Metadata: { "schema-version": "1", "row-count": String(rows.length), sha256: checksum, "archive-type": "zord.zp_economy_ledger" } }));
  const readback = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const restored = await zip(await bodyBytes(readback.Body), true), parsed = JSON.parse(new TextDecoder().decode(restored));
  if (await hash(restored) !== checksum || !Array.isArray(parsed.records) || parsed.records.length !== rows.length ||
      parsed.row_count !== rows.length || Number(readback.Metadata?.["row-count"]) !== rows.length || readback.Metadata?.sha256 !== checksum) {
    throw new Error(`R2 readback verification failed: ${key}`);
  }
  return { key, checksum, rowCount: rows.length, playerCount: doc.player_count };
}

Deno.serve(async req => {
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  if (!URL || !KEY || !ACCOUNT || !ACCESS || !SECRET || !BUCKET || !ENDPOINT) return reply({ error: "Archive worker is not configured." }, 503);
  const token = req.headers.get("x-zord-archive-token") ?? "";
  if (token.length < 32) return reply({ error: "Unauthorized." }, 401);
  const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: state, error: stateError } = await db.from("history_archive_control").select("*").eq("id", true).maybeSingle();
  if (stateError || !state) return reply({ error: "Archive state unavailable." }, 503);
  if (!equal(await hash(new TextEncoder().encode(token)), state.cron_token_hash ?? "")) return reply({ error: "Unauthorized." }, 401);

  const lease = crypto.randomUUID(), now = new Date();
  const { data: claimed, error: claimError } = await db.from("history_archive_control")
    .update({ lease_token: lease, lease_until: new Date(now.getTime() + 10 * 60_000).toISOString() })
    .eq("id", true).or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
    .select("*").maybeSingle();
  if (claimError) return reply({ error: "Could not claim archive lease." }, 503);
  if (!claimed) return reply({ success: true, skipped: true, reason: "another batch holds the lease" });

  const release = async () => { await db.from("history_archive_control").update({ lease_token: null, lease_until: null }).eq("id", true).eq("lease_token", lease); };
  try {
    const s3 = s3Client();
    let checkpoint = claimed.checkpoint_created_at && claimed.checkpoint_id ? { created_at: claimed.checkpoint_created_at, id: claimed.checkpoint_id } : null;
    let high = claimed.high_water_created_at && claimed.high_water_id ? { created_at: claimed.high_water_created_at, id: claimed.high_water_id } : null;
    let after = claimed.after_created_at && claimed.after_id ? { created_at: claimed.after_created_at, id: claimed.after_id } : null;
    let baselineObjectsScanned = 0;

    if (!checkpoint) {
      const baseline = await findExistingHighWater(s3);
      checkpoint = baseline.newest;
      baselineObjectsScanned = baseline.scanned;
      const { error } = await db.from("history_archive_control").update({ checkpoint_created_at: checkpoint?.created_at ?? null, checkpoint_id: checkpoint?.id ?? null }).eq("id", true).eq("lease_token", lease);
      if (error) throw new Error("Could not persist the verified archive baseline.");
    }

    if (!high) {
      const { data, error } = await db.rpc("history_archive_get_high_water", {
        p_checkpoint_created_at: checkpoint?.created_at ?? null, p_checkpoint_id: checkpoint?.id ?? null,
        p_cutoff: new Date(Date.now() - HOLD_HOURS * 3600_000).toISOString(),
      });
      if (error) throw new Error("Could not find eligible ledger entries.");
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.id) { await release(); return reply({ success: true, archived: 0, waitingForMaturity: true, baselineObjectsScanned }); }
      high = { id: row.id, created_at: row.created_at };
      const { error: saveError } = await db.from("history_archive_control").update({
        high_water_created_at: high.created_at, high_water_id: high.id, after_created_at: null, after_id: null,
      }).eq("id", true).eq("lease_token", lease);
      if (saveError) throw new Error("Could not save archive boundary.");
      after = null;
    }

    const { data: rows, error: batchError } = await db.rpc("history_archive_eligible_batch", {
      p_checkpoint_created_at: checkpoint?.created_at ?? null, p_checkpoint_id: checkpoint?.id ?? null,
      p_high_water_created_at: high.created_at, p_high_water_id: high.id,
      p_after_created_at: after?.created_at ?? null, p_after_id: after?.id ?? null, p_batch_size: LIMIT,
    });
    if (batchError) throw new Error("Could not read the next eligible batch.");

    if (!rows?.length) {
      const { error } = await db.from("history_archive_control").update({
        checkpoint_created_at: high.created_at, checkpoint_id: high.id,
        high_water_created_at: null, high_water_id: null, after_created_at: null, after_id: null,
        lease_token: null, lease_until: null, last_archived_at: new Date().toISOString(), last_batch_count: 0,
      }).eq("id", true).eq("lease_token", lease);
      if (error) throw new Error("Could not finalize archive window.");
      return reply({ success: true, archived: 0, verified: true, windowComplete: true, baselineObjectsScanned });
    }

    const result = await upload(s3, rows as Array<Record<string, unknown>>), last = rows[rows.length - 1];
    const next = rows.length < LIMIT
      ? { checkpoint_created_at: high.created_at, checkpoint_id: high.id, high_water_created_at: null, high_water_id: null, after_created_at: null, after_id: null }
      : { after_created_at: last.created_at, after_id: last.id };
    const { error: advanceError } = await db.from("history_archive_control")
      .update({ ...next, lease_token: null, lease_until: null, last_archived_at: new Date().toISOString(), last_batch_count: rows.length })
      .eq("id", true).eq("lease_token", lease);
    if (advanceError) throw new Error("R2 verified but cursor update failed; batch will safely retry.");
    return reply({ success: true, archived: result.rowCount, verified: true, objectKey: result.key, checksum: result.checksum, playerCount: result.playerCount, windowComplete: rows.length < LIMIT, baselineObjectsScanned, note: "Copy-only; Supabase originals remain unchanged." });
  } catch (error) {
    await release();
    console.error("Scheduled ZP archive failed:", error);
    return reply({ error: "Archive batch failed; it will retry safely." }, 500);
  }
});
