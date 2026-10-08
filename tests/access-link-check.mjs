import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(path.join(process.env.TEMP || process.env.HOME || ".", "pw", "package.json"));
const { chromium } = require("playwright-core");

const BASE = process.env.CRM_BASE || "http://127.0.0.1:8788";
const KEY1 = process.env.CRM_KEY1 || "";
const KEY2 = process.env.CRM_KEY2 || "";
const PHASE = process.env.CRM_PHASE || "1";
const BAD = "definitely-not-a-valid-access-key-123";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const STORAGE_KEY = "hartmann-crm-access-key";
const MESSAGE = "Open your private access link";

if (!KEY1 || !KEY2) {
  console.error("CRM_KEY1 and CRM_KEY2 must be set (read them from the team key file; never hardcode them)");
  process.exit(1);
}

let passed = 0;
let failed = 0;
const pageErrors = [];

function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log("PASS " + name);
  } else {
    failed++;
    console.log("FAIL " + name + (extra !== undefined ? " — " + String(extra) : ""));
  }
}

async function waitReady(page) {
  await page.waitForSelector(".project-row", { timeout: 15000 });
  await page.waitForFunction(() => {
    const t = document.getElementById("save-status-text");
    return t && /^(Saved|Loaded)/.test(t.textContent);
  }, { timeout: 15000 });
}

async function waitAccessMessage(page) {
  await page.waitForSelector("#access-overlay:not(.hidden)", { timeout: 12000 });
  return page.textContent("#access-overlay");
}

async function storedKey(page) {
  return page.evaluate((k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, STORAGE_KEY);
}

async function openWith(browser, key) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { pageErrors.push(String((e && e.message) || e)); });
  await page.goto(BASE + "/#key=" + key, { waitUntil: "networkidle" });
  return { ctx, page };
}

async function openPlain(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { pageErrors.push(String((e && e.message) || e)); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  return { ctx, page };
}

async function apiStatus(key) {
  const headers = {};
  if (key) headers.Authorization = "Bearer " + key;
  try {
    const res = await fetch(BASE + "/api/data", { headers });
    return res.status;
  } catch (e) {
    return "fetch-error: " + e.message;
  }
}

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });

  if (PHASE === "1") {
    console.log("--- phase 1: both keys valid (server AUTH_TOKENS=key1,key2) ---");

    const first = await openWith(browser, KEY1);
    await waitReady(first.page);
    check("first access opens CRM directly", true);
    check("key removed from visible URL", first.page.url().indexOf("#") === -1, first.page.url());
    check("key stored on device", (await storedKey(first.page)) === KEY1);

    await first.page.goto(BASE + "/", { waitUntil: "networkidle" });
    await waitReady(first.page);
    check("returning visit opens without link", true);
    check("returning visit shows no access overlay", await first.page.isHidden("#access-overlay"));

    await first.page.reload({ waitUntil: "networkidle" });
    await waitReady(first.page);
    check("reload keeps direct access", await first.page.isHidden("#access-overlay"));
    await first.ctx.close();

    const second = await openWith(browser, KEY2);
    await waitReady(second.page);
    check("second key opens CRM directly", (await storedKey(second.page)) === KEY2);
    await second.ctx.close();

    const invalid = await openWith(browser, BAD);
    const invalidMsg = await waitAccessMessage(invalid.page);
    check("invalid key shows access-link message", invalidMsg.indexOf(MESSAGE) !== -1, invalidMsg);
    check("invalid key removed from visible URL", invalid.page.url().indexOf("#") === -1, invalid.page.url());
    check("invalid key stored on device for retry", (await storedKey(invalid.page)) === BAD);
    check("no login form rendered", (await invalid.page.locator("#login-token").count()) === 0);
    check("no registration or user-management UI", (await invalid.page.locator('[data-action="logout"], #login-btn').count()) === 0);
    await invalid.ctx.close();

    const missing = await openPlain(browser);
    const missingMsg = await waitAccessMessage(missing.page);
    check("missing key shows access-link message", missingMsg.indexOf(MESSAGE) !== -1, missingMsg);
    check("missing key: nothing stored", (await storedKey(missing.page)) === null);
    await missing.ctx.close();

    check("API accepts key 1", (await apiStatus(KEY1)) === 200, await apiStatus(KEY1));
    check("API accepts key 2", (await apiStatus(KEY2)) === 200, await apiStatus(KEY2));
    check("API rejects invalid key", (await apiStatus(BAD)) === 401, await apiStatus(BAD));
    check("API rejects missing key", (await apiStatus("")) === 401, await apiStatus(""));
  } else {
    console.log("--- phase 2: key 1 revoked (server AUTH_TOKENS=key2 only) ---");

    const revoked = await openWith(browser, KEY1);
    const revMsg = await waitAccessMessage(revoked.page);
    check("revoked key shows access-link message", revMsg.indexOf(MESSAGE) !== -1, revMsg);
    const status = await revoked.page.textContent("#save-status-text");
    check("revoked key reported as rejected", status.indexOf("rejected") !== -1, status);
    await revoked.ctx.close();

    const alive = await openWith(browser, KEY2);
    await waitReady(alive.page);
    check("second key still works after revoking first", true);
    check("second key stored on device", (await storedKey(alive.page)) === KEY2);
    await alive.ctx.close();

    check("API rejects revoked key", (await apiStatus(KEY1)) === 401, await apiStatus(KEY1));
    check("API still accepts remaining key", (await apiStatus(KEY2)) === 200, await apiStatus(KEY2));
  }

  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

  await browser.close();
  console.log("\n=== access-link checks: " + passed + " passed, " + failed + " failed ===");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("ACCESS-LINK CHECK CRASH:", e && e.stack ? e.stack : e);
  process.exit(1);
});
