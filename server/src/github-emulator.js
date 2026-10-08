import fs from "node:fs";
import { computeBlobSha } from "./blobsha.js";
import { buildFileUrl, toBase64, fromBase64 } from "./github.js";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function createGitHubEmulator(cfg, dataFile) {
  const getUrl = buildFileUrl(cfg);
  const putUrl = buildFileUrl(cfg, { withRef: false });
  const calls = [];

  function readText() {
    try { return fs.readFileSync(dataFile, "utf8"); } catch (e) { return null; }
  }

  async function fetchImpl(url, init = {}) {
    const method = (init.method || "GET").toUpperCase();
    const target = String(url);
    calls.push({ url: target, method, headers: init.headers || {}, body: init.body ? String(init.body) : null });

    if (method === "GET" && target === getUrl) {
      const text = readText();
      if (text === null) return jsonResponse(404, { message: "Not Found" });
      return jsonResponse(200, { sha: computeBlobSha(text), content: toBase64(text), name: cfg.path, path: cfg.path });
    }

    if (method === "PUT" && target === putUrl) {
      let payload;
      try { payload = JSON.parse(init.body); } catch (e) { return jsonResponse(422, { message: "Bad JSON body" }); }
      const current = readText();
      const currentSha = current === null ? null : computeBlobSha(current);
      if (currentSha !== null && (!payload.sha || payload.sha !== currentSha)) {
        return jsonResponse(409, { message: "sha mismatch" });
      }
      if (currentSha === null && payload.sha) {
        return jsonResponse(409, { message: "sha provided but file does not exist" });
      }
      if (payload.branch !== cfg.branch) return jsonResponse(422, { message: "branch mismatch" });
      const text = fromBase64(payload.content);
      fs.writeFileSync(dataFile, text, "utf8");
      return jsonResponse(200, { content: { sha: computeBlobSha(text), name: cfg.path, path: cfg.path } });
    }

    return jsonResponse(403, { message: "out-of-scope storage request blocked" });
  }

  return { fetchImpl, calls, getUrl, putUrl };
}
