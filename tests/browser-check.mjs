import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(path.join(process.env.TEMP || process.env.HOME || ".", "pw", "package.json"));
const { chromium } = require("playwright-core");

const BASE = "http://127.0.0.1:8788";
const TOKEN = process.env.CRM_TOKEN || "dev-token";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const SHOTS = path.join(process.env.TEMP || ".", "crm-shots");
fs.mkdirSync(SHOTS, { recursive: true });

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

function watch(page) {
  page.on("pageerror", (e) => {
    const text = "pageerror: " + (e.stack || e.message);
    consoleErrors.push(text);
    console.log("[captured] " + text);
  });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (text.indexOf("favicon") !== -1) return;
    consoleErrors.push("console: " + text);
  });
}

async function shot(page, name) {
  const file = path.join(SHOTS, name + ".png");
  await page.screenshot({ path: file, fullPage: false });
  return file;
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
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error("timeout waiting for " + desc + (lastErr ? " (last: " + lastErr.message + ")" : ""));
}

async function waitSaved(page) {
  await waitFor(async () => {
    const t = await page.textContent("#save-status-text");
    return /^Saved/.test(t);
  }, 10000, "save status to settle on Saved");
}

async function login(page, token) {
  await page.goto(BASE + "/#key=" + token, { waitUntil: "networkidle" });
}

async function waitReady(page) {
  await page.waitForSelector(".project-row", { timeout: 15000 });
  await page.waitForFunction(() => {
    const t = document.getElementById("save-status-text");
    return t && /^(Saved|Loaded)/.test(t.textContent);
  }, null, { timeout: 15000 });
}

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });

  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctxA.newPage();
  watch(page);
  page.on("dialog", (d) => d.accept().catch(() => {}));

  console.log("--- first access via private link + legacy migration ---");
  await login(page, TOKEN);
  await waitReady(page);
  check("access key stripped from URL after first open", page.url().indexOf("#") === -1, page.url());
  let putCount = 0;
  await page.route("**/api/data", async (route) => {
    if (route.request().method() === "PUT") putCount++;
    await route.continue();
  });
  const projects = await page.locator(".project-row-name").allTextContents();
  check("projects migrated (Palazzo Ricci, MBI)", projects.includes("Palazzo Ricci") && projects.includes("MBI"), projects.join(","));
  const statusText = await page.textContent("#save-status-text");
  check("migration auto-saved", /^Saved/.test(statusText), statusText);
  check("overview title", (await page.textContent("#view-title")) === "Overview");
  const statCards = await page.locator(".stat-card").count();
  check("overview stat cards rendered", statCards >= 6, statCards);
  const investorsStat = await page.locator(".stat-card").first().locator(".stat-value").textContent();
  await shot(page, "01-overview");

  console.log("--- tracker ---");
  await page.click('[data-nav="tracker"]');
  await page.click('.project-row:has-text("Palazzo Ricci")');
  await page.waitForSelector("#view-tracker .data-table", { timeout: 8000 });
  const rows = await page.locator("#view-tracker tbody tr").count();
  check("tracker shows 73 engagement rows", rows === 73, rows);
  const legend = await page.textContent("#view-tracker .legend");
  check("tracker legend shows counts", legend.indexOf("73") !== -1, legend);
  await shot(page, "02-tracker");

  console.log("--- directory + contact display fallback ---");
  await page.click('[data-nav="directory"]');
  await page.waitForSelector("#view-directory .data-table", { timeout: 8000 });
  const dirRows = await page.locator("#view-directory tbody tr").count();
  check("directory shows 73 investors", dirRows === 73, dirRows);
  await shot(page, "03-directory");
  await page.fill("#view-directory .input-search", "Banca");
  await page.waitForTimeout(200);
  const filtered = await page.locator("#view-directory tbody tr").count();
  check("directory search filters", filtered >= 1 && filtered < 73, filtered);
  await page.fill("#view-directory .input-search", "");
  await page.fill("#view-directory .input-search", "federico.silva@maslowcapital.com");
  await page.waitForTimeout(250);
  const emailHit = await page.locator("#view-directory tbody tr").count();
  check("directory search finds contact by email", emailHit === 1, emailHit);
  await page.click("#view-directory tbody tr:first-child");
  await page.waitForSelector("#detail-drawer:not(.hidden)", { timeout: 5000 });
  const fallbackPrimary = await page.textContent("#detail-body .contact-primary");
  check("nameless contact falls back to title", fallbackPrimary.indexOf("Head of Origination") !== -1, fallbackPrimary);
  await page.click("#detail-close");
  await page.fill("#view-directory .input-search", "");
  await page.click("#view-directory tbody tr:first-child");
  await page.waitForSelector("#detail-drawer:not(.hidden)", { timeout: 5000 });
  const contactPrimaries = await page.locator("#detail-body .contact-primary").allTextContents();
  const allHaveDisplay = contactPrimaries.every((t) => t.trim().length > 0 && t !== "Unnamed contact");
  check("every visible contact has a display name", allHaveDisplay, JSON.stringify(contactPrimaries.slice(0, 5)));
  const legacyBox = await page.locator("#detail-body .legacy-box").count();
  check("legacy record preserved in detail drawer", legacyBox >= 1, legacyBox);
  await shot(page, "04-detail-drawer");
  await page.click("#detail-close");

  console.log("--- create investor / contact / engagement / activity / task ---");
  await page.click('[data-nav="directory"]');
  await page.click("#primary-action-btn");
  await page.waitForSelector("#modal-backdrop:not(.hidden)");
  await page.fill('#modal-body input[name="name"]', "Browser Test Capital");
  await page.fill('#modal-body input[name="type"]', "Family office");
  await page.click("#modal-submit");
  await page.waitForSelector("#detail-drawer:not(.hidden)", { timeout: 5000 });
  check("new investor opens in drawer", (await page.textContent("#detail-name")) === "Browser Test Capital");
  await shot(page, "05-new-investor-drawer");

  await page.click('#detail-body [data-action="add-contact"]');
  await page.waitForSelector("#modal-backdrop:not(.hidden)");
  await page.fill('#modal-body input[name="name"]', "Test Person");
  await page.fill('#modal-body input[name="title"]', "Partner");
  await page.fill('#modal-body input[name="email"]', "general: not-an-email");
  await page.click("#modal-submit");
  await page.waitForSelector("#detail-body .contact-card", { timeout: 5000 });
  const contactName = await page.textContent("#detail-body .contact-primary");
  check("contact saved and displayed", contactName === "Test Person", contactName);
  const flags = await page.locator("#detail-body .contact-card .flag").allTextContents();
  check("invalid email flagged not blocked", flags.some((f) => f.indexOf("invalid-email") !== -1), flags.join(","));

  await page.click('#detail-body [data-action="add-engagement"]');
  await page.waitForSelector("#modal-backdrop:not(.hidden)");
  await page.selectOption('#modal-body select[name="projectId"]', { label: "Palazzo Ricci" });
  await page.click("#modal-submit");
  await page.waitForSelector("#detail-body .engagement-block", { timeout: 5000 });
  check("engagement created in project", true);
  const engBlocks = await page.locator("#detail-body .engagement-block").count();
  check("engagement block visible", engBlocks === 1, engBlocks);

  await page.click('#detail-body .engagement-block [data-action="log-activity"]');
  await page.waitForSelector("#modal-backdrop:not(.hidden)");
  await page.fill('#modal-body textarea[name="summary"]', "Browser test outreach call");
  await page.click("#modal-submit");
  await page.waitForFunction(() => document.querySelector("#detail-body .activity-summary") &&
    document.querySelector("#detail-body .activity-summary").textContent.indexOf("Browser test outreach call") !== -1,
    null, { timeout: 5000 });
  check("activity logged into timeline", true);
  await shot(page, "06-activity-logged");
  await page.click("#detail-close");

  await page.click('[data-nav="tasks"]');
  await page.click("#primary-action-btn");
  await page.waitForSelector("#modal-backdrop:not(.hidden)");
  await page.fill('#modal-body input[name="title"]', "Browser test task");
  await page.fill('#modal-body input[name="dueDate"]', "2026-10-30");
  const putsBeforeTask = putCount;
  await page.click("#modal-submit");
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".task-title"))
    .some((el) => el.textContent.indexOf("Browser test task") !== -1), null, { timeout: 5000 });
  check("task created", true);
  await waitFor(() => putCount >= putsBeforeTask + 1, 8000, "task PUT to reach server");
  await waitSaved(page);
  await shot(page, "07-tasks");

  console.log("--- reload persistence ---");
  await page.unroute("**/api/data");
  await page.reload({ waitUntil: "networkidle" });
  await waitReady(page);
  check("no re-login needed after reload", await page.isHidden("#access-overlay"));
  await page.click('[data-nav="directory"]');
  await page.fill("#view-directory .input-search", "Browser Test Capital");
  await page.waitForTimeout(250);
  const persistedInvestor = await page.locator("#view-directory tbody tr").count();
  check("investor persisted across reload", persistedInvestor === 1, persistedInvestor);
  await page.fill("#view-directory .input-search", "");
  await page.click('[data-nav="tasks"]');
  const persistedTask = await page.locator(".task-title").allTextContents();
  check("task persisted across reload", persistedTask.some((t) => t.indexOf("Browser test task") !== -1), persistedTask.join(";"));
  await page.click('[data-nav="overview"]');

  console.log("--- JSON export ---");
  await page.click(".side-maintenance > summary");
  const dlPromise = page.waitForEvent("download", { timeout: 8000 });
  await page.click('.side-actions [data-action="export-json"]');
  const dl = await dlPromise;
  check("JSON export downloads", dl.suggestedFilename().indexOf(".json") !== -1, dl.suggestedFilename());

  console.log("--- failed save and retry ---");
  await page.route("**/api/data", (route) => {
    if (route.request().method() === "PUT") route.abort();
    else route.continue();
  });
  await page.click('[data-nav="directory"]');
  await page.click("#primary-action-btn");
  await page.waitForSelector("#modal-backdrop:not(.hidden)");
  await page.fill('#modal-body input[name="name"]', "Offline Test Fund");
  await page.click("#modal-submit");
  await page.waitForFunction(() => {
    const t = document.getElementById("save-status-text");
    return t && t.textContent.indexOf("Save failed") !== -1;
  }, null, { timeout: 8000 });
  check("failed save surfaces in status", true);
  await shot(page, "08-save-failed");
  await page.unroute("**/api/data");
  await page.waitForFunction(() => /^Saved/.test(document.getElementById("save-status-text").textContent),
    null, { timeout: 25000 });
  check("automatic retry recovers after outage", true);
  if (await page.isVisible("#detail-drawer")) await page.click("#detail-close");

  console.log("--- unauthorized access ---");
  const ctxBad = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const pageBad = await ctxBad.newPage();
  watch(pageBad);
  await login(pageBad, "wrong-token");
  await pageBad.waitForSelector("#access-overlay:not(.hidden)", { timeout: 8000 });
  const errText = await pageBad.textContent("#access-overlay");
  check("invalid key shows access-link message", errText.indexOf("Open your private access link") !== -1, errText);
  check("no login form exists", (await pageBad.locator("#login-token").count()) === 0);
  check("invalid key stripped from URL", pageBad.url().indexOf("#") === -1, pageBad.url());
  await shot(pageBad, "09-unauthorized");
  await ctxBad.close();

  console.log("--- concurrent edit conflict ---");
  await page.waitForFunction(() => /^Saved/.test(document.getElementById("save-status-text").textContent), null, { timeout: 10000 });
  const ctxB = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const pageB = await ctxB.newPage();
  watch(pageB);
  pageB.on("dialog", (d) => d.accept().catch(() => {}));
  await login(pageB, TOKEN);
  await waitReady(pageB);
  await pageB.click('[data-nav="directory"]');
  await pageB.click("#primary-action-btn");
  await pageB.waitForSelector("#modal-backdrop:not(.hidden)");
  await pageB.fill('#modal-body input[name="name"]', "Concurrent B Fund");
  await pageB.click("#modal-submit");
  await pageB.waitForFunction(() => /^Saved/.test(document.getElementById("save-status-text").textContent),
    null, { timeout: 10000 });

  await page.click('[data-nav="directory"]');
  await page.click("#primary-action-btn");
  await page.waitForSelector("#modal-backdrop:not(.hidden)");
  await page.fill('#modal-body input[name="name"]', "Concurrent A Fund");
  await page.click("#modal-submit");
  await page.waitForSelector("#conflict-backdrop:not(.hidden)", { timeout: 10000 });
  check("409 conflict shown to second writer", true);
  const conflictText = await page.textContent("#conflict-text");
  check("conflict dialog explains choice", conflictText.indexOf("server") !== -1, conflictText);
  await shot(page, "10-conflict");
  await page.click("#conflict-overwrite");
  await page.waitForFunction(() => /^Saved/.test(document.getElementById("save-status-text").textContent),
    null, { timeout: 10000 });
  check("explicit overwrite resolves conflict", true);
  const finalData = await page.evaluate(async (token) => {
    const res = await fetch("http://127.0.0.1:8788/api/data", {
      headers: { Authorization: "Bearer " + token }
    });
    return res.json();
  }, TOKEN);
  const names = finalData.data.investors.map((i) => i.name);
  check("winning write stored", names.indexOf("Concurrent A Fund") !== -1, names.join(","));
  check("losing write not silently merged", names.indexOf("Concurrent B Fund") === -1, names.join(","));

  const filteredErrors = consoleErrors.filter((e) =>
    e.indexOf("favicon") === -1 &&
    e.indexOf("Failed to load resource") === -1 &&
    e.indexOf("ERR_FAILED") === -1);
  check("no page errors during session", filteredErrors.length === 0, filteredErrors.join(" | "));

  await ctxB.close();
  await ctxA.close();
  await browser.close();

  console.log("\n=== browser checks: " + passed + " passed, " + failed + " failed ===");
  console.log("screenshots: " + SHOTS);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("BROWSER CHECK CRASH:", e && e.stack ? e.stack : e);
  process.exit(1);
});
