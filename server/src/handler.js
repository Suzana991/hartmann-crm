import { authenticate } from "./auth.js";
import { validateState, PayloadError } from "./validate.js";
import { getFile, putFile, StorageError } from "./github.js";

const MAX_BODY_CHARS = 900000;
const REQUIRED_VARS = ["GITHUB_OWNER", "GITHUB_REPO", "GITHUB_BRANCH", "DATA_PATH", "GITHUB_TOKEN", "AUTH_TOKENS"];

function baseHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  };
}

function corsHeaders(cfg, origin) {
  const allowed = String(cfg.corsOrigin || "").split(",").map((s) => s.trim()).filter(Boolean);
  let value = null;
  if (allowed.includes("*")) value = "*";
  else if (origin && allowed.includes(origin)) value = origin;
  return value ? { "Access-Control-Allow-Origin": value, "Vary": "Origin" } : {};
}

function json(status, body, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({}, baseHeaders(), extraHeaders || {})
  });
}

function readConfig(env) {
  const cfg = {
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
    branch: env.GITHUB_BRANCH,
    path: env.DATA_PATH,
    token: env.GITHUB_TOKEN,
    authTokens: env.AUTH_TOKENS,
    corsOrigin: env.CORS_ORIGIN || "*"
  };
  const missing = REQUIRED_VARS.filter((k) => !env[k]);
  return { cfg, missing };
}

export function createHandler(env, fetchImpl = globalThis.fetch) {
  const { cfg, missing } = readConfig(env);

  return async function handle(request) {
    if (missing.length > 0) {
      console.error("config-error missing vars:", missing.join(","));
      return json(500, { error: "server-not-configured" });
    }
    const url = new URL(request.url);
    const cors = corsHeaders(cfg, request.headers.get("origin"));

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: Object.assign({}, baseHeaders(), cors, {
          "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "86400"
        })
      });
    }

    if (url.pathname.indexOf("/api/") !== 0) {
      return json(404, { error: "not-found" }, cors);
    }

    const auth = await authenticate(request, cfg.authTokens);
    if (!auth.ok) {
      return json(401, { error: "unauthorized" }, cors);
    }

    if (url.pathname !== "/api/data") {
      return json(404, { error: "not-found" }, cors);
    }

    try {
      if (request.method === "GET") {
        const file = await getFile(cfg, fetchImpl);
        if (file.missing) return json(200, { data: null, sha: null }, cors);
        let parsed;
        try {
          parsed = JSON.parse(file.text);
        } catch (e) {
          return json(500, { error: "stored-data-unreadable" }, cors);
        }
        return json(200, { data: parsed, sha: file.sha }, cors);
      }

      if (request.method === "PUT") {
        return await handlePut(request, cfg, fetchImpl, cors);
      }

      return json(405, { error: "method-not-allowed" }, cors);
    } catch (err) {
      if (err instanceof PayloadError) {
        return json(err.status, { error: err.code, message: err.message }, cors);
      }
      if (err instanceof StorageError) {
        console.error("storage-error status:", err.status, err.message);
        if (err.status === 409) {
          const current = await getFile(cfg, fetchImpl).catch(() => null);
          if (current && !current.missing) {
            let data = null;
            try { data = JSON.parse(current.text); } catch (e) { data = null; }
            return json(409, { error: "conflict", sha: current.sha, data }, cors);
          }
        }
        return json(err.status || 502, { error: "storage-unavailable" }, cors);
      }
      console.error("internal-error:", err && err.status ? err.status : "unknown");
      return json(500, { error: "internal-error" }, cors);
    }
  };

  async function handlePut(request, cfg, fetchImpl, cors) {
    let raw;
    try {
      raw = await request.text();
    } catch (e) {
      return json(400, { error: "invalid-body" }, cors);
    }
    if (raw.length > MAX_BODY_CHARS) {
      return json(413, { error: "payload-too-large", message: "request body exceeds limit" }, cors);
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch (e) {
      return json(400, { error: "invalid-json", message: "body is not valid JSON" }, cors);
    }
    if (!body || typeof body !== "object" || !("data" in body)) {
      return json(400, { error: "missing-data", message: "body must contain a data field" }, cors);
    }
    const baseSha = body.baseSha === undefined ? null : body.baseSha;
    if (baseSha !== null && typeof baseSha !== "string") {
      return json(400, { error: "invalid-base-sha", message: "baseSha must be a string or null" }, cors);
    }
    validateState(body.data);

    const current = await getFile(cfg, fetchImpl);
    if (baseSha === null) {
      if (!current.missing) {
        return json(409, { error: "conflict", sha: current.sha, data: safeParse(current.text) }, cors);
      }
    } else {
      if (current.missing || current.sha !== baseSha) {
        return json(409, {
          error: "conflict",
          sha: current.missing ? null : current.sha,
          data: current.missing ? null : safeParse(current.text)
        }, cors);
      }
    }

    const text = JSON.stringify(body.data, null, 2);
    const result = await putFile(cfg, fetchImpl, {
      sha: current.missing ? undefined : current.sha,
      text,
      message: "Update CRM data via API"
    });
    return json(200, { sha: result.sha }, cors);
  }
}

function safeParse(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}
