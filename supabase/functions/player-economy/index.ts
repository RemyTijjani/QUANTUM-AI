import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    console.error("Player economy service configuration is incomplete.");
    return json({ error: "Player economy service is not configured." }, 500);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return json({ error: "Sign in to view your verified ZP balance." }, 401);

  try {
    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(tokenMatch[1]);
    if (authError || !authData.user) return json({ error: "Your session is invalid or expired. Reopen the Mini App." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: player, error: playerError } = await admin
      .from("players").select("id").eq("id", authData.user.id).maybeSingle();
    if (playerError || !player) return json({ error: "Player profile was not found." }, 403);

    const { data: economy, error: economyError } = await admin
      .from("player_economy")
      .select("zp_balance, lifetime_zp, pending_kickback, updated_at")
      .eq("player_id", player.id)
      .maybeSingle();
    if (economyError) {
      console.error("Verified player economy lookup failed:", economyError);
      return json({ error: "Could not load your verified ZP balance." }, 500);
    }

    const { data: ledgerRows, error: ledgerError } = await admin
      .from("economy_ledger")
      .select("id, transaction_type, amount, balance_after, description, created_at")
      .eq("player_id", player.id)
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(50);
    if (ledgerError) {
      console.error("Verified player ledger lookup failed:", ledgerError);
      return json({ error: "Could not load your verified transaction history." }, 500);
    }

    const transactions = (ledgerRows ?? []).map((row) => ({
      id: row.id,
      transactionType: row.transaction_type,
      amount: Number(row.amount),
      balanceAfter: Number(row.balance_after),
      description: row.description,
      createdAt: row.created_at,
    }));

    return json({
      success: true,
      verifiedZpBalance: Number(economy?.zp_balance ?? 0),
      verifiedLifetimeZp: Number(economy?.lifetime_zp ?? 0),
      pendingKickback: Number(economy?.pending_kickback ?? 0),
      updatedAt: economy?.updated_at ?? null,
      transactions,
      source: "server_player_economy",
    });
  } catch (error) {
    console.error("Player economy request failed:", error);
    return json({ error: "Could not load your verified ZP balance." }, 500);
  }
});
