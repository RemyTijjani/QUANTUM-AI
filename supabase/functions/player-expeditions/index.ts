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
        .select("id, slug, title, description, cover_image_url, category, access_mode, prerequisite_expedition_id, participation_mode, status, starts_at, ends_at, registration_opens_at, registration_closes_at, timezone, min_team_size, max_team_size, min_individual_contributions, require_shared_team_objectives, created_at")
        .in("status", ["scheduled", "registration_open", "active", "completed", "cancelled"])
        .order("starts_at", { ascending: true, nullsFirst: false })
        .limit(100);
      if (expeditionError) {
        console.error("Player Expedition list failed:", expeditionError);
        return json({ error: "Could not load Expeditions." }, 500);
      }

      const ids = (expeditions ?? []).map((item) => item.id);
      if (ids.length === 0) return json({ expeditions: [], rewardHistory: [] });

      const [objectivesRes, rewardsRes, participationRes, individualProgressRes, rewardIssuancesRes] = await Promise.all([
        admin.from("expedition_objectives")
          .select("id, expedition_id, objective_type, title, description, instructions, is_required, completion_scope, sort_order")
          .in("expedition_id", ids)
          .order("sort_order", { ascending: true }),
        admin.from("expedition_rewards")
          .select("expedition_id, reward_type, amount, recipient_scope")
          .in("expedition_id", ids),
        admin.from("expedition_participations")
          .select("expedition_id, status, team_id, individual_contribution_count, reward_eligible, registered_at, completed_at")
          .eq("player_id", player.id)
          .in("expedition_id", ids),
        admin.from("expedition_objective_progress")
          .select("id, expedition_id, objective_id, status, evidence, updated_at")
          .eq("player_id", player.id)
          .in("expedition_id", ids),
        admin.from("expedition_reward_issuances")
          .select("expedition_id, reward_type, amount, status, issued_at")
          .eq("player_id", player.id)
          .in("expedition_id", ids),
      ]);
      const failed = [objectivesRes, rewardsRes, participationRes, individualProgressRes, rewardIssuancesRes].find((result) => result.error);
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
          completionScope: objective.completion_scope,
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

      const rewardIssuanceByExpedition = new Map((rewardIssuancesRes.data ?? []).map((row) => [row.expedition_id, {
        type: row.reward_type,
        amount: Number(row.amount),
        status: row.status,
        issuedAt: row.issued_at,
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

      const teamIds = [...new Set((participationRes.data ?? []).map((item) => item.team_id).filter((id): id is string => !!id))];
      const [teamsRes, membersRes, teamProgressRes] = teamIds.length > 0 ? await Promise.all([
        admin.from("expedition_teams").select("id, expedition_id, name, leader_player_id, status").in("id", teamIds),
        admin.from("expedition_team_members").select("team_id, player_id, role, membership_status, joined_at").in("team_id", teamIds).eq("membership_status", "active"),
        admin.from("expedition_team_objective_progress").select("id, expedition_id, objective_id, team_id, status, evidence, updated_at").in("team_id", teamIds),
      ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
      if (teamsRes.error || membersRes.error || teamProgressRes.error) {
        console.error("Expedition team details lookup failed:", teamsRes.error ?? membersRes.error ?? teamProgressRes.error);
        return json({ error: "Could not load your Expedition team details." }, 500);
      }
      const teamsById = new Map((teamsRes.data ?? []).map((team) => [team.id, team]));
      const membersByTeam = new Map<string, Array<Record<string, unknown>>>();
      for (const member of membersRes.data ?? []) {
        const list = membersByTeam.get(member.team_id) ?? [];
        list.push({ playerId: member.player_id, role: member.role, joinedAt: member.joined_at });
        membersByTeam.set(member.team_id, list);
      }

      const allProgress = [
        ...(individualProgressRes.data ?? []).map((row) => ({ ...row, scope: "individual" as const, team_id: null })),
        ...(teamProgressRes.data ?? []).map((row) => ({ ...row, scope: "team" as const })),
      ];
      const rejectedProgressIds = new Set(allProgress.filter((row) => row.status === "rejected").map((row) => row.id));
      const rejectionReasons = new Map<string, string>();
      if (rejectedProgressIds.size > 0) {
        const { data: rejectionRows, error: rejectionError } = await admin.from("expedition_audit_log")
          .select("reason, created_at, after_state")
          .in("expedition_id", ids)
          .in("action", ["objective_individual_rejected", "objective_team_rejected"])
          .order("created_at", { ascending: false }).limit(500);
        if (rejectionError) {
          console.error("Expedition rejection feedback lookup failed:", rejectionError);
          return json({ error: "Could not load objective review feedback." }, 500);
        }
        for (const row of rejectionRows ?? []) {
          const progressId = typeof row.after_state?.progress_id === "string" ? row.after_state.progress_id : "";
          if (progressId && rejectedProgressIds.has(progressId) && row.reason && !rejectionReasons.has(progressId)) {
            rejectionReasons.set(progressId, row.reason);
          }
        }
      }
      const progressByObjective = new Map<string, { individual?: Record<string, unknown>; team?: Record<string, unknown> }>();
      for (const row of allProgress) {
        const participation = participationById.get(row.expedition_id);
        if (!participation) continue;
        const key = row.expedition_id + ":" + row.objective_id;
        const current = progressByObjective.get(key) ?? {};
        const progress = { id: row.id, status: row.status, evidence: row.evidence, updated_at: row.updated_at, reviewReason: rejectionReasons.get(row.id) ?? null };
        if (row.scope === "individual") current.individual = progress;
        else if (row.team_id === participation.teamId) current.team = progress;
        progressByObjective.set(key, current);
      }

      const now = Date.now();
      const result = (expeditions ?? []).map((item) => {
        const alreadyJoined = participationById.get(item.id) ?? null;
        const prerequisiteMet = item.access_mode === "open" ||
          (!!item.prerequisite_expedition_id && completedPrerequisites.has(item.prerequisite_expedition_id));
        const notStarted = !item.starts_at || new Date(item.starts_at).getTime() > now;
        const ended = !!item.ends_at && new Date(item.ends_at).getTime() <= now;
        const registrationNotOpen = !!item.registration_opens_at && new Date(item.registration_opens_at).getTime() > now;
        const registrationClosed = !!item.registration_closes_at && new Date(item.registration_closes_at).getTime() <= now;
        const registrationOpen = (item.status === "registration_open" || item.status === "scheduled") &&
          !registrationNotOpen && !registrationClosed && notStarted && !ended;
        const myTeam = alreadyJoined?.teamId ? teamsById.get(alreadyJoined.teamId) ?? null : null;
        return {
          ...item,
          // A scheduled Expedition may accept registrations before its start time.
          // Expose the effective registration state so the player UI matches the
          // server-side join checks and does not hide an open registration window.
          status: item.status === "scheduled" && registrationOpen ? "registration_open" : item.status,
          objectives: (objectivesById.get(item.id) ?? []).map((objective) => ({
            ...objective,
            progress: progressByObjective.get(item.id + ":" + String(objective.id)) ?? { individual: null, team: null },
          })),
          reward: rewardById.get(item.id) ?? { type: "none", amount: 0, recipientScope: "each_eligible_participant" },
          myParticipation: alreadyJoined,
          myRewardIssuance: rewardIssuanceByExpedition.get(item.id) ?? null,
          isUnlocked: prerequisiteMet,
          lockedReason: prerequisiteMet ? null : "Complete the prerequisite Expedition first.",
          canJoinSolo: prerequisiteMet && !alreadyJoined && registrationOpen &&
            (item.participation_mode === "solo" || item.participation_mode === "both"),
          registrationOpensAt: item.registration_opens_at ?? item.starts_at,
          registrationClosesAt: item.registration_closes_at ?? item.starts_at,
          myTeam: myTeam ? { ...myTeam, members: membersByTeam.get(myTeam.id) ?? [] } : null,
        };
      });
      const cancelledIds = result.filter((item) => item.status === "cancelled").map((item) => item.id);
      const deletedAfterCompletion = new Set<string>();
      if (cancelledIds.length > 0) {
        const { data: deletionAudits, error: deletionAuditError } = await admin.from("expedition_audit_log")
          .select("expedition_id, before_state")
          .in("expedition_id", cancelledIds)
          .eq("action", "admin_deleted");
        if (deletionAuditError) {
          console.error("Expedition deletion history lookup failed:", deletionAuditError);
          return json({ error: "Could not load Expedition reward history." }, 500);
        }
        for (const audit of deletionAudits ?? []) {
          if (audit.before_state?.status === "completed") deletedAfterCompletion.add(audit.expedition_id);
        }
      }
      const rewardHistory = result
        .filter((item) => !!item.myParticipation && (
          item.status === "completed" ||
          (item.status !== "cancelled" && !!item.ends_at && new Date(item.ends_at).getTime() <= now) ||
          deletedAfterCompletion.has(item.id)
        ))
        .map((item) => ({ ...item, status: "completed" }));
      const activeExpeditions = result.filter((item) =>
        item.status !== "completed" &&
        item.status !== "cancelled" &&
        !(item.ends_at && new Date(item.ends_at).getTime() <= now)
      );
      return json({ expeditions: activeExpeditions, rewardHistory });
    }

    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (contentLength > 8192) return json({ error: "Request body is too large." }, 413);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: "A valid JSON request body is required." }, 400);
    }
    if (!isObject(body) || typeof body.action !== "string") {
      return json({ error: "A valid Expedition action is required." }, 400);
    }


    if (body.action === "submit_objective") {
      const expeditionId = typeof body.expeditionId === "string" ? body.expeditionId : "";
      const objectiveId = typeof body.objectiveId === "string" ? body.objectiveId : "";
      const scope = body.scope;
      const evidence = body.evidence;
      if (!UUID_RE.test(expeditionId) || !UUID_RE.test(objectiveId) ||
        (scope !== "individual" && scope !== "team") || !isObject(evidence) ||
        JSON.stringify(evidence).length > 4000) {
        return json({ error: "Provide valid Expedition and objective IDs, a valid scope, and evidence under 4,000 characters." }, 400);
      }

      const [{ data: objective, error: objectiveError }, { data: participation, error: participationError },
        { data: expedition, error: expeditionError }] = await Promise.all([
        admin.from("expedition_objectives")
          .select("id, expedition_id, completion_scope")
          .eq("id", objectiveId).eq("expedition_id", expeditionId).maybeSingle(),
        admin.from("expedition_participations")
          .select("id, team_id, status")
          .eq("expedition_id", expeditionId).eq("player_id", player.id).maybeSingle(),
        admin.from("expeditions").select("status").eq("id", expeditionId).maybeSingle(),
      ]);
      if (objectiveError || participationError || expeditionError) {
        console.error("Objective submission lookup failed:", objectiveError ?? participationError ?? expeditionError);
        return json({ error: "Could not verify this objective submission." }, 500);
      }
      if (!objective || !participation || participation.status === "withdrawn") {
        return json({ error: "Join this Expedition before submitting an objective." }, 403);
      }
      if (expedition?.status !== "active") return json({ error: "Objectives can only be submitted while the Expedition is active." }, 409);
      if (scope === "individual" && !["individual", "both"].includes(objective.completion_scope)) {
        return json({ error: "This objective is not configured for individual completion." }, 409);
      }
      if (scope === "team" && !["team", "both"].includes(objective.completion_scope)) {
        return json({ error: "This objective is not configured for team completion." }, 409);
      }

      if (scope === "individual") {
        const { data: existing, error: existingError } = await admin.from("expedition_objective_progress")
          .select("id, status").eq("objective_id", objectiveId).eq("player_id", player.id).maybeSingle();
        if (existingError) return json({ error: "Could not check existing objective progress." }, 500);
        if (existing?.status === "verified") return json({ error: "This objective has already been verified." }, 409);
        if (existing?.status === "submitted") {
          return json({ error: "Your evidence is already waiting for review. You can submit again after the operations team rejects it." }, 409);
        }
        const { data, error } = await admin.from("expedition_objective_progress").upsert({
          expedition_id: expeditionId, objective_id: objectiveId, player_id: player.id,
          team_id: participation.team_id, status: "submitted", contribution_count: 1, evidence,
          verified_by: null, verified_at: null, updated_at: new Date().toISOString(),
        }, { onConflict: "objective_id,player_id" }).select("id, status, created_at, updated_at").single();
        if (error || !data) {
          console.error("Individual objective submission failed:", error);
          return json({ error: "Could not submit this objective. Please try again." }, 500);
        }
        await admin.from("expedition_audit_log").insert({
          expedition_id: expeditionId, actor: "player:" + player.id, action: "objective_individual_submitted",
          after_state: { progress_id: data.id, objective_id: objectiveId },
        });
        return json({ success: true, scope, progress: data }, 201);
      }

      if (!participation.team_id) return json({ error: "Join an Expedition team before submitting shared progress." }, 403);
      const { data: membership, error: membershipError } = await admin.from("expedition_team_members")
        .select("id").eq("expedition_id", expeditionId).eq("team_id", participation.team_id)
        .eq("player_id", player.id).eq("membership_status", "active").maybeSingle();
      if (membershipError || !membership) return json({ error: "You are not an active member of this Expedition team." }, 403);
      const { data: existingTeamProgress, error: existingTeamError } = await admin.from("expedition_team_objective_progress")
        .select("id, status").eq("objective_id", objectiveId).eq("team_id", participation.team_id).maybeSingle();
      if (existingTeamError) return json({ error: "Could not check existing team objective progress." }, 500);
      if (existingTeamProgress?.status === "verified") return json({ error: "This team objective has already been verified." }, 409);
      if (existingTeamProgress?.status === "submitted") {
        return json({ error: "Your team evidence is already waiting for review. You can submit again after the operations team rejects it." }, 409);
      }
      const { data, error } = await admin.from("expedition_team_objective_progress").upsert({
        expedition_id: expeditionId, objective_id: objectiveId, team_id: participation.team_id,
        status: "submitted", contribution_count: 1, evidence, verified_by: null, verified_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "objective_id,team_id" }).select("id, status, created_at, updated_at").single();
      if (error || !data) {
        console.error("Team objective submission failed:", error);
        return json({ error: "Could not submit this team objective. Please try again." }, 500);
      }
      await admin.from("expedition_audit_log").insert({
        expedition_id: expeditionId, actor: "player:" + player.id, action: "objective_team_submitted",
        after_state: { progress_id: data.id, objective_id: objectiveId, team_id: participation.team_id },
      });
      return json({ success: true, scope, progress: data }, 201);
    }

    if (body.action === "create_team") {
      if (typeof body.expeditionId !== "string" || !UUID_RE.test(body.expeditionId) ||
        typeof body.teamName !== "string" || body.teamName.trim().length < 1 || body.teamName.trim().length > 80) {
        return json({ error: "Provide a valid Expedition ID and a team name between 1 and 80 characters." }, 400);
      }
      const inviteBytes = new Uint8Array(8);
      crypto.getRandomValues(inviteBytes);
      const inviteCode = Array.from(inviteBytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
      const { data, error } = await admin.rpc("create_expedition_team", {
        p_expedition_id: body.expeditionId,
        p_player_id: player.id,
        p_team_name: body.teamName.trim(),
        p_invite_code: inviteCode,
      });
      if (error) {
        const message = error.message ?? "";
        const status = /not found/i.test(message) ? 404 : /registration|already registered|already belongs|team|Expedition does not allow/i.test(message) ? 409 : 500;
        if (status === 500) console.error("Expedition team creation failed:", error);
        return json({ error: status === 500 ? "Could not create the team. Please try again." : message }, status);
      }
      return json({ success: true, team: data }, 201);
    }

    if (body.action === "join_team") {
      if (typeof body.inviteCode !== "string" || !/^[A-Fa-f0-9]{16}$/.test(body.inviteCode.trim())) {
        return json({ error: "Enter a valid 16-character team invitation code." }, 400);
      }
      const { data, error } = await admin.rpc("join_expedition_team", {
        p_invite_code: body.inviteCode.trim().toUpperCase(),
        p_player_id: player.id,
      });
      if (error) {
        const message = error.message ?? "";
        const status = /invalid or inactive/i.test(message) ? 404 : /registration|already|full|locked|allow|belongs/i.test(message) ? 409 : 500;
        if (status === 500) console.error("Expedition team join failed:", error);
        return json({ error: status === 500 ? "Could not join this team. Please try again." : message }, status);
      }
      return json({ success: true, team: data }, 200);
    }

    if (body.action === "leave_team") {
      if (typeof body.expeditionId !== "string" || !UUID_RE.test(body.expeditionId)) {
        return json({ error: "A valid Expedition ID is required." }, 400);
      }
      const { data, error } = await admin.rpc("leave_expedition_team", {
        p_expedition_id: body.expeditionId,
        p_player_id: player.id,
      });
      if (error) {
        const message = error.message ?? "";
        const status = /not found/i.test(message) ? 404 : /not active|locked|leader/i.test(message) ? 409 : 500;
        if (status === 500) console.error("Expedition team leave failed:", error);
        return json({ error: status === 500 ? "Could not leave this team. Please try again." : message }, status);
      }
      return json({ success: true, team: data }, 200);
    }

    if (body.action !== "join" || typeof body.expeditionId !== "string" || !UUID_RE.test(body.expeditionId)) {
      return json({ error: "A valid Expedition ID and supported action are required." }, 400);
    }

    const { data: expedition, error: expeditionError } = await admin
      .from("expeditions")
      .select("id, title, access_mode, prerequisite_expedition_id, participation_mode, status, starts_at, ends_at, registration_opens_at, registration_closes_at")
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
      return json({ error: "This Expedition requires a team. Create a team or join using an invitation code." }, 409);
    }
    if (expedition.participation_mode !== "solo" && expedition.participation_mode !== "both") {
      return json({ error: "This Expedition does not support solo registration." }, 409);
    }

    const now = Date.now();
    if (expedition.registration_opens_at && new Date(expedition.registration_opens_at).getTime() > now) {
      return json({ error: "Registration has not opened yet.", opensAt: expedition.registration_opens_at }, 409);
    }
    if (expedition.registration_closes_at && new Date(expedition.registration_closes_at).getTime() <= now) {
      return json({ error: "Registration has closed.", closesAt: expedition.registration_closes_at }, 409);
    }
    if (expedition.starts_at && new Date(expedition.starts_at).getTime() <= now) {
      return json({ error: "Registration has closed because the Expedition has started." }, 409);
    }
    if (expedition.ends_at && new Date(expedition.ends_at).getTime() <= now) {
      return json({ error: "This Expedition has ended." }, 409);
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
      actor: "player:" + player.id,
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
