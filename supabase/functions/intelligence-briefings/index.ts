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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Use GET or POST." }, 405);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) return json({ error: "Briefings service is not configured." }, 500);

  const authorization = req.headers.get("Authorization") ?? "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return json({ error: "Sign in to access Briefings." }, 401);

  try {
    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(tokenMatch[1]);
    if (authError || !authData.user) return json({ error: "Your session is invalid or expired. Reopen the Mini App." }, 401);

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: player, error: playerError } = await db.from("players").select("id")
      .eq("id", authData.user.id).maybeSingle();
    if (playerError || !player) return json({ error: "Player profile was not found." }, 403);

    if (req.method === "GET") {
      const { data: briefings, error } = await db.from("briefings")
        .select("id, slug, title, summary, category, content, access_mode, prerequisite_briefing_id, sort_order, passing_score, reward_type, reward_amount, published_at")
        .eq("status", "published").order("sort_order", { ascending: true }).order("published_at", { ascending: true }).limit(100);
      if (error) {
        console.error("Briefing list failed:", error);
        return json({ error: "Could not load Intelligence Briefings." }, 500);
      }
      const ids = (briefings ?? []).map((item) => item.id);
      if (!ids.length) return json({ briefings: [] });

      const [questionsRes, progressRes] = await Promise.all([
        db.from("briefing_questions")
          .select("id, briefing_id, prompt, options, explanation, sort_order")
          .in("briefing_id", ids).order("sort_order", { ascending: true }),
        db.from("briefing_progress")
          .select("briefing_id, status, attempts, best_score, completed_at")
          .eq("player_id", player.id).in("briefing_id", ids),
      ]);
      if (questionsRes.error || progressRes.error) {
        console.error("Briefing detail lookup failed:", questionsRes.error ?? progressRes.error);
        return json({ error: "Could not load briefing details." }, 500);
      }
      const questionMap = new Map<string, Array<Record<string, unknown>>>();
      for (const q of questionsRes.data ?? []) {
        const list = questionMap.get(q.briefing_id) ?? [];
        list.push({ id: q.id, prompt: q.prompt, options: q.options, explanation: q.explanation, order: q.sort_order });
        questionMap.set(q.briefing_id, list);
      }
      const progressMap = new Map((progressRes.data ?? []).map((p) => [p.briefing_id, p]));
      const completed = new Set((progressRes.data ?? []).filter((p) => p.status === "completed").map((p) => p.briefing_id));
      const output = (briefings ?? []).map((b) => {
        const progress = progressMap.get(b.id);
        const prerequisiteComplete = !b.prerequisite_briefing_id || completed.has(b.prerequisite_briefing_id);
        return {
          id: b.id, slug: b.slug, title: b.title, summary: b.summary, category: b.category,
          content: b.content, accessMode: b.access_mode, prerequisiteBriefingId: b.prerequisite_briefing_id,
          sortOrder: b.sort_order, passingScore: b.passing_score,
          reward: { type: b.reward_type, amount: Number(b.reward_amount) },
          publishedAt: b.published_at,
          questions: questionMap.get(b.id) ?? [],
          progress: progress ? { status: progress.status, attempts: progress.attempts, bestScore: progress.best_score, completedAt: progress.completed_at } : null,
          isUnlocked: prerequisiteComplete,
          lockedReason: prerequisiteComplete ? null : "Complete the previous briefing first.",
        };
      });
      return json({ briefings: output });
    }

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "Invalid request body." }, 400); }
    if (body.action !== "submit_attempt") return json({ error: "Unknown briefing action." }, 400);
    const briefingId = typeof body.briefingId === "string" ? body.briefingId : "";
    const answers = body.answers;
    if (!UUID_RE.test(briefingId) || !answers || typeof answers !== "object" || Array.isArray(answers)) {
      return json({ error: "A valid briefing and answer set are required." }, 400);
    }
    const entries = Object.entries(answers as Record<string, unknown>);
    if (entries.length > 30 || entries.some(([key, value]) => !UUID_RE.test(key) || typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 5)) {
      return json({ error: "Answers contain an invalid question or option." }, 400);
    }
    const { data, error } = await db.rpc("submit_briefing_attempt", {
      p_player_id: player.id,
      p_briefing_id: briefingId,
      p_answers: answers,
    });
    if (error) {
      const message = error.message.includes("prerequisite") ? "Complete the previous briefing first."
        : error.message.includes("not available") ? "This briefing is no longer available."
        : error.message.includes("Answer every") || error.message.includes("invalid answer") ? error.message
        : "Could not submit your quiz. Please try again.";
      return json({ error: message }, 400);
    }
    return json(data);
  } catch (error) {
    console.error("Intelligence Briefings request failed:", error);
    return json({ error: "Briefings service temporarily unavailable." }, 500);
  }
});
