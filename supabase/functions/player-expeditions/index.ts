import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed. Use GET or POST." }, 405);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    console.error("Player Expeditions service configuration is incomplete.");
    return json({ error: "Player Expeditions service is not configured." }, 500);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return json({ error: "Sign in to access Expeditions." }, 401);

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
      .from("players")
      .select("id")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (playerError || !player) return json({ error: "Player profile was not found." }, 403);

    if (req.method === "GET") {
      const { data: expeditions, error: expeditionError } = await admin
        .from("expeditions")
        .select("id, slug, title, description, cover_image_url, category, access_mode, prerequisite_expedition_id, participation_mode, status, starts_at, ends_at, timezone, min_team_size, max_team_size, min_individual_contributions, require_shared_team_objectives, created_at")
        .in("status", ["scheduled", "registration_open", "active"])
        .order("starts_at", { ascending: true, nullsFirst: false })
        .limit(100);
      if (expeditionError) {
        console.error("Player Expedition list failed:", expeditionError);
        return json({ error: "Could not load Expeditions." }, 500);
      }

      const ids = (expeditions ?? []).map((item) => item.id);
      if (ids.length === 0) return json({ expeditions: [] });

      const [objectivesRes, rewardsRes, participationRes] = await Promise.all([
        admin.from("expedition_objectives")
          .select("id, expedition_id, objective_type, title, description, instructions, is_required, sort_order")
          .in("expedition_id", ids)
          .order("sort_order", { ascending: true }),
        admin.from("expedition_rewards")
          .select("expedition_id, reward_type, amount, recipient_scope")
          .in("expedition_id", ids),
        admin.from("expedition_participations")
          .select("expedition_id, status, team_id, individual_contribution_count, reward_eligible, registered_at, completed_at")
          .eq("player_id", player.id)
          .in("expedition_id", ids),
      ]);
      const failed = [objectivesRes, rewardsRes, participationRes].find((result) => result.error);
      if (failed) {
        console.error("Player Expedition details lookup failed:", failed.error);
        return json({ error: "Could not load Expedition details." }, 500);
      }

      const objectivesById = new Map<string, Array<Record<string, unknown>>>();
      for (const objective of objectivesRes.data ?? []) {
        const list = objectivesById.get(objective.expedition_id) ?? [];
        list.push({
          id: objective.id,
          type: objective.objective_type,
          title: objective.title,
          description: objective.description,
          instructions: objective.instructions,
          required: objective.is_required,
          order: objective.sort_order,
        });
        objectivesById.set(objective.expedition_id, list);
      }
      const rewardById = new Map<string, { type: string; amount: number; recipientScope: string }>((rewardsRes.data ?? []).map((reward): [string, { type: string; amount: number; recipientScope: string }] => [reward.expedition_id, {
        type: reward.reward_type,
        amount: Number(reward.amount),
        recipientScope: reward.recipient_scope,
      }]));
      const participationById = new Map<string, { status: string; teamId: string | null; individualContributionCount: number; rewardEligible: boolean; registeredAt: string; completedAt: string | null }>((participationRes.data ?? []).map((item): [string, { status: string; teamId: string | null; individualContributionCount: number; rewardEligible: boolean; registeredAt: string; completedAt: string | null }] => [item.expedition_id, {
        status: item.status,
        teamId: item.team_id,
        individualContributionCount: item.individual_contribution_count,
        rewardEligible: item.reward_eligible,
        registeredAt: item.registered_at,
        completedAt: item.completed_at,
      }]));

      const prerequisiteIds = [...new Set((expeditions ?? [])
        .map((item) => item.prerequisite_expedition_id)
        .filter((id): id is string => !!id))];
      const completedPrerequisites = new Set<string>();
      if (prerequisiteIds.length > 0) {
        const { data: prerequisiteRows, error: prerequisiteError } = await admin
          .from("expedition_participations")
          .select("expedition_id")
          .eq("player_id", player.id)
          .in("expedition_id", prerequisiteIds)
          .in("status", ["completed", "eligible"]);
        if (prerequisiteError) {
          console.error("Expedition prerequisite lookup failed:", prerequisiteError);
          return json({ error: "Could not verify Expedition unlock requirements." }, 500);
        }
        for (const row of prerequisiteRows ?? []) completedPrerequisites.add(row.expedition_id);
      }

      const now = Date.now();
      const result = (expeditions ?? []).map((item) => {
        const alreadyJoined = participationById.get(item.id) ?? null;
        const prerequisiteMet = item.access_mode === "open" ||
          (!!item.prerequisite_expedition_id && completedPrerequisites.has(item.prerequisite_expedition_id));
        const notStarted = !!item.starts_at && new Date(item.starts_at).getTime() > now;
        const ended = !!item.ends_at && new Date(item.ends_at).getTime() <= now;
        return {
          ...item,
          objectives: objectivesById.get(item.id) ?? [],
          reward: rewardById.get(item.id) ?? { type: "none", amount: 0, recipientScope: "each_eligible_participant" },
          myParticipation: alreadyJoined,
          isUnlocked: prerequisiteMet,
          lockedReason: prerequisiteMet ? null : "Complete the prerequisite Expedition first.",
          canJoinSolo: prerequisiteMet && !alreadyJoined && !notStarted && !ended &&
            (item.status === "registration_open" || (item.status === "scheduled" && !notStarted)) &&
            (item.participation_mode === "solo" || item.participation_mode === "both"),
          registrationOpensAt: notStarted ? item.starts_at : null,
        };
      });
      return json({ expeditions: result });
    }

    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (contentLength > 8192) return json({ error: "Request body is too large." }, 413);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: "A valid JSON request body is required." }, 400);
    }
    if (!isObject(body) || body.action !== "join" || typeof body.expeditionId !== "string" || !UUID_RE.test(body.expeditionId)) {
      return json({ error: "A valid Expedition ID and join action are required." }, 400);
    }

    const { data: expedition, error: expeditionError } = await admin
      .from("expeditions")
      .select("id, title, access_mode, prerequisite_expedition_id, participation_mode, status, starts_at, ends_at")
      .eq("id", body.expeditionId)
      .maybeSingle();
    if (expeditionError) {
      console.error("Expedition registration lookup failed:", expeditionError);
      return json({ error: "Could not verify this Expedition." }, 500);
    }
    if (!expedition || !["scheduled", "registration_open"].includes(expedition.status)) {
      return json({ error: "This Expedition is not accepting registrations." }, 409);
    }
    if (expedition.participation_mode === "team") {
      return json({ error: "This Expedition requires a team. Team registration is being added next." }, 409);
    }
    if (expedition.participation_mode !== "solo" && expedition.participation_mode !== "both") {
      return json({ error: "This Expedition does not support solo registration." }, 409);
    }

    const now = Date.now();
    if (expedition.starts_at && new Date(expedition.starts_at).getTime() > now) {
      return json({ error: "Registration has not opened yet.", opensAt: expedition.starts_at }, 409);
    }
    if (expedition.ends_at && new Date(expedition.ends_at).getTime() <= now) {
      return json({ error: "Registration for this Expedition has closed." }, 409);
    }

    if (expedition.access_mode === "progressive") {
      if (!expedition.prerequisite_expedition_id) {
        return json({ error: "This progressive Expedition has no configured prerequisite. Please contact an administrator." }, 409);
      }
      const { data: prerequisite, error: prerequisiteError } = await admin
        .from("expedition_participations")
        .select("id")
        .eq("expedition_id", expedition.prerequisite_expedition_id)
        .eq("player_id", player.id)
        .in("status", ["completed", "eligible"])
        .maybeSingle();
      if (prerequisiteError) {
        console.error("Expedition prerequisite verification failed:", prerequisiteError);
        return json({ error: "Could not verify the prerequisite Expedition." }, 500);
      }
      if (!prerequisite) return json({ error: "Complete the prerequisite Expedition before joining this one." }, 403);
    }

    const { data: existing, error: existingError } = await admin
      .from("expedition_participations")
      .select("id, expedition_id, status, team_id, individual_contribution_count, reward_eligible, registered_at")
      .eq("expedition_id", expedition.id)
      .eq("player_id", player.id)
      .maybeSingle();
    if (existingError) {
      console.error("Existing Expedition registration lookup failed:", existingError);
      return json({ error: "Could not verify your registration." }, 500);
    }
    if (existing) return json({ success: true, alreadyJoined: true, participation: existing });

    const { data: participation, error: registrationError } = await admin
      .from("expedition_participations")
      .insert({ expedition_id: expedition.id, player_id: player.id, status: "registered" })
      .select("id, expedition_id, status, team_id, individual_contribution_count, reward_eligible, registered_at")
      .single();

    if (registrationError) {
      if (registrationError.code === "23505") {
        const { data: racedRegistration } = await admin
          .from("expedition_participations")
          .select("id, expedition_id, status, team_id, individual_contribution_count, reward_eligible, registered_at")
          .eq("expedition_id", expedition.id)
          .eq("player_id", player.id)
          .maybeSingle();
        if (racedRegistration) return json({ success: true, alreadyJoined: true, participation: racedRegistration });
      }
      console.error("Expedition registration insert failed:", registrationError);
      return json({ error: "Could not register for this Expedition. Please try again." }, 500);
    }

    const { error: auditError } = await admin.from("expedition_audit_log").insert({
      expedition_id: expedition.id,
      actor: player.id,
      action: "player_registered",
      after_state: { participation_id: participation.id, status: participation.status },
    });
    if (auditError) console.error("Expedition registration audit write failed:", auditError);

    return json({ success: true, alreadyJoined: false, participation }, 201);
  } catch (error) {
    console.error("Player Expedition request failed:", error);
    return json({ error: "The Expedition request could not be completed." }, 500);
  }
});
