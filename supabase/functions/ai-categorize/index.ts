// ai-categorize — auth-gated Anthropic proxy.
//
// Lets every logged-in household member use the household's shared Claude key
// (ANTHROPIC_API_KEY secret) WITHOUT the key ever reaching the browser. The
// static site's JS is world-readable, so the key must stay server-side.
//
// Auth: the caller must present a valid Supabase *user* access token (not just
// the public anon key). We verify it against /auth/v1/user and require
// aud="authenticated". Deploy with --no-verify-jwt; auth is enforced here so
// the CORS preflight and token check work cleanly.
//
// Request body mirrors the Anthropic Messages API: { model, max_tokens,
// messages, system? }. The response is Anthropic's JSON, passed through
// verbatim with the original status code.

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!ANTHROPIC_KEY) return json({ error: "Server missing ANTHROPIC_API_KEY" }, 500);

  // Require a valid logged-in user (reject anon-key-only callers).
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Missing auth token" }, 401);
  let user: { id?: string; aud?: string } = {};
  try {
    const userRes = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SB_ANON },
    });
    if (!userRes.ok) return json({ error: "Not authenticated" }, 401);
    user = await userRes.json();
  } catch {
    return json({ error: "Auth check failed" }, 401);
  }
  if (!user?.id || user?.aud !== "authenticated") {
    return json({ error: "Not an authenticated user" }, 403);
  }

  // Forward to Anthropic with the server-side key.
  let body: { model?: string; max_tokens?: number; messages?: unknown; system?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!Array.isArray(body.messages) || !body.messages.length) {
    return json({ error: "messages[] required" }, 400);
  }
  const payload = {
    model: body.model || "claude-haiku-4-5-20251001",
    max_tokens: Math.min(Number(body.max_tokens) || 4000, 8000),
    messages: body.messages,
    ...(body.system ? { system: body.system } : {}),
  };

  let r: Response;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return json({ error: "Upstream request failed", detail: String(e) }, 502);
  }
  const text = await r.text();
  return new Response(text, {
    status: r.status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
