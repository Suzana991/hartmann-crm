import fs from "node:fs";
import { computeBlobSha } from "./blobsha.js";
import { buildFileUrl, toBase64, fromBase64 } from "./github.js";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function createGitHubEmulator(cfg, files) {
  const filesByUrl = new Map();
  const entries = (typeof files === "string" || files === null || files === undefined)
    ? [[cfg.path, files]]
    : Object.entries(files || {});
  for (const [p, file] of entries) {
    if (typeof file !== "string") continue;
    const c = Object.assign({}, cfg, { path: p });
    filesByUrl.set(buildFileUrl(c), file);
    filesByUrl.set(buildFileUrl(c, { withRef: false }), file);
  }
  const calls = [];

  function readText(file) {
    try { return fs.readFileSync(file, "utf8"); } catch (e) { return null; }
  }

  async function fetchImpl(url, init = {}) {
    const method = (init.method || "GET").toUpperCase();
    const target = String(url);
    calls.push({ url: target, method, headers: init.headers || {}, body: init.body ? String(init.body) : null });

    const file = filesByUrl.get(target);
    if (!file) return jsonResponse(403, { message: "out-of-scope storage request blocked" });

    if (method === "GET") {
      const text = readText(file);
      if (text === null) return jsonResponse(404, { message: "Not Found" });
      return jsonResponse(200, { sha: computeBlobSha(text), content: toBase64(text) });
    }

    if (method === "PUT") {
      let payload;
      try { payload = JSON.parse(init.body); } catch (e) { return jsonResponse(422, { message: "Bad JSON body" }); }
      const current = readText(file);
      const currentSha = current === null ? null : computeBlobSha(current);
      if (currentSha !== null && (!payload.sha || payload.sha !== currentSha)) {
        return jsonResponse(409, { message: "sha mismatch" });
      }
      if (currentSha === null && payload.sha) {
        return jsonResponse(409, { message: "sha provided but file does not exist" });
      }
      if (payload.branch !== cfg.branch) return jsonResponse(422, { message: "branch mismatch" });
      const text = fromBase64(payload.content);
      fs.writeFileSync(file, text, "utf8");
      return jsonResponse(200, { content: { sha: computeBlobSha(text) } });
    }

    return jsonResponse(403, { message: "out-of-scope storage request blocked" });
  }

  return {
    fetchImpl,
    calls,
    getUrl: buildFileUrl(cfg),
    putUrl: buildFileUrl(cfg, { withRef: false })
  };
}