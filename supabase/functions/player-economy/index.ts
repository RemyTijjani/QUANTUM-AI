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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed." }, 405);
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

    if (req.method === "POST") {
      let body: { action?: string; idempotencyKey?: string };
      try { body = await req.json(); } catch { return json({ error: "Invalid request body." }, 400); }
      if (body.action !== "claim_referral_kickbacks") return json({ error: "Unknown player economy action." }, 400);
      const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
        return json({ error: "A valid claim request ID is required." }, 400);
      }
      const { data, error } = await admin.rpc("claim_player_referral_kickbacks", {
        p_player_id: player.id, p_idempotency_key: idempotencyKey,
      });
      if (error) {
        console.error("Referral kickback claim failed:", error);
        return json({ error: "Could not claim referral kickbacks." }, 409);
      }
      return json(data);
    }

    // Settle trusted agent-rental mining accrual through the current time.
    // The database routine is idempotent and stops each rental at its exact expiry.
    const { data: agentRentalAccrual, error: agentRentalAccrualError } = await admin.rpc(
      "accrue_agent_rental_zp",
      { p_player_id: player.id },
    );
    if (agentRentalAccrualError || !agentRentalAccrual?.success) {
      console.error("Agent rental ZP accrual failed:", agentRentalAccrualError);
      return json({ error: "Could not refresh your verified ZP balance." }, 500);
    }

    const { data: activeRentalRows, error: activeRentalError } = await admin
      .from("player_agent_rentals")
      .select("agent_type, starts_at, expires_at")
      .eq("player_id", player.id)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: true });
    if (activeRentalError) {
      console.error("Active agent rental lookup failed:", activeRentalError);
      return json({ error: "Could not load your active mining rentals." }, 500);
    }

    const activeAgentRentals = (activeRentalRows ?? []).map((rental) => ({
      agentType: rental.agent_type,
      startsAt: rental.starts_at,
      expiresAt: rental.expires_at,
      ratePerSecond: rental.agent_type === "alpha_miner" ? 0.1 : 0.3,
    }));

    // Release any Fragment mining rewards whose six-hour hold has elapsed.
    // The database routine is idempotent and records each credit in the verified ledger.
    const { error: fragmentReleaseError } = await admin.rpc("release_matured_fragment_zp", {
      p_player_id: player.id,
    });
    if (fragmentReleaseError) {
      console.error("Matured Fragment mining reward release failed:", fragmentReleaseError);
      return json({ error: "Could not refresh your verified ZP balance." }, 500);
    }

    const { data: pendingFragmentRows, error: pendingFragmentError } = await admin
      .from("fragment_mining_rewards")
      .select("amount, release_at")
      .eq("player_id", player.id)
      .is("credited_at", null)
      .order("release_at", { ascending: true });
    if (pendingFragmentError) {
      console.error("Pending Fragment mining reward lookup failed:", pendingFragmentError);
      return json({ error: "Could not load pending Fragment mining rewards." }, 500);
    }

    const pendingFragmentZp = (pendingFragmentRows ?? []).reduce(
      (total, row) => total + Number(row.amount),
      0,
    );
    const nextFragmentReleaseAt = pendingFragmentRows?.[0]?.release_at ?? null;

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

    const { data: referralKickbacks, error: referralKickbacksError } = await admin.rpc(
      "get_player_referral_kickbacks", { p_player_id: player.id },
    );
    if (referralKickbacksError) {
      console.error("Referral kickback summary lookup failed:", referralKickbacksError);
      return json({ error: "Could not load your referral kickbacks." }, 500);
    }

    return json({
      success: true,
      referralKickbacks,
      verifiedZpBalance: Number(economy?.zp_balance ?? 0),
      verifiedLifetimeZp: Number(economy?.lifetime_zp ?? 0),
      pendingKickback: Number(economy?.pending_kickback ?? 0),
      pendingFragmentZp,
      nextFragmentReleaseAt,
      activeAgentRentals,
      agentRentalAccrual,
      updatedAt: economy?.updated_at ?? null,
      transactions,
      source: "server_player_economy",
    });
  } catch (error) {
    console.error("Player economy request failed:", error);
    return json({ error: "Could not load your verified ZP balance." }, 500);
  }
});
