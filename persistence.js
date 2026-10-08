window.Store = (function () {
  "use strict";

  const TOKEN_KEY = "hartmann-crm-access-key";
  let token = "";
  try { token = sessionStorage.getItem(TOKEN_KEY) || ""; } catch (e) { token = ""; }
  const rawBase = (window.CRM_CONFIG && window.CRM_CONFIG.apiBase) ? String(window.CRM_CONFIG.apiBase) : "";
  const apiBase = rawBase.replace(/\/+$/, "");
  let sha = null;
  let dirty = false;
  let inFlight = false;
  let debounceTimer = null;
  let retryTimer = null;
  let ctx = null;

  function emitStatus(kind, text) {
    if (ctx && ctx.onStatus) ctx.onStatus(kind, text);
  }

  function makeError(code, message, extra) {
    const e = new Error(message);
    e.code = code;
    if (extra) Object.assign(e, extra);
    return e;
  }

  function isConfigured() {
    return apiBase.length > 0;
  }

  function hasToken() {
    return token.length > 0;
  }

  function setToken(value) {
    token = String(value || "").trim();
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch (e) { }
  }

  function clearToken() {
    setToken("");
  }

  async function request(method, path, body) {
    if (!apiBase) throw makeError("not-configured", "Backend address is not configured (set apiBase in config.js).");
    if (!token) throw makeError("unauthorized", "Not signed in.");
    let res;
    try {
      const headers = { "Authorization": "Bearer " + token };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      res = await fetch(apiBase + path, {
        method: method,
        headers: headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      throw makeError("network", "Cannot reach the backend. Check your connection or the backend address.");
    }
    if (res.status === 401) throw makeError("unauthorized", "Access key rejected.");
    let payload = null;
    try { payload = await res.json(); } catch (e) { payload = null; }
    if (!res.ok) {
      const message = (payload && (payload.message || payload.error)) || ("HTTP " + res.status);
      throw makeError((payload && payload.error) || "http-error", message, { status: res.status, payload: payload });
    }
    return payload;
  }

  async function load() {
    const result = await request("GET", "/api/data");
    sha = result.sha;
    return result;
  }

  function currentSha() {
    return sha;
  }

  function setSha(value) {
    sha = value;
  }

  function init(handlers) {
    ctx = handlers;
  }

  function markDirty() {
    dirty = true;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { flush(); }, 600);
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(function () {
      if (dirty) flush();
    }, 15000);
  }

  async function flush() {
    if (inFlight) return;
    if (!dirty) return;
    dirty = false;
    inFlight = true;
    clearTimeout(debounceTimer);
    emitStatus("saving", "Saving…");
    try {
      const state = ctx.getState();
      const result = await request("PUT", "/api/data", { data: state, baseSha: sha });
      sha = result.sha;
      emitStatus("saved", "Saved " + new Date().toLocaleTimeString());
      if (dirty) {
        debounceTimer = setTimeout(function () { flush(); }, 300);
      }
    } catch (e) {
      if (e.code === "unauthorized") {
        emitStatus("error", "Session ended — sign in again");
        if (ctx.onUnauthorized) ctx.onUnauthorized();
      } else if (e.status === 409) {
        emitStatus("saving", "Save conflict");
        if (ctx.onConflict) ctx.onConflict(e.payload);
      } else if (e.code === "not-configured") {
        emitStatus("error", "Backend not configured");
      } else if (e.code === "network" || (e.status && e.status >= 500)) {
        emitStatus("error", "Save failed — retrying");
        dirty = true;
        scheduleRetry();
      } else {
        emitStatus("error", "Save rejected: " + e.message);
        dirty = true;
        scheduleRetry();
      }
    } finally {
      inFlight = false;
    }
  }

  function flushNow() {
    return flush();
  }

  function isDirty() {
    return dirty;
  }

  return {
    isConfigured: isConfigured,
    hasToken: hasToken,
    setToken: setToken,
    clearToken: clearToken,
    load: load,
    currentSha: currentSha,
    setSha: setSha,
    init: init,
    markDirty: markDirty,
    flush: flush,
    flushNow: flushNow,
    isDirty: isDirty
  };
})();
