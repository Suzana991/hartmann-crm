import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createHandler } from "./handler.js";
import { createGitHubEmulator } from "./github-emulator.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "..");
const PORT = Number(process.env.PORT || 8788);
const DEV_TOKEN = process.env.DEV_TOKEN || "dev-token";
const TEMP = process.env.TEMP || process.env.TMP || ROOT;
const DATA_FILE = process.env.DEV_DATA_FILE || path.join(TEMP, "hartmann-crm-dev-data.json");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "legacy-data.json");

const STATIC_FILES = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/util.js": { file: "util.js", type: "text/javascript; charset=utf-8" },
  "/migration.js": { file: "migration.js", type: "text/javascript; charset=utf-8" },
  "/persistence.js": { file: "persistence.js", type: "text/javascript; charset=utf-8" },
  "/views.js": { file: "views.js", type: "text/javascript; charset=utf-8" },
  "/modals.js": { file: "modals.js", type: "text/javascript; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" }
};

function seedDataFile() {
  if (process.env.DEV_RESET && fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE);
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.copyFileSync(FIXTURE, DATA_FILE);
    console.log("[dev] seeded dev data from fixture:", DATA_FILE);
  }
}

function makeEnv() {
  return {
    GITHUB_OWNER: "local-dev",
    GITHUB_REPO: "hartmann-crm",
    GITHUB_BRANCH: "dev",
    DATA_PATH: "data.json",
    GITHUB_TOKEN: "dev-github-token",
    AUTH_TOKENS: DEV_TOKEN,
    CORS_ORIGIN: "*"
  };
}

function configJs() {
  return "window.CRM_CONFIG = { apiBase: \"http://127.0.0.1:" + PORT + "\", appName: \"Hartmann Outreach Tracker (dev)\" };\n";
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on("data", function (c) {
      size += c.length;
      if (size > 1200000) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", function () { resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
  });
}

seedDataFile();
const env = makeEnv();
const emulator = createGitHubEmulator(
  { owner: env.GITHUB_OWNER, repo: env.GITHUB_REPO, branch: env.GITHUB_BRANCH, path: env.DATA_PATH, token: env.GITHUB_TOKEN },
  DATA_FILE
);
const apiHandler = createHandler(env, emulator.fetchImpl);

const server = http.createServer(async function (req, res) {
  try {
    const url = new URL(req.url, "http://127.0.0.1:" + PORT);

    if (url.pathname === "/config.js") {
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
      res.end(configJs());
      return;
    }

    if (url.pathname.indexOf("/api/") === 0) {
      let body = null;
      if (req.method !== "GET" && req.method !== "HEAD") {
        try {
          body = await readBody(req);
        } catch (e) {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "payload-too-large" }));
          return;
        }
      }
      const headers = new Headers();
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        headers.set(req.rawHeaders[i], req.rawHeaders[i + 1]);
      }
      const request = new Request("http://127.0.0.1:" + PORT + url.pathname + url.search, {
        method: req.method,
        headers: headers,
        body: body
      });
      const response = await apiHandler(request);
      const out = {};
      response.headers.forEach(function (v, k) { out[k] = v; });
      res.writeHead(response.status, out);
      res.end(await response.text());
      return;
    }

    const entry = STATIC_FILES[url.pathname];
    if (entry) {
      const filePath = path.join(ROOT, entry.file);
      if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      const text = fs.readFileSync(filePath, "utf8");
      res.writeHead(200, { "Content-Type": entry.type, "Cache-Control": "no-store" });
      res.end(text);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "internal-error" }));
  }
});

server.listen(PORT, "127.0.0.1", function () {
  console.log("[dev] Hartmann CRM dev server on http://127.0.0.1:" + PORT);
  console.log("[dev] auth keys configured: " + String(DEV_TOKEN || "").split(",").filter(Boolean).length + " (values not logged)");
  console.log("[dev] data file:", DATA_FILE);
  console.log("[dev] reset data with: DEV_RESET=1 node server/src/dev-server.js");
});
