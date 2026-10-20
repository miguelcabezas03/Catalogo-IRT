import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type DatabricksRun = {
  job_id?: number;
  run_id?: number;
  state?: {
    life_cycle_state?: string;
    result_state?: string;
    state_message?: string;
  };
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey =
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!authorization || !supabaseUrl || !supabaseKey) {
    return json({ error: "La sesión no es válida." }, 401);
  }

  const accessToken = authorization.replace(/^Bearer\s+/i, "");
  const client = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await client.auth.getUser(accessToken);
  if (authError || !auth.user) return json({ error: "La sesión expiró." }, 401);

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .single();
  if (profileError || !["admin", "validation"].includes(String(profile?.role))) {
    return json({ error: "Solo Administrador o Validación pueden actualizar Databricks." }, 403);
  }

  const host = Deno.env.get("DATABRICKS_HOST")?.replace(/\/$/, "");
  const token = Deno.env.get("DATABRICKS_TOKEN");
  const jobId = Number(Deno.env.get("DATABRICKS_JOB_ID"));
  if (!host || !token || !Number.isSafeInteger(jobId)) {
    return json({ error: "Falta configurar la conexión segura con Databricks." }, 503);
  }

  let body: { action?: string; runId?: number } = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: "Solicitud inválida." }, 400);
  }

  const databricksRequest = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${host}/api/2.2${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const message = String(payload?.message ?? payload?.error_code ?? response.statusText);
      throw new Error(`Databricks respondió ${response.status}: ${message}`);
    }
    return payload;
  };

  const runResponse = (run: DatabricksRun, alreadyRunning = false) => ({
    runId: Number(run.run_id),
    runPageUrl: `${host}/jobs/${jobId}/runs/${Number(run.run_id)}`,
    lifeCycleState: String(run.state?.life_cycle_state ?? "PENDING"),
    resultState: run.state?.result_state ? String(run.state.result_state) : null,
    stateMessage: String(run.state?.state_message ?? ""),
    alreadyRunning,
  });

  try {
    if (body.action === "status") {
      const runId = Number(body.runId);
      if (!Number.isSafeInteger(runId)) return json({ error: "Ejecución inválida." }, 400);
      const run = (await databricksRequest(`/jobs/runs/get?run_id=${runId}`)) as DatabricksRun;
      if (Number(run.job_id) !== jobId) return json({ error: "La ejecución no pertenece a este proceso." }, 403);
      return json(runResponse(run));
    }

    if (body.action !== "run") return json({ error: "Acción inválida." }, 400);

    const active = (await databricksRequest(
      `/jobs/runs/list?job_id=${jobId}&active_only=true&limit=1`,
    )) as { runs?: DatabricksRun[] };
    if (active.runs?.[0]) return json(runResponse(active.runs[0], true));

    const started = (await databricksRequest("/jobs/run-now", {
      method: "POST",
      body: JSON.stringify({
        job_id: jobId,
        idempotency_token: crypto.randomUUID(),
      }),
    })) as DatabricksRun;
    return json(runResponse({ ...started, state: { life_cycle_state: "PENDING" } }));
  } catch (error) {
    console.error(error);
    return json(
      { error: error instanceof Error ? error.message : "No se pudo contactar Databricks." },
      502,
    );
  }
});
