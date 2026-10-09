import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(path.join(process.env.TEMP || ".", "pw", "package.json"));
const { chromium } = require("playwright-core");

const PAGES_URL = (process.env.CRM_LIVE_URL || "https://suzana991.github.io/hartmann-crm").replace(/\/+$/, "");
const API_URL = process.env.CRM_LIVE_API || "";
const KEY_FILE = process.env.CRM_LIVE_KEY_FILE || path.join(process.env.TEMP || ".", "hartmann-live-key.txt");
const EXPECT_FILE = process.env.CRM_LIVE_EXPECT || path.join(process.env.TEMP || ".", "hartmann-live-expect.json");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const FRONTEND_FILES = ["index.html", "config.js", "util.js", "migration.js", "persistence.js", "views.js", "modals.js", "app.js"];
const MARKER = "ZZVERIFY";

let passed = 0;
let failed = 0;
const consoleErrors = [];

function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log("PASS " + name);
  } else {
    failed++;
    console.log("FAIL " + name + (extra !== undefined ? " — " + String(extra) : ""));
  }
}

async function waitFor(nodeFn, timeout, desc) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < timeout) {
    try {
      if (await nodeFn()) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("timeout waiting for " + desc + (lastErr ? " (last: " + lastErr.message + ")" : ""));
}

async function waitSaved(page) {
  await waitFor(async () => /^(Saved|Loaded)/.test(await page.textContent("#save-status-text")), 15000, "status Saved or Loaded");
}

async function waitReady(page) {
  await page.waitForSelector(".project-row", { timeout: 20000 });
  await page.waitForFunction(() => {
    const t = document.getElementById("save-status-text");
    return t && /^(Saved|Loaded)/.test(t.textContent);
  }, null, { timeout: 20000 });
}

function watch(page) {
  page.on("pageerror", (e) => {
    const text = "pageerror: " + (e.stack || e.message);
    consoleErrors.push(text);
    console.log("[captured] " + text);
  });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (t.indexOf("favicon") !== -1) return;
    consoleErrors.push("console: " + t);
  });
}

async function main() {
  if (!API_URL) throw new Error("CRM_LIVE_API env (worker URL) is required");
  if (!fs.existsSync(KEY_FILE)) throw new Error("key file missing: " + KEY_FILE);
  if (!fs.existsSync(EXPECT_FILE)) throw new Error("expectations file missing: " + EXPECT_FILE);
  const KEY = fs.readFileSync(KEY_FILE, "utf8").trim();
  const EXPECT = JSON.parse(fs.readFileSync(EXPECT_FILE, "utf8"));

  async function curSha() {
    const d = await fetch(API_URL + "/api/data", { headers: { Authorization: "Bearer " + KEY } }).then((r) => r.json());
    return d.sha;
  }
  async function waitSha(prev, desc) {
    await waitFor(async () => {
      const d = await fetch(API_URL + "/api/data", { headers: { Authorization: "Bearer " + KEY } }).then((r) => r.json());
      return !!d.sha && d.sha !== prev;
    }, 20000, "server sha changed after " + desc);
  }

  console.log("--- deployed frontend files ---");
  const frontendTexts = {};
  for (const f of FRONTEND_FILES) {
    const res = await fetch(PAGES_URL + "/" + f);
    const text = await res.text();
    frontendTexts[f] = { ok: res.ok, text };
    check("frontend serves " + f, res.ok && text.length > 0, "status " + res.status);
  }
  const credentialHits = Object.keys(frontendTexts).filter((f) => /ghp_[A-Za-z0-9]/.test(frontendTexts[f].text));
  check("no GitHub credential in any deployed file", credentialHits.length === 0, credentialHits.join(","));
  const configText = frontendTexts["config.js"].text;
  check("config.js points at deployed API", API_URL && configText.indexOf("apiBase") !== -1 && configText.indexOf(API_URL) !== -1,
    configText.trim());

  if (API_URL) {
    console.log("--- API auth and CORS ---");
    const noAuth = await fetch(API_URL + "/api/data");
    check("unauthenticated GET rejected 401", noAuth.status === 401, noAuth.status);
    const noAuthPut = await fetch(API_URL + "/api/data", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { probe: true } })
    });
    check("unauthenticated PUT rejected 401", noAuthPut.status === 401, noAuthPut.status);
    const badKey = await fetch(API_URL + "/api/data", { headers: { Authorization: "Bearer definitely-wrong-key-123" } });
    check("incorrect-key GET rejected 401", badKey.status === 401, badKey.status);
    const badPut = await fetch(API_URL + "/api/data", {
      method: "PUT",
      headers: { Authorization: "Bearer definitely-wrong-key-123", "Content-Type": "application/json" },
      body: JSON.stringify({ data: { probe: true } })
    });
    check("incorrect-key PUT rejected 401", badPut.status === 401, badPut.status);
    const disallowed = await fetch(API_URL + "/api/data", { headers: { Authorization: "Bearer " + KEY, Origin: "https://evil.example" } });
    check("disallowed origin gets no CORS grant", !disallowed.headers.get("access-control-allow-origin"),
      disallowed.headers.get("access-control-allow-origin"));
    const allowed = await fetch(API_URL + "/api/data", { headers: { Authorization: "Bearer " + KEY, Origin: "https://suzana991.github.io" } });
    check("Pages origin gets CORS grant", allowed.headers.get("access-control-allow-origin") === "https://suzana991.github.io",
      allowed.headers.get("access-control-allow-origin"));
    check("authorized GET succeeds", allowed.status === 200, allowed.status);
  }

  console.log("--- live site: first access via private link, records, display ---");
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctxA.newPage();
  watch(page);
  page.on("dialog", (d) => d.accept().catch(() => {}));

  await page.goto(PAGES_URL + "/#key=" + KEY, { waitUntil: "networkidle" });
  await waitReady(page);
  check("private link opens the CRM directly", true);
  check("key stripped from visible URL", page.url().indexOf("#") === -1, page.url());
  const storedKey = await page.evaluate(() => { try { return localStorage.getItem("hartmann-crm-access-key"); } catch (e) { return null; } });
  check("key stored on device", !!storedKey && storedKey === KEY);

  const ctxInvalid = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const pageInvalid = await ctxInvalid.newPage();
  watch(pageInvalid);
  await pageInvalid.goto(PAGES_URL + "/#key=definitely-wrong-key-123", { waitUntil: "networkidle" });
  await pageInvalid.waitForSelector("#access-overlay:not(.hidden)", { timeout: 10000 });
  const invalidMsg = await pageInvalid.textContent("#access-overlay");
  check("invalid key shows access-link message", invalidMsg.indexOf("Open your private access link") !== -1, invalidMsg);
  check("no login form on live site", (await pageInvalid.locator("#login-token").count()) === 0);
  await ctxInvalid.close();

  await waitFor(async () => {
    const d = await fetch(API_URL + "/api/data", { headers: { Authorization: "Bearer " + KEY } }).then((r) => r.json());
    return d.data && d.data.schemaVersion === 3;
  }, 25000, "server data migrated to schema v3");
  const apiNow = await fetch(API_URL + "/api/data", { headers: { Authorization: "Bearer " + KEY } }).then((r) => r.json());
  const st = apiNow.data;
  check("live investor dataset populated", st.investors.length > 0, st.investors.length);
  const baseEngagements = st.projects.reduce((n, p) => n + p.engagements.filter((e) => !e.archived).length, 0);
  check("live engagement dataset populated", baseEngagements > 0, baseEngagements);
  const baseContacts = st.investors.reduce((n, i) => n + i.contacts.length, 0);
  check("live contact dataset populated", baseContacts > 0, baseContacts);
  check("live task list seeded", st.tasks.length >= 4, st.tasks.length);
  const baseTasks = st.tasks.length;
  check("data stored as schema v3", st.schemaVersion === 3, st.schemaVersion);
  check("task templates seeded", Array.isArray(st.taskTemplates) && st.taskTemplates.length > 0,
    Array.isArray(st.taskTemplates) ? st.taskTemplates.length : "missing");
  check("activities array present for v3", Array.isArray(st.activities), typeof st.activities);
  check("legacy backup preserved on server", !!(st.legacyBackup && Object.keys(st.legacyBackup).length > 0));
  check("migration report stored", !!(st.migrationReport && st.migrationReport.counts));

  check("calendar view in navigation", (await page.locator('[data-nav="calendar"]').count()) === 1);
  await page.click('[data-nav="tracker"]');
  await page.waitForSelector("#view-tracker .stage-strip", { timeout: 10000 });
  const stageSegs = await page.locator("#view-tracker .stage-seg").count();
  check("delivery stage strip rendered live", stageSegs === 8, stageSegs);

  console.log("--- deployed build ships revoke (static) ---");
  const viewsSrc = await fetch(PAGES_URL + "/views.js").then((r) => r.text());
  const appSrc = await fetch(PAGES_URL + "/app.js").then((r) => r.text());
  check("deployed build ships the revoke control", viewsSrc.indexOf('data-action="revoke-step"') !== -1, "views.js");
  check("deployed build ships the revoke rollback", appSrc.indexOf('"revoke-step"') !== -1 && appSrc.indexOf("Step revoked") !== -1, "app.js");

  await page.click('[data-nav="directory"]');
  await page.waitForSelector("#view-directory .data-table", { timeout: 10000 });
  const dirRows = await page.locator("#view-directory tbody tr").count();
  const liveInvCount = await fetch(API_URL + "/api/data", { headers: { Authorization: "Bearer " + KEY } }).then((r) => r.json()).then((d) => d.data.investors.length);
  check("directory lists all investors", dirRows === liveInvCount, dirRows + " vs " + liveInvCount);

  if (EXPECT.sampleBlankNameEmail) {
    await page.fill("#view-directory .input-search", EXPECT.sampleBlankNameEmail);
    await page.waitForTimeout(300);
    const hits = await page.locator("#view-directory tbody tr").count();
    check("sample contact findable by email", hits === 1, hits);
    if (hits === 1) {
      await page.click("#view-directory tbody tr:first-child");
      await page.waitForSelector("#detail-drawer:not(.hidden)", { timeout: 8000 });
      const primary = await page.textContent("#detail-body .contact-primary");
      check("contact display fallback works live", primary.trim().length > 0 && primary !== "Unnamed contact", primary);
      const linkedTasks = await page.locator("#detail-body .detail-section").filter({ hasText: "Linked tasks" }).count();
      check("linked tasks section present in detail", linkedTasks === 1, linkedTasks);
      await page.click("#detail-close");
    }
    await page.fill("#view-directory .input-search", "");
  }

  console.log("--- controlled save + reload ---");
  const targetInvestorName = EXPECT.saveTargetInvestor;
  await page.fill("#view-directory .input-search", targetInvestorName);
  await page.waitForTimeout(300);
  await page.click("#view-directory tbody tr:first-child");
  await page.waitForSelector("#detail-drawer:not(.hidden)", { timeout: 8000 });
  await page.click('#detail-body [data-action="add-contact"]');
  await page.waitForSelector("#modal-backdrop:not(.hidden)");
  await page.fill('#modal-body input[name="name"]', MARKER + " Contact");
  await page.fill('#modal-body input[name="email"]', MARKER.toLowerCase() + "@example.com");
  const shaBeforeContact = await curSha();
  await page.click("#modal-submit");
  await waitFor(async () => {
    const texts = await page.locator("#detail-body .contact-primary").allTextContents();
    return texts.some((t) => t.indexOf(MARKER) !== -1);
  }, 8000, "temp contact in drawer");
  await waitSha(shaBeforeContact, "contact add");
  await page.reload({ waitUntil: "networkidle" });
  await waitReady(page);
  await page.click('[data-nav="directory"]');
  await page.fill("#view-directory .input-search", MARKER.toLowerCase() + "@example.com");
  await page.waitForTimeout(300);
  await page.click("#view-directory tbody tr:first-child");
  await page.waitForSelector("#detail-drawer:not(.hidden)", { timeout: 8000 });
  const afterReload = await page.locator("#detail-body .contact-primary").allTextContents();
  check("temp contact survived reload", afterReload.some((t) => t.indexOf(MARKER) !== -1), afterReload.join(";"));
  const markerCard = page.locator("#detail-body .contact-card").filter({ hasText: MARKER }).first();
  const shaBeforeRemove = await curSha();
  await markerCard.locator('[data-action="remove-contact"]').click();
  page.once("dialog", (d) => d.accept().catch(() => {}));
  await waitFor(async () => {
    const texts = await page.locator("#detail-body .contact-primary").allTextContents();
    return !texts.some((t) => t.indexOf(MARKER) !== -1);
  }, 8000, "temp contact removed");
  await waitSha(shaBeforeRemove, "contact remove");
  check("temp contact removed cleanly", true);
  await page.click("#detail-close");

  console.log("--- tasks save + delete ---");
  await page.click('[data-nav="tasks"]');
  await page.click("#primary-action-btn");
  await page.waitForSelector("#modal-backdrop:not(.hidden)");
  await page.fill('#modal-body input[name="title"]', MARKER + " Task A");
  const shaBeforeTaskA = await curSha();
  await page.click("#modal-submit");
  await waitFor(async () => {
    const t = await page.locator(".task-title").allTextContents();
    return t.some((x) => x.indexOf(MARKER + " Task A") !== -1);
  }, 8000, "temp task A created");
  await waitSha(shaBeforeTaskA, "task A create");
  await page.reload({ waitUntil: "networkidle" });
  await waitReady(page);
  await page.click('[data-nav="tasks"]');
  const tasksAfter = await page.locator(".task-title").allTextContents();
  check("temp task survived reload", tasksAfter.some((t) => t.indexOf(MARKER + " Task A") !== -1), tasksAfter.join(";"));
  const taskRowA = page.locator(".task-row").filter({ hasText: MARKER + " Task A" }).first();
  const shaBeforeDeleteA = await curSha();
  await taskRowA.locator('[data-action="delete-task"]').click();
  page.once("dialog", (d) => d.accept().catch(() => {}));
  await waitFor(async () => {
    const t = await page.locator(".task-title").allTextContents();
    return !t.some((x) => x.indexOf(MARKER + " Task A") !== -1);
  }, 8000, "temp task A deleted");
  await waitSha(shaBeforeDeleteA, "task A delete");
  check("temp task deleted cleanly", true);

  console.log("--- conflict handling (two sessions) ---");
  await page.click('[data-nav="tasks"]');
  const ctxB = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const pageB = await ctxB.newPage();
  watch(pageB);
  pageB.on("dialog", (d) => d.accept().catch(() => {}));
  await pageB.goto(PAGES_URL + "/#key=" + KEY, { waitUntil: "networkidle" });
  await waitReady(pageB);
  await waitSaved(page);

  await pageB.click('[data-nav="tasks"]');
  await pageB.click("#primary-action-btn");
  await pageB.waitForSelector("#modal-backdrop:not(.hidden)");
  await pageB.fill('#modal-body input[name="title"]', MARKER + " Task B-first");
  const shaBeforeB = await curSha();
  await pageB.click("#modal-submit");
  await waitFor(async () => {
    const t = await pageB.locator(".task-title").allTextContents();
    return t.some((x) => x.indexOf(MARKER + " Task B-first") !== -1);
  }, 8000, "B task created");
  await waitSha(shaBeforeB, "B task create");

  await page.click("#primary-action-btn");
  await page.waitForSelector("#modal-backdrop:not(.hidden)");
  await page.fill('#modal-body input[name="title"]', MARKER + " Task A-late");
  await page.click("#modal-submit");
  await page.waitForSelector("#conflict-backdrop:not(.hidden)", { timeout: 15000 });
  check("conflict dialog shown on stale save", true);
  await page.click("#conflict-reload");
  await waitSaved(page);
  const tasksAfterConflict = await page.locator(".task-title").allTextContents();
  check("their version loaded (B task present, A task discarded)",
    tasksAfterConflict.some((t) => t.indexOf(MARKER + " Task B-first") !== -1) &&
    !tasksAfterConflict.some((t) => t.indexOf(MARKER + " Task A-late") !== -1),
    tasksAfterConflict.join(";"));

  const taskRowB = page.locator(".task-row").filter({ hasText: MARKER + " Task B-first" }).first();
  const shaBeforeDeleteB = await curSha();
  await taskRowB.locator('[data-action="delete-task"]').click();
  page.once("dialog", (d) => d.accept().catch(() => {}));
  await waitFor(async () => {
    const t = await page.locator(".task-title").allTextContents();
    return !t.some((x) => x.indexOf(MARKER) !== -1);
  }, 8000, "all temp tasks removed");
  await waitSha(shaBeforeDeleteB, "B task delete");

  console.log("--- final cleanup verification ---");
  const finalData = await fetch(API_URL + "/api/data", { headers: { Authorization: "Bearer " + KEY } }).then((r) => r.json());
  const markerLeftovers = JSON.stringify(finalData.data).indexOf(MARKER);
  check("no temporary verification records remain", markerLeftovers === -1);
  const finalContacts = finalData.data.investors.reduce((n, i) => n + i.contacts.length, 0);
  const finalTasks = finalData.data.tasks.length;
  check("contact count restored", finalContacts === baseContacts, finalContacts + " vs " + baseContacts);
  check("task count restored", finalTasks === baseTasks, finalTasks + " vs " + baseTasks);

  console.log("--- recent changes feed (live) ---");
  const feedApi = await fetch(API_URL + "/api/changelog", { headers: { Authorization: "Bearer " + KEY } });
  const feedBody = await feedApi.json();
  check("changelog endpoint reachable", feedApi.status === 200, feedApi.status);
  check("feed has entries after this session's saves", Array.isArray(feedBody.items) && feedBody.items.length >= 4,
    Array.isArray(feedBody.items) ? feedBody.items.length : "missing");
  const feedText = JSON.stringify(feedBody);
  check("changelog response never exposes secrets", feedText.indexOf("ghp_") === -1 && feedText.indexOf(KEY) === -1);
  const feedHead = feedBody.items[0];
  check("feed attributes the live user", feedHead && feedHead.user === "Suzana", feedHead && feedHead.user);
  check("feed summaries are human readable", typeof feedHead.summary === "string" && feedHead.summary.length > 10);
  const liveNow = await fetch(API_URL + "/api/data", { headers: { Authorization: "Bearer " + KEY } }).then((r) => r.json());
  check("feed dataSha matches the stored data", feedBody.dataSha === liveNow.sha, feedBody.dataSha);

  await page.reload({ waitUntil: "networkidle" });
  await waitReady(page);
  const liveBadge = await page.evaluate(() => {
    const b = document.getElementById("updates-badge");
    return { hidden: b.classList.contains("hidden"), n: b.textContent };
  });
  check("live unread badge shows pending changes", !liveBadge.hidden && Number(liveBadge.n) >= 4, JSON.stringify(liveBadge));
  await page.click('[data-nav="updates"]');
  await page.waitForSelector("#view-updates #updates-list", { timeout: 10000 });
  const liveRows = await page.locator("#view-updates .update-row").count();
  check("live feed renders entries", liveRows >= 4, liveRows);
  const liveWho = await page.textContent("#view-updates .update-row .update-who");
  check("live feed shows the actor name", liveWho.trim() === "Suzana", liveWho);
  check("live badge cleared after viewing", await page.isHidden("#updates-badge"));
  check("live stale-data banner hidden when current", await page.isHidden("#stale-banner"));

  const errs = consoleErrors.filter((e) =>
    e.indexOf("favicon") === -1 &&
    e.indexOf("Failed to load resource") === -1 &&
    e.indexOf("ERR_FAILED") === -1);
  check("no page errors during live session", errs.length === 0, errs.join(" | "));

  await ctxB.close();
  await ctxA.close();
  await browser.close();

  console.log("\n=== live checks: " + passed + " passed, " + failed + " failed ===");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("LIVE CHECK CRASH:", e && e.stack ? e.stack : e);
  process.exit(1);
});
