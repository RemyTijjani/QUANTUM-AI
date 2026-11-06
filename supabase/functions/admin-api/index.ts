import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ADMIN_USERNAME = "Remytijjani";
const ADMIN_PASSWORD = "Remytijjani656";

interface AdminRequestBody {
  action: "review_submission" | "fetch_pending" | "fetch_stats";
  adminUsername?: string;
  adminPassword?: string;
  submissionId?: string;
  decision?: "approved" | "rejected";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body: AdminRequestBody = await req.json();

    const isAdmin =
      body.adminUsername === ADMIN_USERNAME && body.adminPassword === ADMIN_PASSWORD;

    const serviceRole = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    if (body.action === "fetch_pending") {
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data, error } = await serviceRole
        .from("creator_ops_submissions")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: true });

      if (error) {
        return new Response(JSON.stringify({ error: "Failed to fetch submissions" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ submissions: data }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "review_submission") {
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!body.submissionId || !body.decision) {
        return new Response(JSON.stringify({ error: "submissionId and decision required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (body.decision !== "approved" && body.decision !== "rejected") {
        return new Response(JSON.stringify({ error: "Invalid decision" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data, error } = await serviceRole
        .from("creator_ops_submissions")
        .update({ status: body.decision, reviewed_at: new Date().toISOString() })
        .eq("id", body.submissionId)
        .select("reward_zp, player_id, player_referral_code")
        .single();

      if (error || !data) {
        return new Response(JSON.stringify({ error: "Failed to update submission" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          rewardZp: data.reward_zp,
          playerId: data.player_id,
          playerReferralCode: data.player_referral_code,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (body.action === "fetch_stats") {
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const [playersRes, subsRes, pendingRes, approvedRes] = await Promise.all([
        serviceRole.from("players").select("id", { count: "exact", head: true }),
        serviceRole.from("creator_ops_submissions").select("id", { count: "exact", head: true }),
        serviceRole
          .from("creator_ops_submissions")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
        serviceRole
          .from("creator_ops_submissions")
          .select("id", { count: "exact", head: true })
          .eq("status", "approved"),
      ]);

      return new Response(
        JSON.stringify({
          totalPlayers: playersRes.count ?? 0,
          totalSubmissions: subsRes.count ?? 0,
          pendingSubmissions: pendingRes.count ?? 0,
          approvedSubmissions: approvedRes.count ?? 0,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Request failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
