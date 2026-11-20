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
  if (!tokenMatch) return { error: json({ error: "Sign in to access raffles." }, 401) };

  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.getUser(tokenMatch[1]);
  if (error || !data.user) return { error: json({ error: "Your session is invalid or expired." }, 401) };

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: player, error: playerError } = await admin.from("players").select("id").eq("id", data.user.id).maybeSingle();
  if (playerError || !player) return { error: json({ error: "Player profile was not found." }, 403) };
  return { admin, player };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) return json({ error: "Raffle service is not configured." }, 500);

  try {
    const identity = await getPlayer(req);
    if ("error" in identity) return identity.error;
    const { admin, player } = identity;

    if (req.method === "GET") {
      const [{ data: raffles, error: raffleError }, { data: entries, error: entryError }] = await Promise.all([
        admin.from("raffles").select("id,title,description,reward_type,reward_code,prize_pool_amount,prize_currency,min_bet_zap,entry_mode,winner_count,winner_method,status,starts_at,ends_at,published_at").in("status", ["published", "closed"]).order("created_at", { ascending: false }),
        admin.from("raffle_entries").select("id,raffle_id,stake_zap,ticket_count,created_at").eq("player_id", player.id).order("created_at", { ascending: false }).limit(100),
      ]);
      if (raffleError || entryError) {
        console.error("Raffle list failed:", raffleError ?? entryError);
        return json({ error: "Could not load raffles." }, 500);
      }
      const entryRaffleIds = [...new Set((entries ?? []).map((entry) => entry.raffle_id))];
      let myRaffleHistory: Array<Record<string, unknown>> = [];
      if (entryRaffleIds.length > 0) {
        const [{ data: historyRaffles, error: historyError }, { data: myWinners, error: winnerError }] = await Promise.all([
          admin.from("raffles")
            .select("id,title,status,prize_pool_amount,prize_currency,closed_at,drawn_at")
            .in("id", entryRaffleIds),
          admin.from("raffle_winners")
            .select("id,raffle_id,prize_amount,prize_currency,reward_code,selection_method,selected_at,delivery_status")
            .eq("player_id", player.id)
            .in("raffle_id", entryRaffleIds),
        ]);
        if (historyError || winnerError) {
          console.error("Raffle history failed:", historyError ?? winnerError);
          return json({ error: "Could not load your raffle results." }, 500);
        }
        const winnersByRaffle = new Map((myWinners ?? []).map((winner) => [winner.raffle_id, winner]));
        myRaffleHistory = (historyRaffles ?? []).map((raffle) => ({
          ...raffle,
          myPrize: winnersByRaffle.get(raffle.id) ?? null,
        }));
      }
      return json({ success: true, raffles: raffles ?? [], myEntries: entries ?? [], myRaffleHistory });
    }

    let body: { action?: unknown; raffleId?: unknown; stakeZap?: unknown; idempotencyKey?: unknown };
    try { body = await req.json(); } catch { return json({ error: "A valid raffle request is required." }, 400); }
    if (body.action !== "enter") return json({ error: "Unsupported raffle action." }, 400);
    const raffleId = typeof body.raffleId === "string" ? body.raffleId : "";
    const stakeZap = typeof body.stakeZap === "string" ? body.stakeZap : typeof body.stakeZap === "number" ? String(body.stakeZap) : "";
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raffleId)) return json({ error: "A valid raffle is required." }, 400);
    if (!/^[0-9]+(?:\.[0-9]{1,8})?$/.test(stakeZap) || Number(stakeZap) <= 0) return json({ error: "Enter a valid positive ZAP stake (up to 8 decimal places)." }, 400);
    if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return json({ error: "A valid entry request key is required." }, 400);

    const { data: result, error } = await admin.rpc("enter_raffle", {
      p_player_id: player.id,
      p_raffle_id: raffleId,
      p_stake_zap: stakeZap,
      p_idempotency_key: idempotencyKey,
    });
    if (error || !result?.success) {
      const message = error?.message ?? "The raffle entry could not be completed.";
      const status = /insufficient/i.test(message) ? 409 : /minimum bet|ended|not open|not started/i.test(message) ? 409 : 400;
      return json({ error: message }, status);
    }
    return json({ success: true, entry: result });
  } catch (error) {
    console.error("Raffle request failed:", error);
    return json({ error: "Could not process your raffle request." }, 500);
  }
});