import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(path.join(process.env.TEMP || process.env.HOME || ".", "pw", "package.json"));
const { chromium } = require("playwright-core");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.DASH_PORT || 8789);
const BASE = "http://127.0.0.1:" + PORT;
const TOKEN = process.env.CRM_TOKEN || "dev-token";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const SHOTS = path.join(process.env.TEMP || ".", "crm-shots");
const DATA_FILE = path.join(process.env.TEMP || ".", "hartmann-dash-data.json");
fs.mkdirSync(SHOTS, { recursive: true });

let server = null;
function stopServer() {
  if (server && !server.killed) {
    try { server.kill(); } catch (e) { }
  }
  server = null;
}
process.on("exit", stopServer);

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
  await page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: false });
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
  await waitFor(async () => /^Saved/.test(await page.textContent("#save-status-text")), 12000, "save status Saved");
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
  server = spawn(process.execPath, ["server/src/dev-server.js"], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), DEV_RESET: "1", DEV_DATA_FILE: DATA_FILE }),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  server.stdout.on("data", (d) => { try { fs.appendFileSync(path.join(process.env.TEMP || ".", "dash-server.log"), d); } catch (e) { } });
  server.stderr.on("data", (d) => { try { fs.appendFileSync(path.join(process.env.TEMP || ".", "dash-server.log"), d); } catch (e) { } });
  await waitFor(async () => {
    const res = await fetch(BASE + "/config.js");
    return res.ok;
  }, 10000, "own dev server on port " + PORT);

  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  watch(page);
  page.on("dialog", (d) => d.accept().catch(() => {}));

  console.log("--- load + schema v3 ---");
  await login(page, TOKEN);
  await waitReady(page);

  const remote = await page.evaluate(async (opts) => {
    const res = await fetch(opts.url + "/api/data", { headers: { Authorization: "Bearer " + opts.token } });
    return res.json();
  }, { url: BASE, token: TOKEN });
  check("stored data is schemaVersion 3", remote.data && remote.data.schemaVersion === 3, remote.data && remote.data.schemaVersion);
  const proj = remote.data.projects[0];
  check("project carries agreement object", proj.agreement && typeof proj.agreement.status === "string", JSON.stringify(proj.agreement && proj.agreement.status));
  check("project carries stage history array", Array.isArray(proj.stageHistory));
  check("task templates seeded", Array.isArray(remote.data.taskTemplates) && remote.data.taskTemplates.length > 10, remote.data.taskTemplates && remote.data.taskTemplates.length);
  check("activities carry kind", (remote.data.activities || []).every((a) => typeof a.kind === "string"));

  console.log("--- overview rebuild ---");
  const attention = await page.locator(".attention-card").count();
  check("attention cards rendered", attention === 5, attention);
  check("quick action row rendered", (await page.locator(".quick-row").count()) === 1);
  check("stat cards still rendered", (await page.locator(".stat-card").count()) >= 6);
  await page.click('.attention-card:has-text("Overdue")');
  await page.waitForSelector("#view-tasks .toolbar", { timeout: 5000 });
  const dueVal = await page.inputValue('#view-tasks [data-change="taskDue"]');
  check("overdue card jumps to filtered task list", dueVal === "overdue", dueVal);
  await page.selectOption('#view-tasks [data-change="taskDue"]', "");
  await shot(page, "10-overview-attention");

  console.log("--- record outreach flow + modal validation ---");
  await page.click('[data-nav="overview"]');
  await page.click('[data-action="quick-outreach"]');
  await page.waitForSelector("#modal-backdrop:not(.hidden)");
  await page.selectOption('#modal-body select[name="engagementId"]', { index: 1 });
  const engValue = await page.evaluate(() => {
    const sel = document.querySelector('#modal-body select[name="engagementId"]');
    return { value: sel.value, label: sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : "" };
  });
  check("engagement picker lists engagements", !!engValue.value, JSON.stringify(engValue));
  await page.click("#modal-submit");
  await page.waitForSelector('#modal-body textarea[name="summary"]', { timeout: 5000 });
  await page.click("#modal-submit");
  const errText = await page.textContent("#modal-error");
  check("empty outreach shows inline error", errText.trim().length > 0, errText);
  check("modal stayed open with error", await page.isVisible("#modal-backdrop:not(.hidden)"));
  const today = await page.evaluate(() => window.U.todayISO());
  const todayFmt = await page.evaluate((d) => window.U.fmtDate(d), today);
  await page.fill('#modal-body textarea[name="summary"]', "Dashboard check outreach " + today);
  await page.fill('#modal-body input[name="date"]', today);
  const investorName = engValue.label.split("→").pop().trim();
  await page.click("#modal-submit");
  await waitFor(async () => !(await page.isVisible("#modal-backdrop:not(.hidden)")), 5000, "outreach modal to close");
  await waitSaved(page);
  check("investor from picker identified", investorName.length > 0, investorName);

  await page.click('[data-nav="directory"]');
  await page.fill("#view-directory .input-search", investorName);
  await page.waitForTimeout(250);
  await page.click("#view-directory tbody tr:first-child");
  await page.waitForSelector("#detail-drawer:not(.hidden)");
  const meta = await page.textContent(".engagement-meta");
  check("last outreach updated to today", meta.indexOf(todayFmt) !== -1, meta + " (expected " + todayFmt + ")");

  console.log("--- scoped review count in drawer ---");
  const scoped = await page.evaluate((name) => {
    const inv = App.getState().investors.find((i) => i.name === name);
    return { id: inv ? inv.id : null, n: inv ? Views.investorReviewCount(App.getState(), inv.id) : -1 };
  }, investorName);
  const drawerMeta = await page.textContent("#detail-meta");
  if (scoped.n === 0) {
    check("zero flags show no review count", drawerMeta.indexOf("review items") === -1, drawerMeta);
  } else {
    check("flag count is investor scoped", drawerMeta.indexOf(scoped.n + " review items") !== -1, drawerMeta);
  }

  console.log("--- activity edit ---");
  const beforeSummary = await page.textContent("#detail-body .activity-summary");
  await page.click("#detail-body .activity-row .link-btn:has-text('Edit')");
  await page.waitForSelector('#modal-body textarea[name="summary"]', { timeout: 5000 });
  await page.fill('#modal-body textarea[name="summary"]', "Edited activity " + today);
  await page.click("#modal-submit");
  await waitFor(async () => {
    const t = await page.textContent("#detail-body .activity-summary");
    return t.indexOf("Edited activity") !== -1;
  }, 5000, "edited activity in timeline");
  check("activity edit saved to timeline", true, beforeSummary.slice(0, 40));
  await page.click("#detail-close");

  console.log("--- calendar ---");
  await page.click('[data-nav="calendar"]');
  await page.waitForSelector("#view-calendar .cal-grid", { timeout: 5000 });
  const cells = await page.locator("#view-calendar .cal-cell").count();
  check("month grid rendered", cells >= 28, cells);
  const todayCell = page.locator('#view-calendar .cal-cell.today');
  check("today highlighted", (await todayCell.count()) === 1);
  await todayCell.locator('[data-action="calendar-add"]').click();
  await page.waitForSelector("#modal-backdrop:not(.hidden)");
  const presetDate = await page.inputValue('#modal-body input[name="dueDate"]');
  check("calendar add presets the date", presetDate === today, presetDate);
  await page.fill('#modal-body input[name="title"]', "Calendar born task");
  await page.click("#modal-submit");
  await waitFor(async () => (await page.locator('#view-calendar .cal-item:has-text("Calendar born task")').count()) > 0, 5000, "calendar item appears");
  check("new task appears on today's cell", true);
  await page.click('[data-action="cal-view"][data-cal-view="agenda"]');
  await page.waitForSelector("#view-calendar .agenda-day", { timeout: 5000 });
  check("agenda view lists days", (await page.locator("#view-calendar .cal-list-row").count()) >= 1);
  await page.click('[data-action="cal-view"][data-cal-view="month"]');
  await shot(page, "11-calendar");

  console.log("--- project delivery stage strip ---");
  await page.click('[data-nav="tracker"]');
  await page.click('.project-row:has-text("Palazzo Ricci")');
  await page.waitForSelector(".stage-strip", { timeout: 5000 });
  check("stage strip has 8 segments", (await page.locator(".stage-seg").count()) === 8);
  await page.click('[data-action="set-stage"][data-stage-id="onboarding"]');
  await page.waitForSelector("#modal-backdrop:not(.hidden)");
  const modalTitle = await page.textContent("#modal-title");
  check("stage change asks for date and by whom", modalTitle.indexOf("Onboarding") !== -1, modalTitle);
  await page.click("#modal-submit");
  await waitFor(async () => (await page.textContent("#modal-title")).indexOf("templates") !== -1, 5000, "templates follow-up modal");
  check("stage change offers templates", true);
  const tplCount = await page.locator("#modal-body .wizard-row").count();
  check("onboarding templates listed", tplCount >= 3, tplCount);
  await page.click("#modal-submit");
  await waitFor(async () => (await page.locator(".stage-seg.current").textContent()).indexOf("Onboarding") !== -1, 5000, "current stage segment");
  check("delivery stage set to Onboarding", true);
  await waitSaved(page);
  await shot(page, "12-stage-strip");

  await page.click('[data-action="set-stage"][data-stage-id="onboarding"]');
  await page.waitForSelector(".stage-detail", { timeout: 5000 });
  check("clicking current stage opens stage detail", true);
  await page.fill(".stage-detail .stage-notes", "Stage note from dashboard check");
  await page.press(".stage-detail .stage-notes", "Tab");
  await page.click('[data-action="set-stage"][data-stage-id="onboarding"]');
  await page.waitForSelector(".stage-detail", { state: "detached", timeout: 5000 }).catch(() => { });
  await page.click('[data-action="set-stage"][data-stage-id="onboarding"]');
  await page.waitForSelector(".stage-detail", { timeout: 5000 });
  const noteVal = await page.inputValue(".stage-detail .stage-notes");
  check("stage notes persist", noteVal === "Stage note from dashboard check", noteVal);
  const stageTasks = await page.locator(".stage-detail .task-row").count();
  check("template tasks listed under stage", stageTasks >= 3, stageTasks);
  await page.click('[data-action="close-stage-detail"]');

  console.log("--- revoke delivery step ---");
  await page.click('[data-action="set-stage"][data-stage-id="onboarding"]');
  await page.waitForSelector(".history-row", { timeout: 5000 });
  const histRows = await page.locator(".history-row").count();
  check("step history listed in stage detail", histRows >= 1, histRows);
  await page.click('.history-row [data-action="revoke-step"]');
  await waitFor(async () => (await page.locator(".stage-seg.current").count()) === 0, 5000, "current stage removed after revoke");
  check("revoking the step clears the current stage", true);
  await waitSaved(page);
  const phasesAfter = await page.locator(".stage-seg").evaluateAll((segs) => segs.map((s) => s.textContent));
  check("no stage marked done after revoke", phasesAfter.every((t) => t.indexOf("done") === -1), phasesAfter.join("|"));
  await page.click('[data-action="close-stage-detail"]');
  await shot(page, "12b-stage-revoked");

  console.log("--- engagement agreement ---");
  const agreementBefore = await page.textContent(".agreement-panel .agreement-row");
  check("agreement starts not sent", agreementBefore.indexOf("Sent ") === -1, agreementBefore);
  await page.click('[data-action="agreement-sent"]');
  await page.waitForSelector("#modal-backdrop:not(.hidden)");
  await page.click("#modal-submit");
  await waitFor(async () => (await page.textContent(".agreement-panel .agreement-row")).indexOf("Sent ") !== -1, 5000, "agreement marked sent");
  check("agreement recorded as sent", true);
  await waitSaved(page);
  await shot(page, "13-agreement");

  console.log("--- directory bulk assign ---");
  await page.click('[data-nav="directory"]');
  await page.waitForSelector("#view-directory .data-table");
  const rowsBefore = await (async () => {
    await page.click('.project-row:has-text("MBI")');
    await page.waitForSelector("#view-tracker .toolbar .legend");
    return page.textContent("#view-tracker .toolbar .legend");
  })();
  await page.click('[data-nav="directory"]');
  await page.locator('#view-directory [data-change="select-investor"]').nth(0).check();
  await page.locator('#view-directory [data-change="select-investor"]').nth(1).check();
  const assignBtn = page.locator('[data-action="bulk-assign"]');
  check("assign button shows selection count", (await assignBtn.textContent()).indexOf("(2)") !== -1, await assignBtn.textContent());
  await assignBtn.click();
  await page.waitForSelector("#modal-backdrop:not(.hidden)");
  await page.selectOption('#modal-body select[name="projectId"]', { label: "MBI" });
  await page.click("#modal-submit");
  await waitFor(async () => !(await page.isVisible("#modal-backdrop:not(.hidden)")), 5000, "bulk assign modal close");
  await waitSaved(page);
  await page.click('.project-row:has-text("MBI")');
  await page.waitForSelector("#view-tracker .toolbar .legend");
  const legend = await page.textContent("#view-tracker .toolbar .legend");
  const totalMatch = legend.match(/of (\d+) contacted/);
  check("bulk assign created engagements in MBI", !!totalMatch && Number(totalMatch[1]) === 2, legend + " (was: " + rowsBefore + ")");

  console.log("--- investor import wizard ---");
  const csvPath = path.join(process.env.TEMP || ".", "dashboard-import.csv");
  fs.writeFileSync(csvPath, "Company,Type,Contact name,Contact email\r\nZeta Capital,Family office,zeta@zeta.example\r\nYota Partners,Bank,yota@yota.example\r\n", "utf8");
  await page.setInputFiles("#import-investors-input", csvPath);
  await page.waitForSelector("#modal-backdrop:not(.hidden)");
  await page.waitForFunction(() => document.querySelector("#modal-body").textContent.indexOf("rows") !== -1, null, { timeout: 5000 });
  await page.click("#modal-submit");
  await page.click("#modal-submit");
  await page.waitForSelector("#modal-body .rline.action-create", { timeout: 5000 });
  check("review step marks rows as create", (await page.locator("#modal-body .rline.action-create").count()) >= 2);
  await page.click("#modal-submit");
  await page.waitForSelector("#modal-body .count-box", { timeout: 5000 });
  await page.click("#modal-submit");
  await waitFor(async () => !(await page.isVisible("#modal-backdrop:not(.hidden)")), 5000, "import wizard close");
  await waitSaved(page);
  await page.click('[data-nav="directory"]');
  await page.fill("#view-directory .input-search", "Zeta Capital");
  await page.waitForTimeout(250);
  check("imported investor visible", (await page.locator("#view-directory tbody tr").count()) === 1);
  await page.fill("#view-directory .input-search", "");
  await shot(page, "14-import");

  console.log("--- task board (kanban) + waiting reveal ---");
  await page.click('[data-nav="tasks"]');
  await page.click('[data-action="task-view"][data-task-view="kanban"]');
  await page.waitForSelector(".kanban", { timeout: 5000 });
  check("kanban shows 4 columns", (await page.locator(".kanban-col").count()) === 4);
  const todoBefore = await page.locator('.kanban-col[data-drop-status="To do"] .kanban-card').count();
  const progressBefore = await page.locator('.kanban-col[data-drop-status="In progress"] .kanban-card').count();
  await page.dragAndDrop('.kanban-col[data-drop-status="To do"] .kanban-card >> nth=0', '.kanban-col[data-drop-status="In progress"]');
  await waitFor(async () => {
    const a = await page.locator('.kanban-col[data-drop-status="To do"] .kanban-card').count();
    const b = await page.locator('.kanban-col[data-drop-status="In progress"] .kanban-card').count();
    return a === todoBefore - 1 && b === progressBefore + 1;
  }, 6000, "card dragged to In progress");
  check("drag and drop moves task between columns", true, todoBefore + " -> " + progressBefore);
  await waitSaved(page);
  await shot(page, "15-kanban");

  await page.click('[data-action="task-view"][data-task-view="list"]');
  await page.click("#primary-action-btn");
  await page.waitForSelector("#modal-backdrop:not(.hidden)");
  await page.selectOption('#modal-body select[name="status"]', "Waiting");
  check("waiting reason revealed for Waiting status", await page.isVisible('#modal-body [data-reveal-select="status"]'));
  await page.selectOption('#modal-body select[name="status"]', "To do");
  check("waiting reason hidden again", !(await page.isVisible('#modal-body [data-reveal-select="status"]')));
  await page.selectOption('#modal-body select[name="kind"]', "appointment");
  await page.selectOption('#modal-body select[name="owner"]', "Suzana");
  await page.fill('#modal-body input[name="title"]', "Dashboard appointment");
  await page.fill('#modal-body input[name="dueDate"]', today);
  await page.click("#modal-submit");
  await waitFor(async () => (await page.locator('.task-title:has-text("Dashboard appointment")').count()) > 0, 5000, "appointment in list");
  check("appointment task created", true);

  console.log("--- two-user device preference ---");
  await page.selectOption('#view-tasks [data-change="myOwner"]', "Suzana");
  check("my-tasks checkbox appears after choosing a user", await page.isVisible('#view-tasks [data-change="myTasksOnly"]'));
  await page.check('#view-tasks [data-change="myTasksOnly"]');
  const ownerChips = await page.locator("#view-tasks .task-sub").allTextContents();
  check("only my tasks are listed", ownerChips.length > 0 && ownerChips.every((t) => t.indexOf("Suzana") !== -1), ownerChips.slice(0, 3).join(" | "));
  const stored = await page.evaluate(() => localStorage.getItem("hartmann-crm-me"));
  check("device preference stored", stored === "Suzana", stored);
  await page.uncheck('#view-tasks [data-change="myTasksOnly"]');
  await page.selectOption('#view-tasks [data-change="myOwner"]', "");

  console.log("--- recent changes feed ---");
  const serverFeed = await fetch(BASE + "/api/changelog", { headers: { Authorization: "Bearer dev-token" } }).then((r) => r.json());
  const feedCount = serverFeed.items.length;
  check("server recorded the session's changes", feedCount >= 2, feedCount);
  await waitFor(async () => {
    const n = await page.evaluate(() => {
      const b = document.getElementById("updates-badge");
      return b.classList.contains("hidden") ? -1 : Number(b.textContent);
    });
    return n === feedCount;
  }, 10000, "unread badge equals server changelog count");
  const badgeBefore = await page.evaluate(() => {
    const b = document.getElementById("updates-badge");
    return { hidden: b.classList.contains("hidden"), n: b.textContent };
  });
  check("unread badge shows pending changes before visiting", !badgeBefore.hidden && Number(badgeBefore.n) >= 1, JSON.stringify(badgeBefore));
  await page.click('[data-nav="updates"]');
  await page.waitForSelector("#view-updates #updates-list", { timeout: 5000 });
  await waitFor(async () => (await page.locator("#view-updates .update-row").count()) >= feedCount, 5000, "feed rows match server count");
  const rowCount = await page.locator("#view-updates .update-row").count();
  check("feed lists recorded changes", rowCount === feedCount, rowCount + " vs " + feedCount);
  const firstSummary = await page.textContent("#view-updates .update-row .update-what");
  const firstUser = await page.textContent("#view-updates .update-row .update-who");
  check("feed shows a human summary per entry", firstSummary.trim().length > 10, firstSummary);
  check("feed attributes the actor", firstUser.trim().length > 0, firstUser);
  check("badge cleared after viewing the feed", await page.isHidden("#updates-badge"));
  check("no stale-data banner when views are current", await page.isHidden("#stale-banner"));
  await shot(page, "16-updates");

  const filteredErrors = consoleErrors.filter((e) =>
    e.indexOf("favicon") === -1 &&
    e.indexOf("Failed to load resource") === -1 &&
    e.indexOf("ERR_FAILED") === -1);
  check("no page errors during session", filteredErrors.length === 0, filteredErrors.join(" | "));

  await ctx.close();
  await browser.close();
  stopServer();
  console.log("\n=== dashboard checks: " + passed + " passed, " + failed + " failed ===");
  console.log("screenshots: " + SHOTS);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("DASHBOARD CHECK CRASH:", e && e.stack ? e.stack : e);
  stopServer();
  process.exit(1);
});
