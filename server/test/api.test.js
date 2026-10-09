import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHandler } from "../src/handler.js";
import { createGitHubEmulator } from "../src/github-emulator.js";
import { buildFileUrl, toBase64 } from "../src/github.js";

const GH_TOKEN = "ghs_server_side_secret_value_0001";
const TEAM_TOKENS = ["team-token-alpha", "team-token-beta"];

const ENV = {
  GITHUB_OWNER: "Suzana991",
  GITHUB_REPO: "hartmann-crm",
  GITHUB_BRANCH: "data",
  DATA_PATH: "data.json",
  CHANGE_PATH: "changelog.json",
  GITHUB_TOKEN: GH_TOKEN,
  AUTH_TOKENS: TEAM_TOKENS.join(", "),
  AUTH_NAMES: TEAM_TOKENS[0] + ":Alpha," + TEAM_TOKENS[1] + ":Beta",
  CORS_ORIGIN: "https://suzana991.github.io"
};

const GITHUB_CFG = {
  owner: ENV.GITHUB_OWNER,
  repo: ENV.GITHUB_REPO,
  branch: ENV.GITHUB_BRANCH,
  path: ENV.DATA_PATH
};

const GITHUB_CHANGE_CFG = Object.assign({}, GITHUB_CFG, { path: ENV.CHANGE_PATH });

function minimalState(overrides) {
  return Object.assign({
    schemaVersion: 3,
    investors: [],
    projects: [],
    activities: [],
    tasks: [],
    activeProjectId: null
  }, overrides || {});
}

function agreementStub() {
  return { status: "not_started", sentDate: "", sentBy: "", signedDate: "", docLink: "", notes: "", history: [] };
}

function seededState() {
  return minimalState({
    investors: [{ id: "inv1", name: "Test Bank", type: "Bank", website: "", location: "", preferences: "", notes: "", archived: false, contacts: [] }],
    projects: [{ id: "proj1", name: "Palazzo Ricci", archived: false, state: "active", deliveryStage: null, lead: "", milestones: [], stageNotes: {}, stageHistory: [], agreement: agreementStub(), engagements: [{ id: "eng1", investorId: "inv1", stage: "not_contacted", priority: "", owner: "", contactIds: [], notes: "", archived: false, legacy: { reachedOut: false, whoReachedOut: "", dateReachedOut: "", response: "", movingForward: "", nextSteps: "" }, reviewFlags: [] }] }],
    activeProjectId: "proj1"
  });
}

function legacySeed() {
  return JSON.stringify({ projects: [{ id: "p1", name: "Legacy Project", institutions: [], tasks: [] }], activeProjectId: "p1" }, null, 2);
}

function setup(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-api-test-"));
  const dataFile = path.join(dir, "data.json");
  const changeFile = path.join(dir, "changelog.json");
  if (opts.seed !== undefined && opts.seed !== null) fs.writeFileSync(dataFile, opts.seed, "utf8");
  if (opts.changelogSeed !== undefined && opts.changelogSeed !== null) fs.writeFileSync(changeFile, opts.changelogSeed, "utf8");
  const files = { [GITHUB_CFG.path]: dataFile, [GITHUB_CHANGE_CFG.path]: changeFile };
  const emu = createGitHubEmulator(GITHUB_CFG, files);
  let impl = emu.fetchImpl;
  if (opts.wrapFetch) impl = opts.wrapFetch(emu.fetchImpl);
  const handler = createHandler(opts.env || ENV, impl);
  return { handler, emu, dataFile, changeFile };
}

function makeReq(method, target, opts = {}) {
  const headers = {};
  if (opts.token) headers["Authorization"] = "Bearer " + opts.token;
  if (opts.origin) headers["Origin"] = opts.origin;
  let body;
  if (opts.raw !== undefined) {
    body = opts.raw;
    headers["Content-Type"] = "application/json";
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json";
  }
  return new Request("http://crm.test" + target, { method, headers, body });
}

async function readJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { return { __unparsed: text }; }
}

test("unauthenticated reads and writes are rejected before any storage access", async () => {
  const { handler, emu } = setup({ seed: legacySeed() });
  const noAuth = await handler(makeReq("GET", "/api/data"));
  assert.equal(noAuth.status, 401);
  const badAuth = await handler(makeReq("GET", "/api/data", { token: "not-a-team-token" }));
  assert.equal(badAuth.status, 401);
  const putNoAuth = await handler(makeReq("PUT", "/api/data", { body: { data: minimalState(), baseSha: null } }));
  assert.equal(putNoAuth.status, 401);
  assert.equal(emu.calls.length, 0, "no storage request must happen before authentication");
  const body1 = await readJson(badAuth);
  assert.equal(body1.error, "unauthorized");
});

test("configured team tokens are accepted and responses never contain credentials", async () => {
  const { handler, emu } = setup({ seed: legacySeed() });
  for (const token of TEAM_TOKENS) {
    const res = await handler(makeReq("GET", "/api/data", { token }));
    assert.equal(res.status, 200, token);
    const text = await res.text();
    assert.ok(!text.includes(GH_TOKEN), "github token absent");
    for (const t of TEAM_TOKENS) assert.ok(!text.includes(t), "team token absent");
    assert.ok(!text.includes("Bearer"));
  }
  assert.equal(emu.calls.length, 2);
});

test("read is scoped to the configured repository, branch and file only", async () => {
  const { handler, emu } = setup({ seed: legacySeed() });
  const res = await handler(makeReq("GET", "/api/data?ref=main&path=secrets.json", { token: TEAM_TOKENS[0] }));
  assert.equal(res.status, 200);
  const body = await readJson(res);
  assert.equal(body.data.projects[0].name, "Legacy Project");
  assert.equal(body.sha.length, 40);
  assert.equal(emu.calls.length, 1);
  assert.equal(emu.calls[0].url, buildFileUrl(GITHUB_CFG), "storage URL is exactly the configured file with configured branch");
  assert.equal(emu.calls[0].headers["Authorization"], "Bearer " + GH_TOKEN, "server-side credential used for storage");
});

test("read of missing file returns null data", async () => {
  const { handler } = setup();
  const res = await handler(makeReq("GET", "/api/data", { token: TEAM_TOKENS[0] }));
  assert.equal(res.status, 200);
  const body = await readJson(res);
  assert.deepEqual(body, { data: null, sha: null });
});

test("save with matching baseSha persists and returns new sha", async () => {
  const { handler, emu, dataFile } = setup({ seed: legacySeed() });
  const first = await readJson(await handler(makeReq("GET", "/api/data", { token: TEAM_TOKENS[0] })));
  const next = seededState();
  const res = await handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[1], body: { data: next, baseSha: first.sha } }));
  assert.equal(res.status, 200);
  const body = await readJson(res);
  assert.equal(typeof body.sha, "string");
  assert.notEqual(body.sha, first.sha);
  const onDisk = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  assert.deepEqual(onDisk, next);
  const dataPuts = emu.calls.filter((c) => c.method === "PUT" && c.url === buildFileUrl(GITHUB_CFG, { withRef: false }));
  assert.equal(dataPuts.length, 1);
  assert.ok(dataPuts[0].body.includes('"message":"Update CRM data via API"'));
  const changePuts = emu.calls.filter((c) => c.method === "PUT" && c.url === buildFileUrl(GITHUB_CHANGE_CFG, { withRef: false }));
  assert.equal(changePuts.length, 1, "a changelog entry is written alongside a successful data save");
  assert.ok(changePuts[0].body.includes('"message":"Update changelog via API"'));
});

test("stale baseSha yields 409 with current data and performs no write", async () => {
  const { handler, emu, dataFile } = setup({ seed: legacySeed() });
  const first = await readJson(await handler(makeReq("GET", "/api/data", { token: TEAM_TOKENS[0] })));
  fs.writeFileSync(dataFile, JSON.stringify(seededState(), null, 2), "utf8");
  const res = await handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[0], body: { data: minimalState(), baseSha: first.sha } }));
  assert.equal(res.status, 409);
  const body = await readJson(res);
  assert.equal(body.error, "conflict");
  assert.equal(typeof body.sha, "string");
  assert.equal(body.data.projects[0].name, "Palazzo Ricci", "conflict returns the current server copy for adoption");
  assert.equal(emu.calls.filter((c) => c.method === "PUT").length, 0, "no write issued on stale sha");
  assert.equal(JSON.parse(fs.readFileSync(dataFile, "utf8")).projects[0].name, "Palazzo Ricci", "external write not overwritten");
});

test("null baseSha only allowed when file does not exist", async () => {
  const seeded = setup({ seed: legacySeed() });
  const res1 = await seeded.handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[0], body: { data: minimalState(), baseSha: null } }));
  assert.equal(res1.status, 409, "refuses to silently replace existing file");
  assert.equal(JSON.parse(fs.readFileSync(seeded.dataFile, "utf8")).projects[0].name, "Legacy Project");
  const fresh = setup();
  const res2 = await fresh.handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[0], body: { data: minimalState(), baseSha: null } }));
  assert.equal(res2.status, 200, "creates the file on first save");
  assert.equal(JSON.parse(fs.readFileSync(fresh.dataFile, "utf8")).schemaVersion, 3);
});

test("write conflict arising during storage commit still returns 409", async () => {
  const { handler, dataFile } = setup({
    seed: legacySeed(),
    wrapFetch: (inner) => async (url, init) => {
      if ((init.method || "GET") === "PUT") {
        fs.writeFileSync(dataFile, JSON.stringify(seededState(), null, 2), "utf8");
      }
      return inner(url, init);
    }
  });
  const first = await readJson(await handler(makeReq("GET", "/api/data", { token: TEAM_TOKENS[0] })));
  const res = await handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[0], body: { data: minimalState(), baseSha: first.sha } }));
  assert.equal(res.status, 409);
  const body = await readJson(res);
  assert.equal(body.error, "conflict");
  assert.equal(JSON.parse(fs.readFileSync(dataFile, "utf8")).projects[0].name, "Palazzo Ricci", "racing writer's data wins, no silent overwrite");
});

test("legacy and future schema payloads are rejected with distinct errors", async () => {
  const { handler } = setup({ seed: legacySeed() });
  const first = await readJson(await handler(makeReq("GET", "/api/data", { token: TEAM_TOKENS[0] })));
  const noVersion = await handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[0], body: { data: { projects: [] }, baseSha: first.sha } }));
  assert.equal(noVersion.status, 400);
  assert.equal((await readJson(noVersion)).error, "schema-migration-required");
  const v1 = await handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[0], body: { data: { schemaVersion: 1, projects: [] }, baseSha: first.sha } }));
  assert.equal(v1.status, 400);
  assert.equal((await readJson(v1)).error, "schema-migration-required");
  const future = await handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[0], body: { data: { schemaVersion: 4 }, baseSha: first.sha } }));
  assert.equal(future.status, 426);
  const futureBody = await readJson(future);
  assert.equal(futureBody.error, "unsupported-schema-version");
  assert.match(futureBody.message, /newer version/);
  assert.match(futureBody.message, /supports up to v3/);
});

test("structurally invalid state is rejected and file untouched", async () => {
  const { handler, dataFile } = setup({ seed: legacySeed() });
  const first = await readJson(await handler(makeReq("GET", "/api/data", { token: TEAM_TOKENS[0] })));
  const bad = seededState();
  bad.projects[0].engagements[0].investorId = "ghost";
  const res = await handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[0], body: { data: bad, baseSha: first.sha } }));
  assert.equal(res.status, 400);
  const body = await readJson(res);
  assert.equal(body.error, "invalid-state");
  assert.match(body.message, /unknown investor/);
  assert.equal(JSON.parse(fs.readFileSync(dataFile, "utf8")).projects[0].name, "Legacy Project");
  const badStage = seededState();
  badStage.projects[0].engagements[0].stage = "committedish";
  const res2 = await handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[0], body: { data: badStage, baseSha: first.sha } }));
  assert.equal(res2.status, 400);
  assert.match((await readJson(res2)).message, /unknown stage/);
});

test("oversized and malformed bodies are rejected", async () => {
  const { handler } = setup({ seed: legacySeed() });
  const first = await readJson(await handler(makeReq("GET", "/api/data", { token: TEAM_TOKENS[0] })));
  const big = minimalState();
  big.padding = "x".repeat(900001);
  const oversize = await handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[0], body: { data: big, baseSha: first.sha } }));
  assert.equal(oversize.status, 413);
  const notJson = await handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[0], raw: "{not json" }));
  assert.equal(notJson.status, 400);
  assert.equal((await readJson(notJson)).error, "invalid-json");
  const missingData = await handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[0], raw: "{}" }));
  assert.equal(missingData.status, 400);
  assert.equal((await readJson(missingData)).error, "missing-data");
  const badBase = await handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[0], body: { data: minimalState(), baseSha: 12345 } }));
  assert.equal(badBase.status, 400);
  assert.equal((await readJson(badBase)).error, "invalid-base-sha");
});

test("unknown paths, methods and traversal attempts are refused", async () => {
  const { handler, emu } = setup({ seed: legacySeed() });
  const other = await handler(makeReq("GET", "/api/other", { token: TEAM_TOKENS[0] }));
  assert.equal(other.status, 404);
  const root = await handler(makeReq("GET", "/", { token: TEAM_TOKENS[0] }));
  assert.equal(root.status, 404);
  const post = await handler(makeReq("POST", "/api/data", { token: TEAM_TOKENS[0], body: {} }));
  assert.equal(post.status, 405);
  const evil = await handler(makeReq("GET", "/api/data/../../admin", { token: TEAM_TOKENS[0] }));
  assert.equal(evil.status, 404);
  assert.ok(emu.calls.every((c) => c.url === emu.getUrl), "storage never reached for refused requests");
});

test("CORS policy is enforced per origin but is never the authentication mechanism", async () => {
  const { handler } = setup({ seed: legacySeed() });
  const preflight = await handler(makeReq("OPTIONS", "/api/data", { origin: "https://suzana991.github.io" }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "https://suzana991.github.io");
  assert.equal(preflight.headers.get("Access-Control-Allow-Headers"), "Authorization, Content-Type");
  const evilPreflight = await handler(makeReq("OPTIONS", "/api/data", { origin: "https://evil.example" }));
  assert.equal(evilPreflight.status, 204, "preflight answered without granting the unknown origin");
  assert.equal(evilPreflight.headers.get("Access-Control-Allow-Origin"), null);
  const unauthAllowedOrigin = await handler(makeReq("GET", "/api/data", { origin: "https://suzana991.github.io" }));
  assert.equal(unauthAllowedOrigin.status, 401, "allowed origin without token is still rejected");
  const authed = await handler(makeReq("GET", "/api/data", { token: TEAM_TOKENS[0], origin: "https://suzana991.github.io" }));
  assert.equal(authed.status, 200);
  assert.equal(authed.headers.get("Access-Control-Allow-Origin"), "https://suzana991.github.io");
  const badOrigin = await handler(makeReq("GET", "/api/data", { token: TEAM_TOKENS[0], origin: "https://evil.example" }));
  assert.equal(badOrigin.status, 200);
  assert.equal(badOrigin.headers.get("Access-Control-Allow-Origin"), null, "disallowed origin gets no CORS grant");
});

test("missing server configuration fails closed without echoing config", async () => {
  const handler = createHandler({}, async () => new Response("{}", { status: 200 }));
  const res = await handler(makeReq("GET", "/api/data", { token: "anything" }));
  assert.equal(res.status, 500);
  const body = await readJson(res);
  assert.equal(body.error, "server-not-configured");
  assert.ok(!JSON.stringify(body).includes("GITHUB_TOKEN"));
});

test("storage backend failure surfaces as 502 without credential leakage", async () => {
  const { handler } = setup({
    seed: legacySeed(),
    wrapFetch: () => async () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401, headers: { "Content-Type": "application/json" } })
  });
  const res = await handler(makeReq("GET", "/api/data", { token: TEAM_TOKENS[0] }));
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.ok(!text.includes(GH_TOKEN));
  assert.ok(!text.includes("Bad credentials"), "upstream error detail not forwarded");
  assert.equal(JSON.parse(text).error, "storage-unavailable");
});

test("end-to-end: migrated state round-trips through the API unchanged", async () => {
  const { handler, dataFile } = setup({ seed: legacySeed() });
  const first = await readJson(await handler(makeReq("GET", "/api/data", { token: TEAM_TOKENS[0] })));
  const fixture = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "..", "tests", "fixtures", "legacy-data.json"), "utf8").replace(/^\uFEFF/, ""));
  const M = await import("../../migration.js").then((m) => m.default || m);
  const migrated = M.migrate(fixture, { now: "2026-10-08T00:00:00.000Z" });
  const save = await handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[0], body: { data: migrated.state, baseSha: first.sha } }));
  assert.equal(save.status, 200);
  const reload = await readJson(await handler(makeReq("GET", "/api/data", { token: TEAM_TOKENS[1] })));
  assert.equal(reload.data.schemaVersion, 3);
  assert.equal(reload.data.investors.length, 73);
  assert.equal(reload.data.tasks.length, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(dataFile, "utf8")), migrated.state);
  const repeatSave = await handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[0], body: { data: reload.data, baseSha: reload.sha } }));
  assert.equal(repeatSave.status, 200, "saving the same reloaded state again succeeds");
  const final = await readJson(await handler(makeReq("GET", "/api/data", { token: TEAM_TOKENS[0] })));
  assert.equal(final.data.investors.length, 73, "no duplication after save/reload/save cycle");
  assert.equal(final.data.tasks.length, 2);
  assert.equal(final.data.activities.length, 1);
});

let MIGRATION_MODULE = null;
async function migrationModule() {
  if (!MIGRATION_MODULE) MIGRATION_MODULE = await import("../../migration.js").then((m) => m.default || m);
  return MIGRATION_MODULE;
}

test("changelog: GET requires auth, returns feed shape and a migration save is attributed", async () => {
  const M = await migrationModule();
  const fixture = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "..", "tests", "fixtures", "legacy-data.json"), "utf8").replace(/^\uFEFF/, ""));
  const migrated = M.migrate(fixture, { now: "2026-10-08T00:00:00.000Z" }).state;
  const { handler, emu, changeFile } = setup({ seed: legacySeed() });

  const noAuth = await handler(makeReq("GET", "/api/changelog"));
  assert.equal(noAuth.status, 401);
  const badAuth = await handler(makeReq("GET", "/api/changelog", { token: "not-a-team-token" }));
  assert.equal(badAuth.status, 401);
  assert.equal(emu.calls.length, 0, "no storage request happens before authentication");

  const empty = await readJson(await handler(makeReq("GET", "/api/changelog", { token: TEAM_TOKENS[0] })));
  assert.deepEqual(empty.items, []);
  assert.equal(empty.sha, null);
  assert.equal(typeof empty.dataSha, "string", "dataSha points at the current data blob even when no changelog exists");

  const first = await readJson(await handler(makeReq("GET", "/api/data", { token: TEAM_TOKENS[0] })));
  const save = await handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[1], body: { data: migrated, baseSha: first.sha } }));
  assert.equal(save.status, 200);
  const putResult = await readJson(save);

  const feed = await readJson(await handler(makeReq("GET", "/api/changelog", { token: TEAM_TOKENS[0] })));
  const text = JSON.stringify(feed);
  assert.ok(!text.includes(GH_TOKEN));
  for (const t of TEAM_TOKENS) assert.ok(!text.includes(t), "team tokens absent from changelog payload");
  assert.equal(feed.items.length, 1);
  const entry = feed.items[0];
  assert.equal(entry.user, "Beta");
  assert.match(entry.summary, /Migrated the dataset to schema v3/);
  assert.match(entry.summary, /investors/);
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(entry.ts));
  assert.equal(typeof entry.id, "string");
  assert.equal(typeof feed.sha, "string");
  assert.equal(feed.dataSha, putResult.sha, "changelog reflects the current data blob sha");
  const onDisk = JSON.parse(fs.readFileSync(changeFile, "utf8"));
  assert.equal(onDisk.items[0].summary, entry.summary);
  const readUrls = emu.calls.filter((c) => c.method === "GET").map((c) => c.url);
  assert.ok(readUrls.includes(buildFileUrl(GITHUB_CFG)), "data read stays scoped to data.json");
  assert.ok(readUrls.includes(buildFileUrl(GITHUB_CHANGE_CFG)), "changelog read stays scoped to changelog.json");
});

test("changelog: re-saving identical state adds no new entry", async () => {
  const M = await migrationModule();
  const fixture = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "..", "tests", "fixtures", "legacy-data.json"), "utf8").replace(/^\uFEFF/, ""));
  const { handler } = setup({ seed: legacySeed() });
  const first = await readJson(await handler(makeReq("GET", "/api/data", { token: TEAM_TOKENS[0] })));
  const migrated = M.migrate(fixture, { now: "2026-10-08T00:00:00.000Z" }).state;
  const save = await handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[1], body: { data: migrated, baseSha: first.sha } }));
  assert.equal(save.status, 200);
  const reload = await readJson(await handler(makeReq("GET", "/api/data", { token: TEAM_TOKENS[0] })));
  const again = await handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[0], body: { data: reload.data, baseSha: reload.sha } }));
  assert.equal(again.status, 200, "saving the same reloaded state succeeds");
  const feed = await readJson(await handler(makeReq("GET", "/api/changelog", { token: TEAM_TOKENS[0] })));
  assert.equal(feed.items.length, 1, "nothing extra logged for a no-op save");
});

test("changelog: regular edits produce a targeted summary and entries are capped", async () => {
  const { handler } = setup({ seed: JSON.stringify(seededState()) });
  const first = await readJson(await handler(makeReq("GET", "/api/data", { token: TEAM_TOKENS[0] })));
  const next1 = seededState();
  next1.investors[0].name = "Test Bank Europe";
  const save1 = await handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[0], body: { data: next1, baseSha: first.sha } }));
  assert.equal(save1.status, 200);
  const reload = await readJson(await handler(makeReq("GET", "/api/data", { token: TEAM_TOKENS[0] })));
  const next2 = JSON.parse(JSON.stringify(reload.data));
  next2.projects[0].engagements[0].stage = "awaiting_response";
  next2.projects[0].engagements[0].owner = "Bruno";
  next2.investors[0].contacts.push({ id: "c2", name: "Jane" });
  next2.projects[0].engagements[0].contactIds = ["c2"];
  next2.tasks.push({ id: "task1", title: "Send deck on Palazzo Ricci", status: "To do", kind: "task", projectId: "proj1", engagementId: "eng1" });
  const save2 = await handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[0], body: { data: next2, baseSha: reload.sha } }));
  assert.equal(save2.status, 200);

  const feed = await readJson(await handler(makeReq("GET", "/api/changelog", { token: TEAM_TOKENS[1] })));
  assert.equal(feed.items.length, 2);
  const second = feed.items[0];
  const firstEntry = feed.items[1];
  assert.equal(firstEntry.user, "Alpha");
  assert.match(firstEntry.summary, /updated investor/);
  assert.equal(second.user, "Alpha");
  assert.match(second.summary, /awaiting_response/);
  assert.match(second.summary, /re-assigned/);
  assert.match(second.summary, /added task/);
  assert.match(second.summary, /New contact/);

  const capped = setup({
    seed: JSON.stringify(next1),
    changelogSeed: JSON.stringify({ items: Array.from({ length: 200 }, (_, i) => ({ id: "old" + i, ts: "2026-01-01T00:00:00.000Z", user: "Alpha", summary: "old " + i })) })
  });
  const base = await readJson(await capped.handler(makeReq("GET", "/api/data", { token: TEAM_TOKENS[0] })));
  const capSave = await capped.handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[0], body: { data: next2, baseSha: base.sha } }));
  assert.equal(capSave.status, 200);
  const feed2 = await readJson(await capped.handler(makeReq("GET", "/api/changelog", { token: TEAM_TOKENS[0] })));
  assert.equal(feed2.items.length, 200);
  assert.equal(feed2.items[0].summary, second.summary);
  assert.equal(feed2.items[199].id, "old198", "oldest entry dropped when the cap is exceeded");
});

test("changelog: revoking a delivery step is summarized", async () => {
  const seed = seededState();
  seed.projects[0].deliveryStage = "onboarding";
  seed.projects[0].stageHistory = [{ id: "h1", from: null, to: "onboarding", date: "2026-10-01", by: "Alpha", note: "" }];
  const { handler } = setup({ seed: JSON.stringify(seed) });
  const first = await readJson(await handler(makeReq("GET", "/api/data", { token: TEAM_TOKENS[0] })));
  const next = JSON.parse(JSON.stringify(first.data));
  next.projects[0].stageHistory = [];
  next.projects[0].deliveryStage = null;
  const save = await handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[0], body: { data: next, baseSha: first.sha } }));
  assert.equal(save.status, 200);
  const feed = await readJson(await handler(makeReq("GET", "/api/changelog", { token: TEAM_TOKENS[0] })));
  assert.equal(feed.items.length, 1);
  assert.match(feed.items[0].summary, /Revoked 1 delivery step on Palazzo Ricci/);
  assert.match(feed.items[0].summary, /left delivery stage/);

  const seed2 = seededState();
  seed2.projects[0].deliveryStage = "closing";
  seed2.projects[0].stageHistory = [
    { id: "h1", from: null, to: "onboarding", date: "2026-10-01", by: "Alpha", note: "" },
    { id: "h2", from: "onboarding", to: "due_diligence", date: "2026-10-02", by: "Alpha", note: "" },
    { id: "h3", from: "due_diligence", to: "closing", date: "2026-10-03", by: "Alpha", note: "" }
  ];
  const { handler: h2 } = setup({ seed: JSON.stringify(seed2) });
  const base2 = await readJson(await h2(makeReq("GET", "/api/data", { token: TEAM_TOKENS[1] })));
  const next2 = JSON.parse(JSON.stringify(base2.data));
  const now = next2.projects[0].stageHistory.filter(function (x) { return x.id !== "h2"; });
  next2.projects[0].stageHistory = now;
  const save2 = await h2(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[1], body: { data: next2, baseSha: base2.sha } }));
  assert.equal(save2.status, 200);
  const feed2 = await readJson(await h2(makeReq("GET", "/api/changelog", { token: TEAM_TOKENS[1] })));
  assert.match(feed2.items[0].summary, /Revoked 1 delivery step on Palazzo Ricci/);
  assert.doesNotMatch(feed2.items[0].summary, /delivery stage/);
});

test("changelog: a failed changelog write never fails the data save", async () => {
  const { handler, dataFile } = setup({
    seed: JSON.stringify(seededState()),
    wrapFetch: (inner) => async (url, init) => {
      if ((init.method || "GET") === "PUT" && String(url).includes("changelog.json")) {
        return new Response(JSON.stringify({ message: "boom" }), { status: 502 });
      }
      return inner(url, init);
    }
  });
  const first = await readJson(await handler(makeReq("GET", "/api/data", { token: TEAM_TOKENS[0] })));
  const next = seededState();
  next.investors[0].name = "Renamed";
  const save = await handler(makeReq("PUT", "/api/data", { token: TEAM_TOKENS[0], body: { data: next, baseSha: first.sha } }));
  assert.equal(save.status, 200, "data save succeeds even though the changelog write fails");
  assert.equal(JSON.parse(fs.readFileSync(dataFile, "utf8")).investors[0].name, "Renamed");
});
