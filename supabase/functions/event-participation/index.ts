import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function registrationEvidence(event: { objectives?: unknown; requirements?: unknown }) {
  const objectives = Array.isArray(event.objectives) ? event.objectives : [];
  const requirements = Array.isArray(event.requirements) ? event.requirements : [];
  if (!objectives.includes("register") || !requirements.includes("authenticated_player")) return null;

  return {
    progress: {
      register: {
        verified: true,
        verifiedAt: new Date().toISOString(),
        method: "server_authenticated_registration",
      },
    },
  };
}

async function verifyConfiguredCreatorActivities(
  admin: ReturnType<typeof createClient>,
  playerId: string,
  event: { id: string; starts_at: string | null; ends_at: string | null },
  registration: Record<string, unknown>,
) {
  if (!event.starts_at || !event.ends_at) return registration;

  const { data: activities, error: activitiesError } = await admin
    .from("game_event_activities")
    .select("id, mission_id, activity_type, is_required")
    .eq("event_id", event.id);
  if (activitiesError) {
    console.error("Event activity verification lookup failed:", activitiesError);
    throw new Error("Could not verify event activities.");
  }

  const currentProgress = registration.progress && typeof registration.progress === "object" && !Array.isArray(registration.progress)
    ? registration.progress as Record<string, unknown>
    : {};
  const existingActivityProgress = currentProgress.activities && typeof currentProgress.activities === "object" && !Array.isArray(currentProgress.activities)
    ? currentProgress.activities as Record<string, unknown>
    : {};
  const nextActivityProgress: Record<string, unknown> = { ...existingActivityProgress };
  let changed = false;

  for (const activity of activities ?? []) {
    if (activity.activity_type !== "creator_submission_approved" || !activity.mission_id) continue;

    const { data: creatorMission, error: missionError } = await admin
      .from("mission_tasks")
      .select("id")
      .eq("id", activity.mission_id)
      .eq("kind", "creator")
      .maybeSingle();
    if (missionError) {
      console.error("Creator mission lookup failed:", missionError);
      throw new Error("Could not verify the linked Creator Ops mission.");
    }
    if (!creatorMission) continue;

    const previous = nextActivityProgress[activity.id];
    if (previous && typeof previous === "object" && (previous as Record<string, unknown>).verified === true) continue;

    const { data: submission, error } = await admin
      .from("creator_ops_submissions")
      .select("id, mission_id, created_at, reviewed_at")
      .eq("player_id", playerId)
      .eq("mission_id", activity.mission_id)
      .eq("status", "approved")
      .gte("created_at", event.starts_at)
      .lte("created_at", event.ends_at)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Creator activity verification failed:", error);
      throw new Error("Could not verify creator submission activity.");
    }
    if (!submission) continue;

    nextActivityProgress[activity.id] = {
      verified: true,
      verifiedAt: new Date().toISOString(),
      method: "admin_approved_creator_ops_submission",
      submissionId: submission.id,
      missionId: submission.mission_id,
      submittedAt: submission.created_at,
      approvedAt: submission.reviewed_at,
    };
    changed = true;
  }

  const requiredActivities = (activities ?? []).filter((activity) => activity.is_required);
  const allRequiredActivitiesVerified = requiredActivities.length > 0 &&
    requiredActivities.every((activity) => {
      if (activity.activity_type !== "creator_submission_approved" || !activity.mission_id) return false;
      const evidence = nextActivityProgress[activity.id];
      return !!evidence && typeof evidence === "object" && (evidence as Record<string, unknown>).verified === true;
    });

  if (!changed && !(allRequiredActivitiesVerified && registration.status !== "completed")) return registration;

  const update: Record<string, unknown> = {
    progress: { ...currentProgress, activities: nextActivityProgress },
    updated_at: new Date().toISOString(),
  };
  if (allRequiredActivitiesVerified && registration.status !== "completed") {
    update.status = "completed";
    update.completed_at = registration.completed_at ?? new Date().toISOString();
  } else if (changed && registration.status === "registered") {
    update.status = "in_progress";
  }

  const { data: updated, error: updateError } = await admin
    .from("game_event_participations")
    .update(update)
    .eq("id", registration.id)
    .eq("player_id", playerId)
    .select("id, event_id, status, progress, registered_at, updated_at, completed_at, game_events(id, title, category, starts_at, ends_at, timezone, objectives, requirements)")
    .single();

  if (updateError) {
    console.error("Creator activity progress update failed:", updateError);
    throw new Error("Could not save verified event progress.");
  }
  return updated;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Method not allowed. Use GET or POST." }, 405);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    console.error("Event participation service configuration is incomplete");
    return json({ error: "Event participation service is not configured" }, 500);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return json({ error: "Sign in to register for an event." }, 401);

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

    if (req.method === "GET") {
      const { data: registrations, error: registrationsError } = await admin
        .from("game_event_participations")
        .select("id, event_id, status, progress, registered_at, updated_at, completed_at, game_events(id, title, category, starts_at, ends_at, timezone, objectives, requirements)")
        .eq("player_id", player.id)
        .order("registered_at", { ascending: false })
        .limit(100);
      if (registrationsError) {
        console.error("Event history lookup failed:", registrationsError);
        return json({ error: "Could not load your event history." }, 500);
      }

      const verifiedRegistrations = await Promise.all((registrations ?? []).map(async (registration) => {
        const event = registration.game_events;
        if (!event || registration.status === "withdrawn") return registration;

        let current = registration as unknown as Record<string, unknown>;
        const registrationProof = registrationEvidence(event);
        if (registrationProof) {
          const progress = current.progress && typeof current.progress === "object" && !Array.isArray(current.progress)
            ? current.progress as Record<string, unknown>
            : {};
          const existingRegisterProof = progress.register && typeof progress.register === "object"
            ? progress.register as Record<string, unknown>
            : null;
          if (existingRegisterProof?.verified !== true) {
            const { data: updated, error: updateError } = await admin
              .from("game_event_participations")
              .update({
                progress: { ...progress, ...registrationProof.progress },
                updated_at: new Date().toISOString(),
              })
              .eq("id", registration.id)
              .eq("player_id", player.id)
              .select("id, event_id, status, progress, registered_at, updated_at, completed_at, game_events(id, title, category, starts_at, ends_at, timezone, objectives, requirements)")
              .single();
            if (updateError) throw new Error("Could not verify event registration evidence.");
            current = updated as unknown as Record<string, unknown>;
          }
        }

        return await verifyConfiguredCreatorActivities(
          admin,
          player.id,
          event,
          current,
        );
      }));

      const registeredEventIds = verifiedRegistrations
        .filter((registration) => registration.status !== "withdrawn")
        .map((registration) => registration.event_id);
      const activitiesByEvent = new Map<string, Array<Record<string, unknown>>>();
      if (registeredEventIds.length > 0) {
        const { data: activities, error: activitiesError } = await admin
          .from("game_event_activities")
          .select("id, event_id, mission_id, activity_type, title, description, instructions, is_required, sort_order")
          .in("event_id", registeredEventIds)
          .order("sort_order", { ascending: true });
        if (activitiesError) {
          console.error("Event activity lookup failed:", activitiesError);
          return json({ error: "Could not load your event activities." }, 500);
        }

        const missionIds = [...new Set((activities ?? [])
          .map((activity) => activity.mission_id)
          .filter((id): id is string => typeof id === "string"))];
        const missionById = new Map<string, Record<string, unknown>>();
        if (missionIds.length > 0) {
          const { data: missions, error: missionsError } = await admin
            .from("mission_tasks")
            .select("id, title, description, action_url, kind, platform, status")
            .in("id", missionIds)
            .eq("status", "published");
          if (missionsError) {
            console.error("Linked event mission lookup failed:", missionsError);
            return json({ error: "Could not load event mission details." }, 500);
          }
          for (const mission of missions ?? []) missionById.set(mission.id, mission);
        }

        const registrationByEventId = new Map(
          verifiedRegistrations.map((item) => [item.event_id, item]),
        );

        for (const activity of activities ?? []) {
          const eventActivities = activitiesByEvent.get(activity.event_id) ?? [];
          const linkedMission = activity.mission_id ? missionById.get(activity.mission_id) ?? null : null;
          const activityRegistration = registrationByEventId.get(activity.event_id);
          const progress = activityRegistration?.progress && typeof activityRegistration.progress === "object" && !Array.isArray(activityRegistration.progress)
            ? activityRegistration.progress as Record<string, unknown>
            : {};
          const activityProgress = progress.activities && typeof progress.activities === "object" && !Array.isArray(progress.activities)
            ? progress.activities as Record<string, unknown>
            : {};
          const evidence = activityProgress[activity.id];
          const isVerified = !!evidence && typeof evidence === "object" && (evidence as Record<string, unknown>).verified === true;
          eventActivities.push({
            id: activity.id,
            activity_type: activity.activity_type,
            title: activity.title,
            description: activity.description,
            instructions: activity.instructions,
            is_required: activity.is_required,
            sort_order: activity.sort_order,
            mission: linkedMission,
            verification: isVerified ? "verified" : "awaiting_verification",
          });
          activitiesByEvent.set(activity.event_id, eventActivities);
        }
      }

      const registrationsWithActivities = verifiedRegistrations.map((registration) => ({
        ...registration,
        activities: activitiesByEvent.get(registration.event_id) ?? [],
      }));

      return json({ registrations: registrationsWithActivities });
    }

    let body: { eventId?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "A valid JSON request body is required." }, 400);
    }
    if (!body || typeof body.eventId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.eventId)) {
      return json({ error: "A valid event ID is required." }, 400);
    }

    const { data: event, error: eventError } = await admin
      .from("game_events")
      .select("id, status, starts_at, ends_at, objectives, requirements")
      .eq("id", body.eventId)
      .maybeSingle();
    if (eventError) return json({ error: "Could not verify this event." }, 500);
    if (!event || event.status !== "published" || !event.starts_at || !event.ends_at) {
      return json({ error: "This event is not open for registration." }, 409);
    }
    if (new Date(event.ends_at).getTime() <= Date.now()) {
      return json({ error: "Registration for this event has closed." }, 409);
    }

    const { data: registrationResult, error: registrationError } = await admin.rpc("register_for_game_event", {
      p_event_id: event.id,
      p_player_id: player.id,
    });

    if (registrationError || !registrationResult) {
      console.error("Event registration RPC failed:", registrationError);
      return json({ error: "Could not register for this event. Please try again." }, 500);
    }

    if (registrationResult.success !== true) {
      if (registrationResult.reason === "event_full") {
        return json({
          error: "This event has reached its participant limit.",
          reason: "event_full",
          participantCount: registrationResult.participantCount,
          maxParticipants: registrationResult.maxParticipants,
        }, 409);
      }
      return json({ error: "This event is not open for registration." }, 409);
    }

    return json({
      success: true,
      alreadyRegistered: registrationResult.alreadyRegistered === true,
      participation: registrationResult.participation,
    });
  } catch (error) {
    console.error("Event registration failed:", error);
    return json({ error: "Event registration could not be completed." }, 500);
  }
});
