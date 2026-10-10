import { authenticate } from "./auth.js";
import { validateState, PayloadError } from "./validate.js";
import { getFile, putFile, StorageError } from "./github.js";
import { MAX_CHANGELOG, makeEntry, describeChange } from "./changelog.js";
import {
  parseChat, serializeChat, emptyChat, addMessage, markRead, publicChat,
  MAX_MESSAGE_CHARS
} from "./chat.js";

const MAX_BODY_CHARS = 900000;
const MAX_CHAT_BODY_CHARS = 12000;
const REQUIRED_VARS = ["GITHUB_OWNER", "GITHUB_REPO", "GITHUB_BRANCH", "DATA_PATH", "GITHUB_TOKEN", "AUTH_TOKENS"];
const DEFAULT_AUTHOR = "Team member";

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
    changePath: env.CHANGE_PATH || "changelog.json",
    chatPath: env.CHAT_PATH || "chat.json",
    token: env.GITHUB_TOKEN,
    authTokens: env.AUTH_TOKENS,
    authNames: env.AUTH_NAMES || "",
    corsOrigin: env.CORS_ORIGIN || "*"
  };
  const missing = REQUIRED_VARS.filter((k) => !env[k]);
  return { cfg, missing };
}

function parseAuthNames(secret) {
  const map = {};
  if (!secret) return map;
  for (const raw of String(secret).split(/[,;]/)) {
    const pair = raw.trim();
    if (!pair) continue;
    const idx = pair.indexOf(":");
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    const name = pair.slice(idx + 1).trim();
    if (key) map[key] = name || key;
  }
  return map;
}

function parseChangeItems(text) {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch (e) {
    return [];
  }
}

export function createHandler(env, fetchImpl = globalThis.fetch) {
  const { cfg, missing } = readConfig(env);
  const changeCfg = Object.assign({}, cfg, { path: cfg.changePath });
  const chatCfg = Object.assign({}, cfg, { path: cfg.chatPath });
  const authNames = parseAuthNames(cfg.authNames);

  function authorName(token) {
    return (authNames && authNames[token]) || DEFAULT_AUTHOR;
  }

  async function readChat() {
    const file = await getFile(chatCfg, fetchImpl);
    if (file.missing) return { file: file, store: emptyChat() };
    return { file: file, store: parseChat(file.text) };
  }

  async function commitChat(mutator) {
    let conflict = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const current = await readChat();
      const result = mutator(current.store);
      try {
        await putFile(chatCfg, fetchImpl, {
          sha: current.file.missing ? undefined : current.file.sha,
          text: serializeChat(current.store),
          message: "Update team chat via API"
        });
        return result;
      } catch (err) {
        if (err instanceof StorageError && err.status === 409) { conflict = err; continue; }
        throw err;
      }
    }
    throw new PayloadError("chat-write-conflict", 409, "chat storage changed while writing; retry");
  }

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
          "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
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

    try {
      if (url.pathname === "/api/data") {
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
          return await handlePut(request, cfg, changeCfg, authNames, auth.token, fetchImpl, cors);
        }
        return json(405, { error: "method-not-allowed" }, cors);
      }

      if (url.pathname === "/api/changelog") {
        if (request.method === "GET") {
          return await handleChangelogGet(cfg, changeCfg, fetchImpl, cors);
        }
        return json(405, { error: "method-not-allowed" }, cors);
      }

      if (url.pathname === "/api/chat") {
        if (request.method === "GET") {
          const since = Number(url.searchParams.get("since") || 0);
          const current = await readChat();
          return json(200, publicChat(current.store, { since: since, me: authorName(auth.token) }), cors);
        }
        if (request.method === "POST") {
          return await handleChatPost(request, cors, auth.token);
        }
        return json(405, { error: "method-not-allowed" }, cors);
      }

      if (url.pathname === "/api/chat/read") {
        if (request.method !== "POST") return json(405, { error: "method-not-allowed" }, cors);
        return await handleChatRead(request, cors, auth.token);
      }

      return json(404, { error: "not-found" }, cors);
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

  async function handleChangelogGet(cfg, changeCfg, fetchImpl, cors) {
    const [cl, data] = await Promise.all([
      getFile(changeCfg, fetchImpl),
      getFile(cfg, fetchImpl)
    ]);
    const items = cl.missing ? [] : parseChangeItems(cl.text);
    return json(200, {
      items: items,
      sha: cl.missing ? null : cl.sha,
      dataSha: data.missing ? null : data.sha
    }, cors);
  }

  async function parseChatBody(request) {
    let raw;
    try {
      raw = await request.text();
    } catch (e) {
      throw new PayloadError("invalid-body", 400, "could not read body");
    }
    if (raw.length > MAX_CHAT_BODY_CHARS) throw new PayloadError("payload-too-large", 413, "chat body too large");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new PayloadError("invalid-json", 400, "body is not valid JSON");
    }
    if (!parsed || typeof parsed !== "object") throw new PayloadError("invalid-body", 400, "body must be an object");
    return parsed;
  }

  async function handleChatPost(request, cors, authToken) {
    const body = await parseChatBody(request);
    const text = String(body.text || "").trim();
    if (!text) return json(400, { error: "empty-message", message: "message text is required" }, cors);
    if (text.length > MAX_MESSAGE_CHARS) return json(400, { error: "message-too-long" }, cors);
    const author = authorName(authToken);
    const result = await commitChat(function (store) {
      return addMessage(store, {
        author: author,
        clientId: body.clientId,
        text: body.text,
        projectId: body.projectId,
        projectName: body.projectName
      });
    });
    if (result.error === "empty-message") return json(400, { error: "empty-message" }, cors);
    return json(200, {
      message: result.message,
      duplicate: !!result.duplicate,
      latest: result.message ? result.message.seq : 0
    }, cors);
  }

  async function handleChatRead(request, cors, authToken) {
    const body = await parseChatBody(request);
    const seq = Number(body.seq);
    if (!Number.isFinite(seq) || seq < 0) return json(400, { error: "invalid-seq" }, cors);
    const author = authorName(authToken);
    const result = await commitChat(function (store) {
      return { read: markRead(store, author, seq), latest: Number(store.seq) || 0, reads: store.reads };
    });
    return json(200, { read: result.read, latest: result.latest, reads: result.reads, me: author }, cors);
  }

  async function handlePut(request, cfg, changeCfg, authNames, authToken, fetchImpl, cors) {
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
    await appendChangelog(current, body.data, text, cfg, changeCfg, authNames, authToken, fetchImpl);
    return json(200, { sha: result.sha }, cors);
  }

  async function appendChangelog(current, nextData, nextText, cfg, changeCfg, authNames, authToken, fetchImpl) {
    try {
      if (nextText === current.text) return;
      const info = describeChange(current.missing ? null : safeParse(current.text), nextData);
      if (!info || !info.summary) return;
      const existing = await getFile(changeCfg, fetchImpl);
      const items = existing.missing ? [] : parseChangeItems(existing.text);
      const user = (authNames && authNames[authToken]) || "Team member";
      items.unshift(makeEntry(user, info.summary, null, {
        projectId: info.projectId,
        projectName: info.projectName,
        investorId: info.investorId
      }));
      if (items.length > MAX_CHANGELOG) items.length = MAX_CHANGELOG;
      await putFile(changeCfg, fetchImpl, {
        sha: existing.missing ? undefined : existing.sha,
        text: JSON.stringify({ items: items }, null, 2),
        message: "Update changelog via API"
      });
    } catch (e) {
      console.error("changelog-write-failed:", e && e.message ? e.message : String(e));
    }
  }
}

function safeParse(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}
