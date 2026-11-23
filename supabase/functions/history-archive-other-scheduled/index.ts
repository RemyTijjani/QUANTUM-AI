import { createClient } from "npm:@supabase/supabase-js@2";
import { GetObjectCommand, PutObjectCommand, S3Client } from "npm:@aws-sdk/client-s3";

const env=(k:string)=>Deno.env.get(k)??"";
const SUPABASE_URL=env("SUPABASE_URL"), SERVICE_KEY=env("SUPABASE_SERVICE_ROLE_KEY");
const ACCOUNT=env("R2_ACCOUNT_ID"), ACCESS=env("R2_ACCESS_KEY_ID"), SECRET=env("R2_SECRET_ACCESS_KEY");
const BUCKET=env("R2_BUCKET_NAME"), ENDPOINT=env("R2_ENDPOINT");
const TABLES=["fragment_mining_accruals","creator_ops_submissions","x_follow_submissions","expedition_audit_log","game_event_participation_audit","raffle_audit_log","raffle_winners","daily_uplink_claims","share_uplink_mission_claims","telegram_mission_claims","agent_rental_zp_accruals"];
const BATCH=200, PREFIX="history/other/";

function response(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});}
function safeEqual(a:string,b:string){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
async function sha(bytes:Uint8Array){const b=new Uint8Array(bytes);const d=await crypto.subtle.digest("SHA-256",b.buffer);return Array.from(new Uint8Array(d),x=>x.toString(16).padStart(2,"0")).join("");}
async function transform(bytes:Uint8Array,decompress=false){const b=new Uint8Array(bytes);const stream=new Blob([b.buffer]).stream().pipeThrough(decompress?new DecompressionStream("gzip"):new CompressionStream("gzip"));return new Uint8Array(await new Response(stream).arrayBuffer());}
async function readBody(body:unknown){if(!body||typeof body!=="object"||!("transformToByteArray"in body))throw new Error("R2 response body unavailable");return new Uint8Array(await (body as {transformToByteArray:()=>Promise<Uint8Array>}).transformToByteArray());}
function s3(){const endpoint=new URL(ENDPOINT);if(endpoint.pathname.replace(/\/$/,"")===`/${BUCKET}`)endpoint.pathname="";return new S3Client({region:"auto",endpoint:endpoint.toString().replace(/\/$/,""),responseChecksumValidation:"WHEN_REQUIRED",requestChecksumCalculation:"WHEN_REQUIRED",credentials:{accessKeyId:ACCESS,secretAccessKey:SECRET}});}
async function writeVerified(client:S3Client,table:string,rows:Array<{id:string;eligible_at:string;record:Record<string,unknown>}>) {
  const doc={schema_version:1,archive_type:`zord.history.${table}`,table_name:table,exported_at:new Date().toISOString(),row_count:rows.length,oldest_eligible_at:rows[0].eligible_at,newest_eligible_at:rows[rows.length-1].eligible_at,records:rows.map(x=>x.record)};
  const plain=new TextEncoder().encode(JSON.stringify(doc)), checksum=await sha(plain), compressed=await transform(plain);
  const key=`${PREFIX}${table}/from=${rows[0].id}/to=${rows[rows.length-1].id}.json.gz`;
  await client.send(new PutObjectCommand({Bucket:BUCKET,Key:key,Body:compressed,ContentType:"application/gzip",Metadata:{"schema-version":"1","archive-type":doc.archive_type,"row-count":String(rows.length),sha256:checksum}}));
  const stored=await client.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));
  const restored=await transform(await readBody(stored.Body),true), parsed=JSON.parse(new TextDecoder().decode(restored));
  if(await sha(restored)!==checksum||parsed.archive_type!==doc.archive_type||!Array.isArray(parsed.records)||parsed.records.length!==rows.length||Number(stored.Metadata?.["row-count"])!==rows.length||stored.Metadata?.sha256!==checksum)throw new Error(`R2 readback verification failed for ${table}`);
  return {key,checksum,rowCount:rows.length};
}

Deno.serve(async req=>{
  if(req.method!=="POST")return response({error:"Method not allowed"},405);
  if(!SUPABASE_URL||!SERVICE_KEY||!ACCOUNT||!ACCESS||!SECRET||!BUCKET||!ENDPOINT)return response({error:"Archive worker configuration incomplete"},503);
  const token=req.headers.get("x-zord-archive-token")??"";
  if(token.length<32)return response({error:"Unauthorized"},401);
  const db=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:control,error:controlError}=await db.from("history_archive_control").select("cron_token_hash").eq("id",true).maybeSingle();
  if(controlError||!control||!safeEqual(await sha(new TextEncoder().encode(token)),control.cron_token_hash??""))return response({error:"Unauthorized"},401);
  const client=s3(), results=[];
  for(const table of TABLES){
    const {data:state,error:stateError}=await db.from("history_archive_other_control").select("after_eligible_at,after_id").eq("table_name",table).maybeSingle();
    if(stateError||!state)return response({error:`Archive cursor unavailable for ${table}`},503);
    const {data:rows,error:batchError}=await db.rpc("history_archive_other_batch",{p_table_name:table,p_after_eligible_at:state.after_eligible_at,p_after_id:state.after_id,p_batch_size:BATCH});
    if(batchError){console.error("Archive batch query failed",table,batchError);return response({error:`Could not load ${table} history`},500);}
    if(!rows?.length){results.push({table,archived:0});continue;}
    try{
      const saved=await writeVerified(client,table,rows);
      const last=rows[rows.length-1];
      const {error:updateError}=await db.from("history_archive_other_control").update({after_eligible_at:last.eligible_at,after_id:last.id,last_archived_at:new Date().toISOString(),last_batch_count:rows.length}).eq("table_name",table);
      if(updateError)throw new Error(`R2 verified but cursor update failed for ${table}; retry will safely overwrite the same object.`);
      results.push({table,archived:saved.rowCount,verified:true,objectKey:saved.key,sha256:saved.checksum});
    }catch(error){console.error("History archive write failed",table,error);return response({error:`Archive failed for ${table}; it will retry safely.`,completed:results},500);}
  }
  return response({success:true,copyOnly:true,results,note:"Only matured, credited or finalized history is copied. Source rows remain in Supabase."});
});
