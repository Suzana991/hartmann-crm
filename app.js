window.App = (function () {
  "use strict";

  let state = null;
  const SEEN_KEY = "hartmann-crm-change-seen";
  const changes = { items: [], dataSha: null, loaded: false, error: false, notifInit: false, lastNotified: "" };
  const sync = { timer: null, syncing: false, backoff: 0, pending: false, error: false };
  const identity = { name: "" };
  const chat = { open: false, messages: [], outbox: [], latest: 0, reads: {}, me: "", lastMarkedRead: 0, draftProjectId: "" };
  const ui = {
    view: "overview",
    projectId: null,
    search: "",
    stageFilter: "",
    reviewOnly: false,
    taskStatus: "",
    taskOwner: "",
    taskProjectOnly: false,
    taskDue: "",
    taskKind: "",
    taskView: "list",
    myOwner: readMyOwner(),
    myTasksOnly: false,
    detailInvestorId: null,
    detailEngagementId: null,
    calendarAnchor: null,
    calendarView: "month",
    calendarOwner: "",
    calendarKind: "",
    ovProject: "",
    ovOwner: "",
    ovPeriod: "30",
    stageDetail: null,
    selectedInvestors: []
  };

  const VIEW_META = {
    overview: { title: "Overview", primary: "＋ New project", action: "add-project" },
    tracker: { title: "Project tracker", primary: "＋ Add engagement", action: "add-engagement" },
    calendar: { title: "Calendar", primary: "＋ Add task", action: "add-task" },
    directory: { title: "Investor Directory", primary: "＋ Add investor", action: "add-investor" },
    tasks: { title: "Tasks", primary: "＋ Add task", action: "add-task" },
    updates: { title: "Recent changes", primary: "", action: "" }
  };

  function el(id) { return document.getElementById(id); }

  function readMyOwner() {
    let saved = "";
    try { saved = localStorage.getItem("hartmann-crm-me") || ""; } catch (e) { }
    return saved === "Suzana" || saved === "Bruno" ? saved : "";
  }

  function emptyState() {
    return {
      schemaVersion: 3,
      investors: [],
      projects: [],
      activities: [],
      tasks: [],
      taskTemplates: CRM_MIGRATION.defaultTaskTemplates(),
      activeProjectId: null
    };
  }

  function activeProject() {
    if (!state) return null;
    return state.projects.find(function (p) { return p.id === ui.projectId && !p.archived; }) || null;
  }

  function setStatus(kind, text) {
    const box = el("save-status");
    box.className = "save-status " + kind;
    el("save-status-text").textContent = text;
    box.dataset.kind = kind;
  }

  function commit() {
    if (state && state.projects.length > 0) {
      const current = state.projects.find(function (p) { return p.id === ui.projectId; });
      state.activeProjectId = current ? current.id : (state.projects.find(function (p) { return !p.archived; }) || {}).id || null;
      if (!current && state.activeProjectId) ui.projectId = state.activeProjectId;
    }
    Store.markDirty();
    render();
  }

  function render() {
    if (!state) return;
    el("projects-list").innerHTML = Views.sidebar(state.projects, ui.projectId);
    document.querySelectorAll("[data-nav]").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.nav === ui.view);
    });
    document.querySelectorAll(".nav-btm-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.view === ui.view);
      if (btn.dataset.view === ui.view) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
    const meta = VIEW_META[ui.view] || VIEW_META.overview;
    let title = meta.title;
    let subtitle = "";
    if (ui.view === "tracker") {
      const p = activeProject();
      title = p ? p.name : "Project tracker";
      subtitle = p ? p.engagements.filter(function (e) { return !e.archived; }).length + " engagements" : "Select or create a project";
    } else if (ui.view === "calendar") {
      const items = Views.calendarItems(state, ui);
      subtitle = items.length + " scheduled item" + (items.length === 1 ? "" : "s");
    } else if (ui.view === "directory") {
      subtitle = state.investors.length + " investors";
    } else if (ui.view === "tasks") {
      subtitle = Views.openTasks(state).length + " open tasks";
    } else if (ui.view === "updates") {
      const n = unreadCount();
      subtitle = changes.items.length ? (changes.items.length + " logged" + (n ? " · " + n + " new" : "")) : "";
    } else {
      subtitle = state.investors.length + " investors · " + Views.allEngagements(state).length + " engagements";
    }
    el("view-title").textContent = title;
    el("view-subtitle").textContent = subtitle;
    const primary = el("primary-action-btn");
    if (meta.action) {
      primary.classList.remove("hidden");
      primary.textContent = meta.primary;
      primary.dataset.action = meta.action;
    } else {
      primary.classList.add("hidden");
    }
    updateBadge();

    document.querySelectorAll(".view").forEach(function (v) { v.classList.add("hidden"); });
    const container = el("view-" + ui.view);
    container.classList.remove("hidden");
    const hadSearchFocus = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.input === "search";
    if (ui.view === "overview") container.innerHTML = Views.overview(state, ui);
    else if (ui.view === "tracker") container.innerHTML = Views.tracker(state, ui);
    else if (ui.view === "calendar") container.innerHTML = Views.calendar(state, ui);
    else if (ui.view === "directory") container.innerHTML = Views.directory(state, ui);
    else if (ui.view === "tasks") container.innerHTML = Views.tasks(state, ui);
    else if (ui.view === "updates") container.innerHTML = renderUpdates();
    if (hadSearchFocus) {
      const input = container.querySelector('[data-input="search"]');
      if (input) {
        input.focus();
        const v = input.value;
        input.setSelectionRange(v.length, v.length);
      }
    }
    updateChatBadgeCount();
    updateSyncIndicator();
    if (el("notif-panel") && !el("notif-panel").classList.contains("hidden")) notifRender();
    renderDetail();
  }

  function renderDetail() {
    const drawer = el("detail-drawer");
    const backdrop = el("detail-backdrop");
    if (!ui.detailInvestorId || !state) {
      drawer.classList.add("hidden");
      backdrop.classList.add("hidden");
      return;
    }
    const inv = Views.investorById(state, ui.detailInvestorId);
    if (!inv) {
      ui.detailInvestorId = null;
      drawer.classList.add("hidden");
      backdrop.classList.add("hidden");
      return;
    }
    el("detail-name").textContent = inv.name;
    const flags = Views.investorReviewCount(state, inv.id);
    el("detail-meta").textContent = (inv.type || "No type") + " · " + inv.contacts.length + " contacts" + (flags ? " · " + flags + " review items" : "");
    el("detail-body").innerHTML = Views.detail(state, inv.id);
    drawer.classList.remove("hidden");
    backdrop.classList.remove("hidden");
    if (ui.detailEngagementId) {
      const blocks = el("detail-body").querySelectorAll(".engagement-block");
      state.projects.some(function (p) {
        return p.engagements.some(function (e) {
          if (e.id !== ui.detailEngagementId) return false;
          const idx = p.engagements.indexOf(e);
          if (blocks[idx]) {
            blocks[idx].scrollIntoView({ block: "nearest" });
            blocks[idx].classList.add("flash");
            setTimeout(function () { blocks[idx].classList.remove("flash"); }, 900);
          }
          return true;
        });
      });
      ui.detailEngagementId = null;
    }
  }

  function openDetail(investorId, engagementId) {
    ui.detailInvestorId = investorId;
    ui.detailEngagementId = engagementId || null;
    renderDetail();
  }

  function closeDetail() {
    ui.detailInvestorId = null;
    renderDetail();
  }

  function switchView(view) {
    ui.view = view;
    ui.search = "";
    closeDrawer();
    if (view === "updates") markSeen();
    render();
  }

  function openDrawer() {
    const sb = document.querySelector(".sidebar");
    const bd = el("sidebar-backdrop");
    const btn = el("drawer-btn");
    if (sb) sb.classList.add("open");
    if (bd) bd.classList.remove("hidden");
    if (btn) btn.setAttribute("aria-expanded", "true");
  }

  function closeDrawer() {
    const sb = document.querySelector(".sidebar");
    const bd = el("sidebar-backdrop");
    const btn = el("drawer-btn");
    if (sb) sb.classList.remove("open");
    if (bd) bd.classList.add("hidden");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function toggleDrawer() {
    const sb = document.querySelector(".sidebar");
    if (sb && sb.classList.contains("open")) closeDrawer();
    else openDrawer();
  }

  function seenTs() {
    try { return localStorage.getItem(SEEN_KEY) || ""; } catch (e) { return ""; }
  }

  function markSeen() {
    if (!changes.items.length) return;
    const latest = changes.items[0].ts;
    if (!latest) return;
    try { localStorage.setItem(SEEN_KEY, latest); } catch (e) { }
    updateBadge();
  }

  function unreadCount() {
    const seen = seenTs();
    if (!seen) return changes.items.length;
    let n = 0;
    for (const it of changes.items) {
      if (it.ts && it.ts > seen) n++;
    }
    return n;
  }

  function updateBadge() {
    const n = unreadCount();
    const hide = n === 0 || !changes.loaded;
    document.querySelectorAll("#updates-badge, [data-badge='updates'], #notif-badge, [data-badge='notif']").forEach(function (badge) {
      badge.textContent = n;
      badge.classList.toggle("hidden", hide);
    });
  }

  function fmtChangeTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    const diffMin = Math.round((Date.now() - d) / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return diffMin + "m ago";
    if (diffMin < 1440) return Math.round(diffMin / 60) + "h ago";
    const days = Math.round(diffMin / 1440);
    if (days === 1) return "yesterday";
    if (days < 7) return days + "d ago";
    return d.toLocaleDateString();
  }

  function renderUpdates() {
    const stale = changes.loaded && changes.dataSha && Store.currentSha() && changes.dataSha !== Store.currentSha() && !Store.isDirty();
    const banner = '<div id="stale-banner" class="banner' + (stale ? "" : " hidden") + '">The data on the server is newer than what you are viewing. <button class="link-btn" data-action="reload-data" data-stop>Reload</button></div>';
    let body;
    if (!changes.loaded) {
      body = '<div class="empty-mini">Check back in a moment — the change feed loads with the app.</div>';
    } else if (!changes.items.length) {
      body = '<div class="empty-state"><p>No changes recorded yet. When someone edits the data, a summary of what changed will appear here.</p></div>';
    } else {
      body = changes.items.map(function (it) {
        const projLink = it.projectId ? ' <button class="link-btn" data-action="open-project" data-id="' + U.esc(it.projectId) + '" data-stop>Open project</button>' : "";
        return '<div class="update-row">' +
          '<span class="update-who">' + U.esc(it.user || "Team member") + '</span>' +
          '<span class="update-when">' + U.esc(fmtChangeTime(it.ts)) + '</span>' +
          '<span class="update-what">' + U.esc(it.summary) + (it.projectName ? ' <span class="update-proj">' + U.esc(it.projectName) + '</span>' : "") + projLink + '</span>' +
          '</div>';
      }).join("");
    }
    return banner + '<div id="updates-list">' + body + '</div>';
  }

  async function refreshChanges(opts) {
    const options = opts || {};
    if (!Store.isConfigured() || !Store.hasToken()) return;
    const result = await Store.loadChanges();
    const previousLatest = changes.items[0] ? changes.items[0].ts : "";
    changes.items = Array.isArray(result.items) ? result.items : [];
    changes.dataSha = result.dataSha || null;
    changes.loaded = true;
    changes.error = false;
    updateBadge();
    detectNotifications(previousLatest);

    const serverNewer = !!(changes.dataSha && Store.currentSha() && changes.dataSha !== Store.currentSha());
    if (serverNewer && !options.probeOnly) {
      if (isUnsafeToRefresh()) {
        sync.pending = true;
        showSyncBanner();
      } else {
        await refreshFromServer();
      }
    } else if (!serverNewer) {
      sync.pending = false;
      hideSyncBanner();
    }
    updateSyncIndicator();
    if (ui.view === "updates") render();
    await chatPoll().catch(function () { });
  }

  function scheduleSync(delay) {
    clearTimeout(sync.timer);
    sync.timer = setTimeout(runSync, delay);
  }

  async function runSync() {
    if (sync.syncing) { scheduleSync(2000); return; }
    if (!Store.isConfigured() || !Store.hasToken()) { scheduleSync(10000); return; }
    if (document.hidden) { scheduleSync(15000); return; }
    sync.syncing = true;
    try {
      await refreshChanges();
      sync.backoff = 0;
      sync.error = false;
    } catch (e) {
      sync.error = true;
      sync.backoff = Math.min(sync.backoff + 1, 6);
    } finally {
      sync.syncing = false;
      updateSyncIndicator();
      const base = 8000;
      const delay = sync.backoff ? Math.min(base * Math.pow(2, sync.backoff), 60000) : base;
      scheduleSync(delay);
    }
  }

  async function refreshNow() {
    if (sync.syncing) return;
    clearTimeout(sync.timer);
    await runSync();
  }

  function isUnsafeToRefresh() {
    if (Store.isBusy()) return true;
    if (document.querySelector("#modal-backdrop:not(.hidden)")) return true;
    if (document.querySelector("#detail-backdrop:not(.hidden)")) return true;
    if (actions._dragging) return true;
    const a = document.activeElement;
    if (a && a !== document.body) {
      if (a.isContentEditable) return true;
      const tag = a.tagName;
      if (tag === "TEXTAREA" || tag === "SELECT") return true;
      if (tag === "INPUT") {
        const t = (a.type || "text").toLowerCase();
        if (t !== "checkbox" && t !== "radio" && t !== "button" && t !== "file" && t !== "submit") return true;
      }
    }
    return false;
  }

  function captureScroll() {
    const view = el("view-" + ui.view);
    const main = document.querySelector(".main");
    return {
      window: window.scrollY || 0,
      main: main ? main.scrollTop : 0,
      view: view ? view.scrollTop : 0
    };
  }

  function restoreScroll(ctx) {
    if (!ctx) return;
    requestAnimationFrame(function () {
      try {
        window.scrollTo(0, ctx.window || 0);
        const main = document.querySelector(".main");
        if (main) main.scrollTop = ctx.main || 0;
        const view = el("view-" + ui.view);
        if (view) view.scrollTop = ctx.view || 0;
      } catch (e) { }
    });
  }

  async function refreshFromServer() {
    const ctx = captureScroll();
    const result = await Store.load();
    if (result.data === null) {
      state = emptyState();
    } else {
      const migrated = CRM_MIGRATION.migrate(result.data);
      state = migrated.state;
    }
    if (state.projects.length && !state.projects.some(function (p) { return p.id === ui.projectId; })) {
      const firstOpen = state.projects.find(function (p) { return !p.archived; }) || state.projects[0];
      ui.projectId = firstOpen ? firstOpen.id : null;
    }
    if (ui.detailInvestorId && !state.investors.some(function (i) { return i.id === ui.detailInvestorId; })) {
      ui.detailInvestorId = null;
      ui.detailEngagementId = null;
    }
    sync.pending = false;
    hideSyncBanner();
    render();
    restoreScroll(ctx);
    setStatus("saved", "Updated from server");
  }

  function showSyncBanner() {
    const b = el("sync-banner");
    if (!b) return;
    b.classList.remove("hidden");
    el("sync-banner-text").textContent = "New changes are available. Your edits are protected.";
  }

  function hideSyncBanner() {
    const b = el("sync-banner");
    if (b) b.classList.add("hidden");
  }

  function updateSyncIndicator() {
    const dot = el("sync-status");
    if (!dot) return;
    if (!navigator.onLine) { dot.className = "sync-status offline"; el("sync-status-text").textContent = "Offline"; }
    else if (sync.error) { dot.className = "sync-status retry"; el("sync-status-text").textContent = "Sync paused"; }
    else if (sync.pending) { dot.className = "sync-status pending"; el("sync-status-text").textContent = "New changes"; }
    else { dot.className = "sync-status live"; el("sync-status-text").textContent = "Live"; }
  }

  function detectNotifications(previousLatest) {
    if (!changes.items.length) return;
    const latest = changes.items[0].ts || "";
    if (!changes.notifInit) { changes.notifInit = true; changes.lastNotified = latest; return; }
    const since = previousLatest || changes.lastNotified || "";
    if (latest) changes.lastNotified = latest;
    if (!since) return;
    const fresh = changes.items.filter(function (it) {
      return it.ts && it.ts > since && (!identity.name || it.user !== identity.name);
    });
    if (!fresh.length) return;
    const first = fresh[0];
    const label = first.summary && first.summary.charAt(0).toLowerCase() === first.summary.charAt(0) ? first.summary : ("did " + first.summary);
    if (fresh.length === 1) U.toast(first.user + " " + label, "info");
    else U.toast(first.user + " and " + (fresh.length - 1) + " more update" + (fresh.length - 1 === 1 ? "" : "s"), "info");
  }

  function notifRender() {
    const list = el("notif-list");
    if (!list) return;
    if (!changes.loaded) { list.innerHTML = '<div class="empty-mini">Loading recent changes…</div>'; return; }
    if (!changes.items.length) { list.innerHTML = '<div class="empty-mini">No changes recorded yet.</div>'; return; }
    const seen = seenTs();
    list.innerHTML = changes.items.slice(0, 30).map(function (it) {
      const unread = it.ts && (!seen || it.ts > seen);
      const proj = it.projectName || "";
      const link = it.projectId ? ' <button class="link-btn" data-action="open-project" data-id="' + U.esc(it.projectId) + '" data-stop>Open</button>' : "";
      return '<div class="notif-row' + (unread ? " unread" : "") + '">' +
        '<div class="notif-line"><span class="notif-who">' + U.esc(it.user || "Team member") + '</span>' +
        '<span class="notif-when">' + U.esc(fmtChangeTime(it.ts)) + '</span></div>' +
        '<div class="notif-what">' + U.esc(it.summary) + (proj ? ' <span class="notif-proj">' + U.esc(proj) + '</span>' : "") + link + '</div>' +
        '</div>';
    }).join("");
  }

  function openNotif() {
    const panel = el("notif-panel");
    if (!panel) return;
    notifRender();
    panel.classList.remove("hidden");
    const btn = el("notif-btn");
    if (btn) btn.setAttribute("aria-expanded", "true");
    markSeen();
    updateBadge();
  }

  function closeNotif() {
    const panel = el("notif-panel");
    if (panel) panel.classList.add("hidden");
    const btn = el("notif-btn");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function toggleNotif() {
    const panel = el("notif-panel");
    if (panel && !panel.classList.contains("hidden")) closeNotif();
    else openNotif();
  }

  function updateChatHeader() {
    const sub = el("chat-subtitle");
    if (!sub) return;
    const last = chat.messages[chat.messages.length - 1] || chat.outbox[chat.outbox.length - 1];
    sub.textContent = last ? (last.author + ": " + String(last.text || "").replace(/\s+/g, " ").slice(0, 64)) : "No messages yet";
  }

  function chatLinkify(text) {
    const escaped = U.esc(text);
    return escaped.replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, function (u) {
      return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + "</a>";
    });
  }

  function chatRow(m) {
    return projectChipRow(m);
  }

  function projectChipHtml(m) {
    if (!m.projectId) return "";
    return '<button class="chat-tag" data-action="chat-project" data-id="' + U.esc(m.projectId) + '" data-stop>' + U.esc(m.projectName || "Open project") + '</button>';
  }

  function outboxRow(m) {
    return '<div class="chat-msg mine' + (m.failed ? " failed" : " pending") + '" data-client-id="' + U.esc(m.clientId) + '">' +
      '<div class="chat-msg-meta"><span class="chat-author">' + U.esc(identity.name || "You") + '</span>' +
      '<span class="chat-time">' + (m.failed ? "Not sent — tap to retry" : "Sending…") + '</span></div>' +
      '<div class="chat-text">' + chatLinkify(m.text) + '</div>' +
      (m.projectId ? '<button class="chat-tag" data-action="chat-project" data-id="' + U.esc(m.projectId) + '" data-stop>' + U.esc(m.projectName || "Open project") + '</button>' : "") +
      '</div>';
  }

  function renderChatMessages() {
    const box = el("chat-messages");
    if (!box) return;
    const wasNearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    const rows = chat.messages.map(projectChipRow).concat(chat.outbox.map(outboxRow));
    box.innerHTML = rows.length ? rows.join("") : '<div class="chat-empty">No messages yet. Say hello to your teammate.</div>';
    updateChatHeader();
    if (wasNearBottom || chat.open) {
      requestAnimationFrame(function () { box.scrollTop = box.scrollHeight; });
    }
  }

  function projectChipRow(m) {
    return '<div class="chat-msg' + (m.author === identity.name ? " mine" : "") + '">' +
      '<div class="chat-msg-meta"><span class="chat-author">' + U.esc(m.author) + '</span>' +
      '<span class="chat-time">' + U.esc(fmtChangeTime(m.ts)) + '</span></div>' +
      '<div class="chat-text">' + chatLinkify(m.text) + '</div>' +
      projectChipHtml(m) +
      '</div>';
  }

  function chatScrollToEnd() {
    const box = el("chat-messages");
    if (box) requestAnimationFrame(function () { box.scrollTop = box.scrollHeight; });
  }

  function updateChatBadgeCount() {
    const me = identity.name;
    let n = 0;
    for (const m of chat.messages) { if (m.author !== me && m.seq > (chat.reads[me] || 0)) n++; }
    document.querySelectorAll("#chat-badge, [data-badge='chat']").forEach(function (badge) {
      badge.textContent = n;
      badge.classList.toggle("hidden", n === 0);
    });
  }

  function chatMarkRead() {
    if (!chat.open) return;
    const me = identity.name;
    let maxSeq = 0;
    for (const m of chat.messages) { if (m.author !== me && m.seq > maxSeq) maxSeq = m.seq; }
    if (maxSeq > (chat.lastMarkedRead || 0)) {
      chat.lastMarkedRead = maxSeq;
      Store.markChatRead(maxSeq).then(function (res) {
        if (res && res.reads) { chat.reads = res.reads; updateChatBadgeCount(); }
      }).catch(function () { });
    }
  }

  async function chatPoll() {
    if (!Store.isConfigured() || !Store.hasToken()) return;
    const result = await Store.loadChat(chat.latest || 0);
    if (!result) return;
    if (result.me) { chat.me = result.me; identity.name = result.me; }
    if (result.reads) chat.reads = result.reads;
    let changed = false;
    if (Array.isArray(result.messages) && result.messages.length) {
      for (const m of result.messages) {
        if (!chat.messages.some(function (x) { return x.id === m.id; })) { chat.messages.push(m); changed = true; }
      }
      chat.messages.sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
    }
    if (Number(result.latest) > chat.latest) { chat.latest = Number(result.latest); changed = true; }
    if (changed) {
      updateChatBadgeCount();
      if (chat.open) { renderChatMessages(); chatMarkRead(); }
    }
  }

  async function chatSend() {
    const input = el("chat-input");
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    const proj = activeProject();
    const item = {
      clientId: U.uid() + U.uid(),
      text: text,
      projectId: proj ? proj.id : "",
      projectName: proj ? proj.name : "",
      author: identity.name || "You",
      ts: new Date().toISOString(),
      failed: false
    };
    chat.outbox.push(item);
    input.value = "";
    input.style.height = "";
    renderChatMessages();
    chatScrollToEnd();
    await flushOutboxItem(item);
  }

  async function flushOutboxItem(item) {
    try {
      const res = await Store.sendChat({ clientId: item.clientId, text: item.text, projectId: item.projectId, projectName: item.projectName });
      chat.outbox = chat.outbox.filter(function (x) { return x.clientId !== item.clientId; });
      if (res && res.message) {
        if (!chat.messages.some(function (x) { return x.id === res.message.id; })) chat.messages.push(res.message);
        chat.messages.sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
        chat.latest = Math.max(chat.latest, Number(res.message.seq) || 0);
      }
      chatMarkRead();
    } catch (e) {
      item.failed = true;
      item.pending = false;
    }
    renderChatMessages();
    updateChatBadgeCount();
  }

  function retryChat(clientId) {
    const item = chat.outbox.find(function (x) { return x.clientId === clientId; });
    if (!item) return;
    item.failed = false;
    renderChatMessages();
    flushOutboxItem(item);
  }

  function openChat() {
    chat.open = true;
    const panel = el("chat-panel");
    if (panel) panel.classList.remove("hidden");
    document.body.classList.add("chat-open");
    const btn = el("chat-fab");
    if (btn) btn.setAttribute("aria-expanded", "true");
    renderChatMessages();
    chatScrollToEnd();
    chatMarkRead();
    updateChatBadgeCount();
    if (window.matchMedia("(min-width:760px)").matches) {
      setTimeout(function () { const i = el("chat-input"); if (i) i.focus(); }, 60);
    }
  }

  function closeChat() {
    chat.open = false;
    const panel = el("chat-panel");
    if (panel) panel.classList.add("hidden");
    document.body.classList.remove("chat-open");
    const btn = el("chat-fab");
    if (btn) btn.setAttribute("aria-expanded", "false");
    updateChatBadgeCount();
  }

  function toggleChat() {
    if (chat.open) closeChat();
    else openChat();
  }

  function scrollToChatProject(projectId) {
    if (!state || !projectId) return;
    const exists = state.projects.some(function (p) { return p.id === projectId; });
    if (!exists) { U.toast("That project is no longer in the workspace.", "info"); return; }
    ui.view = "tracker";
    ui.projectId = projectId;
    closeChat();
    closeNotif();
    render();
  }

  function acquireTokenFromLink() {
    const hash = window.location.hash || "";
    if (!hash) return;
    const match = /(?:^|[#&])key=([^&]*)/.exec(hash);
    if (!match) return;
    let key = "";
    try { key = decodeURIComponent(match[1] || "").trim(); }
    catch (e) { key = (match[1] || "").trim(); }
    if (key) Store.setToken(key);
    try { history.replaceState(null, "", window.location.pathname + window.location.search); }
    catch (e) { window.location.hash = ""; }
  }

  function showAccess() {
    el("access-overlay").classList.remove("hidden");
  }

  function hideAccess() {
    el("access-overlay").classList.add("hidden");
  }

  function showFatal(title, text) {
    el("fatal-title").textContent = title;
    el("fatal-text").textContent = text;
    el("fatal-backdrop").classList.remove("hidden");
  }

  function hideFatal() {
    el("fatal-backdrop").classList.add("hidden");
  }

  function showConflict(payload) {
    if (!payload || payload.data === null) {
      el("conflict-text").textContent = "The data file was removed on the server while you were editing. Saving your version will recreate it.";
      el("conflict-reload").classList.add("hidden");
    } else {
      const who = payload.data && payload.data.migrationReport ? "another user migrated or saved" : "another user saved changes";
      el("conflict-text").textContent = "A newer version exists on the server (" + who + "). Load their version and lose your unsaved edits, or save your version over theirs.";
      el("conflict-reload").classList.remove("hidden");
    }
    el("conflict-backdrop").classList.remove("hidden");
  }

  function hideConflict() {
    el("conflict-backdrop").classList.add("hidden");
  }

  async function bootstrap() {
    if (!Store.isConfigured()) {
      setStatus("error", "Backend not configured");
      showFatal("Backend not configured", "Set apiBase in config.js to your backend address, then reload the page.");
      return;
    }
    if (!Store.hasToken()) {
      setStatus("", "No access key");
      showAccess();
      return;
    }
    hideAccess();
    hideFatal();
    setStatus("saving", "Loading…");
    try {
      const result = await Store.load();
      if (result.data === null) {
        state = emptyState();
        ui.projectId = null;
        setStatus("saved", "New dataset — nothing stored yet");
        render();
        refreshChanges();
        return;
      }
      const migrated = CRM_MIGRATION.migrate(result.data);
      state = migrated.state;
      const firstProject = state.projects.find(function (p) { return !p.archived; });
      ui.projectId = state.activeProjectId || (firstProject ? firstProject.id : null);
      render();
      refreshChanges();
      if (!migrated.alreadyMigrated) {
        setStatus("saving", "Saving migrated data…");
        Store.markDirty();
        await Store.flush();
        U.toast("Legacy data migrated. The original snapshot is stored with the data as a backup.", "info");
      } else {
        setStatus("saved", "Loaded " + new Date().toLocaleTimeString());
      }
    } catch (e) {
      if (e.code === "unauthorized") {
        setStatus("", "Access key rejected");
        showAccess();
        return;
      }
      if (e.code === "unsupported-version" || e.code === "unrecognized-data" || e.code === "invalid-data") {
        setStatus("error", "Data rejected");
        showFatal("Cannot open this data", e.message);
        return;
      }
      setStatus("error", "Load failed");
      showFatal("Cannot load data", e.message || String(e));
    }
  }

  function remapIds(incoming) {
    const map = new Map();
    function newId(old) {
      if (!old) return U.uid();
      if (!map.has(old)) map.set(old, U.uid());
      return map.get(old);
    }
    incoming.investors.forEach(function (i) {
      i.contacts.forEach(function (c) { c.id = newId("c:" + c.id); });
      i.id = newId("i:" + i.id);
    });
    incoming.projects.forEach(function (p) {
      p.engagements.forEach(function (e) { e.id = newId("e:" + e.id); });
      p.id = newId("p:" + p.id);
    });
    incoming.investors.forEach(function (i) {
      i.contacts.forEach(function (c) { });
    });
    incoming.projects.forEach(function (p) {
      p.engagements.forEach(function (e) {
        e.investorId = map.get("i:" + e.investorId) || e.investorId;
        e.contactIds = (e.contactIds || []).map(function (cid) { return map.get("c:" + cid) || cid; });
      });
    });
    incoming.activities.forEach(function (a) {
      a.id = newId("a:" + a.id);
      a.engagementId = map.get("e:" + a.engagementId) || a.engagementId;
      if (a.contactId) a.contactId = map.get("c:" + a.contactId) || a.contactId;
    });
    incoming.tasks.forEach(function (t) {
      t.id = newId("t:" + t.id);
      if (t.projectId) t.projectId = map.get("p:" + t.projectId) || t.projectId;
      if (t.engagementId) t.engagementId = map.get("e:" + t.engagementId) || t.engagementId;
      if (t.contactId) t.contactId = map.get("c:" + t.contactId) || t.contactId;
    });
    if (incoming.activeProjectId) incoming.activeProjectId = map.get("p:" + incoming.activeProjectId) || incoming.activeProjectId;
    return incoming;
  }

  function shiftAnchor(dir) {
    const anchor = ui.calendarAnchor && U.isValidISODate(ui.calendarAnchor) ? ui.calendarAnchor : U.todayISO();
    if (ui.calendarView === "month") {
      const p = U.parseISO(anchor);
      const target = new Date(p.y, p.m - 1 + dir, 1);
      const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      const day = Math.min(p.d, lastDay);
      ui.calendarAnchor = U.toISO(target.getFullYear(), target.getMonth() + 1, day);
    } else if (ui.calendarView === "week") {
      ui.calendarAnchor = U.addDaysISO(anchor, dir * 7);
    } else {
      ui.calendarAnchor = U.addDaysISO(anchor, dir * 30);
    }
    render();
  }

  const actions = {
    "open-view": function (ds) { switchView(ds.view); },
    "open-project": function (ds) {
      ui.projectId = ds.id;
      ui.view = "tracker";
      ui.search = "";
      ui.stageDetail = null;
      if (state) state.activeProjectId = ds.id;
      Store.markDirty();
      render();
    },
    "open-detail": function (ds) { openDetail(ds.id, ds.engagementId); },
    "close-detail": function () { closeDetail(); },
    "add-project": function () { Modals.projectModal(null); },
    "rename-project": function () {
      const p = activeProject() || (state.projects.find(function (x) { return !x.archived; }));
      if (p) Modals.projectModal(p);
      else U.toast("No project to rename.", "info");
    },
    "archive-project": function () {
      const p = activeProject();
      if (!p) return;
      if (!confirm('Archive project "' + p.name + '"? Its engagements stay in the data but stop appearing in lists.')) return;
      p.archived = true;
      const next = state.projects.find(function (x) { return !x.archived; });
      ui.projectId = next ? next.id : null;
      state.activeProjectId = ui.projectId;
      if (ui.view === "tracker" && !next) ui.view = "overview";
      commit();
    },
    "add-investor": function () { Modals.investorModal(null); },
    "edit-investor": function (ds) {
      const inv = Views.investorById(state, ds.id);
      if (inv) Modals.investorModal(inv);
    },
    "add-contact": function (ds) {
      const inv = Views.investorById(state, ds.investorId);
      if (inv) Modals.contactModal(inv, null);
    },
    "edit-contact": function (ds) {
      const inv = Views.investorById(state, ds.investorId);
      if (!inv) return;
      const c = inv.contacts.find(function (x) { return x.id === ds.id; });
      if (c) Modals.contactModal(inv, c);
    },
    "remove-contact": function (ds) {
      const inv = Views.investorById(state, ds.investorId);
      if (!inv) return;
      const c = inv.contacts.find(function (x) { return x.id === ds.id; });
      if (!c) return;
      const d = U.contactDisplay(c);
      if (!confirm("Remove contact " + d.primary + "? Linked records will be detached (activities keep their summaries).")) return;
      inv.contacts = inv.contacts.filter(function (x) { return x.id !== ds.id; });
      state.projects.forEach(function (p) {
        p.engagements.forEach(function (e) {
          if (e.contactIds) e.contactIds = e.contactIds.filter(function (cid) { return cid !== ds.id; });
        });
      });
      state.tasks.forEach(function (t) { if (t.contactId === ds.id) t.contactId = ""; });
      state.activities.forEach(function (a) { if (a.contactId === ds.id) a.contactId = null; });
      commit();
    },
    "toggle-primary": function (ds) {
      const inv = Views.investorById(state, ds.investorId);
      if (!inv) return;
      const target = inv.contacts.find(function (x) { return x.id === ds.id; });
      if (!target) return;
      const make = !target.isPrimary;
      inv.contacts.forEach(function (c) { c.isPrimary = false; });
      target.isPrimary = make;
      commit();
    },
    "add-engagement": function (ds) {
      Modals.engagementModal(state, ds.investorId || null, {
        projectId: ui.view === "tracker" ? ui.projectId : null
      });
    },
    "archive-engagement": function (ds) {
      let found = null;
      state.projects.forEach(function (p) {
        p.engagements.forEach(function (e) { if (e.id === ds.id) found = e; });
      });
      if (!found) return;
      if (!confirm("Archive this engagement? Its activity history and tasks are kept.")) return;
      found.archived = true;
      commit();
    },
    "log-activity": function (ds) { Modals.activityModal(state, ds.engagementId); },
    "add-task": function (ds) {
      Modals.taskModal(state, null, {
        engagementId: ds.engagementId || "",
        projectId: ui.view === "tracker" ? ui.projectId : (state ? state.activeProjectId : "")
      });
    },
    "edit-task": function (ds) {
      const t = state.tasks.find(function (x) { return x.id === ds.id; });
      if (t) Modals.taskModal(state, t, {});
    },
    "delete-task": function (ds) {
      const t = state.tasks.find(function (x) { return x.id === ds.id; });
      if (!t) return;
      if (!confirm('Delete task "' + t.title + '"?')) return;
      state.tasks = state.tasks.filter(function (x) { return x.id !== ds.id; });
      commit();
    },
    "record-outreach": function (ds) { Modals.recordOutreachModal(state, ds.engagementId); },
    "quick-outreach": function () {
      Modals.engagementPickerModal(state, function (id) { Modals.recordOutreachModal(state, id, {}); });
    },
    "quick-activity": function () { Modals.engagementPickerModal(state); },
    "edit-activity": function (ds) {
      const a = state.activities.find(function (x) { return x.id === ds.id; });
      if (a) Modals.activityEditModal(state, a);
      else U.toast("Activity not found.", "info");
    },
    "delete-activity": function (ds) {
      const a = state.activities.find(function (x) { return x.id === ds.id; });
      if (!a) return;
      if (!confirm("Delete this activity? The summary cannot be recovered.")) return;
      state.activities = state.activities.filter(function (x) { return x.id !== ds.id; });
      commit();
      U.toast("Activity deleted.");
    },
    "attention": function (ds) {
      const f = ds.filter;
      ui.search = "";
      if (f === "overdue" || f === "today" || f === "waiting") {
        ui.taskStatus = f === "waiting" ? "Waiting" : "";
        ui.taskDue = f === "overdue" ? "overdue" : f === "today" ? "today" : "";
        ui.taskKind = "";
        ui.myTasksOnly = false;
        ui.view = "tasks";
      } else if (f === "review") {
        ui.reviewOnly = true;
        ui.stageFilter = "";
        ui.view = "tracker";
      } else if (f === "uncontacted") {
        ui.stageFilter = "not_contacted";
        ui.reviewOnly = false;
        ui.view = "tracker";
      }
      render();
    },
    "set-stage": function (ds) {
      const project = Views.projectById(state, ds.id);
      if (!project) return;
      const to = ds.stageId;
      if (project.deliveryStage === to) {
        ui.stageDetail = ui.stageDetail === to ? null : to;
        render();
        return;
      }
      Modals.stageChangeModal(project, to);
    },
    "close-stage-detail": function () { ui.stageDetail = null; render(); },
    "revoke-step": function (ds) {
      const project = Views.projectById(state, ds.id);
      if (!project) return;
      const history = project.stageHistory || [];
      const idx = history.findIndex(function (h) { return h.id === ds.historyId; });
      if (idx === -1) return;
      if (!confirm("Revoke this step? The project returns to the stage it was in before it.")) return;
      const entry = history[idx];
      history.splice(idx, 1);
      if (project.deliveryStage === entry.to) project.deliveryStage = entry.from;
      commit();
      U.toast("Step revoked.");
    },
    "apply-templates": function (ds) {
      const project = Views.projectById(state, ds.id);
      if (project) Modals.templatesApplyModal(state, project, ds.stageId);
    },
    "add-stage-task": function (ds) {
      Modals.taskModal(state, null, { projectId: ds.id, stage: ds.stageId });
    },
    "manage-templates": function () { Modals.templatesManageModal(state); },
    "edit-agreement": function (ds) {
      const project = Views.projectById(state, ds.id);
      if (project) Modals.agreementModal(project, "edit");
    },
    "agreement-sent": function (ds) {
      const project = Views.projectById(state, ds.id);
      if (project) Modals.agreementModal(project, "sent");
    },
    "agreement-signed": function (ds) {
      const project = Views.projectById(state, ds.id);
      if (project) Modals.agreementModal(project, "signed");
    },
    "edit-milestones": function (ds) {
      const project = Views.projectById(state, ds.id || ui.projectId);
      if (project) Modals.milestonesModal(project);
      else U.toast("Select a project first.", "info");
    },
    "bulk-assign": function () { Modals.assignProjectsModal(state, ui.selectedInvestors.slice()); },
    "clear-selection": function () { ui.selectedInvestors = []; render(); },
    "import-investors": function () { Modals.importWizardModal(state, {}); },
    "cal-prev": function () { shiftAnchor(-1); },
    "cal-next": function () { shiftAnchor(1); },
    "cal-today": function () { ui.calendarAnchor = U.todayISO(); render(); },
    "cal-view": function (ds) { ui.calendarView = ds.calView || "month"; render(); },
    "task-view": function (ds) { ui.taskView = ds.taskView || "list"; render(); },
    "calendar-add": function (ds) {
      Modals.taskModal(state, null, { dueDate: ds.date, projectId: state ? state.activeProjectId : "" });
    },
    "export-json": function () {
      U.downloadBlob(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }), "hartmann-crm-backup.json");
    },
    "export-csv": function () { exportCsv(); },
    "reload-data": function () {
      if (Store.isDirty() && !confirm("You have unsaved changes. Reload from the backend and discard them?")) return;
      bootstrap();
    },
    "toggle-theme": function () {
      const order = ["system", "light", "dark"];
      const current = themePref();
      const next = order[(order.indexOf(current) + 1) % order.length];
      applyTheme(next);
      try { localStorage.setItem("hartmann-crm-theme", next); } catch (e) { }
    },
    "toggle-menu": function () { el("menu").classList.toggle("hidden"); },
    "toggle-drawer": function () { toggleDrawer(); },
    "close-drawer": function () { closeDrawer(); },
    "conflict-reload": function () {
      const payload = actions._conflictPayload;
      hideConflict();
      if (!payload) return;
      if (payload.data === null) {
        state = emptyState();
        Store.setSha(payload.sha);
        render();
        setStatus("saved", "Server copy was empty");
        return;
      }
      try {
        const migrated = CRM_MIGRATION.migrate(payload.data);
        state = migrated.state;
        Store.setSha(payload.sha);
        render();
        setStatus("saved", "Loaded server version");
        U.toast("Loaded the other user's version.", "info");
      } catch (e) {
        U.toast("Server version could not be read: " + e.message, "error");
      }
    },
    "conflict-overwrite": function () {
      const payload = actions._conflictPayload;
      hideConflict();
      if (!payload) return;
      Store.setSha(payload.sha);
      Store.markDirty();
      Store.flushNow();
      U.toast("Saving your version over the server copy.", "info");
    },
    "retry-save": function () { Store.flushNow(); },
    "fatal-retry": function () { hideFatal(); bootstrap(); },
    "chat-toggle": function () { toggleChat(); },
    "chat-close": function () { closeChat(); },
    "chat-send": function () { chatSend(); },
    "chat-project": function (ds) { scrollToChatProject(ds.id); },
    "chat-retry": function (ds) { retryChat(ds.clientId); },
    "notif-toggle": function () { toggleNotif(); },
    "sync-refresh": async function () {
      try { await Store.flushNow(); } catch (e) { }
      if (isUnsafeToRefresh()) { U.toast("Finish or save your current edit, then refresh.", "info"); return; }
      clearTimeout(sync.timer);
      await refreshNow();
    },
    "_conflictPayload": null
  };

  function commitInvestor(id, data) {
    if (id) {
      const inv = Views.investorById(state, id);
      if (inv) Object.assign(inv, data);
      U.toast("Investor updated.");
    } else {
      const inv = Object.assign({ id: U.uid(), archived: false, contacts: [] }, data);
      state.investors.push(inv);
      ui.detailInvestorId = inv.id;
      U.toast("Investor added — now add contacts.", "info");
    }
    commit();
  }

  function commitContact(investorId, contactId, data) {
    const inv = Views.investorById(state, investorId);
    if (!inv) return;
    if (contactId) {
      const c = inv.contacts.find(function (x) { return x.id === contactId; });
      if (c) {
        Object.assign(c, data);
        c.reviewFlags = (c.reviewFlags || []).filter(function (f) { return f.indexOf("invalid-email") !== 0; });
        if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) c.reviewFlags.push("invalid-email-format");
      }
      U.toast("Contact updated.");
    } else {
      const c = Object.assign({ id: U.uid(), reviewFlags: [] }, data);
      if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) c.reviewFlags.push("invalid-email-format");
      if (c.isPrimary) inv.contacts.forEach(function (x) { x.isPrimary = false; });
      inv.contacts.push(c);
      U.toast("Contact added.");
    }
    commit();
  }

  function commitEngagement(data) {
    const project = state.projects.find(function (p) { return p.id === data.projectId; });
    if (!project) return;
    const dup = project.engagements.find(function (e) { return !e.archived && e.investorId === data.investorId; });
    if (dup) {
      U.toast("Already in this project — opening it instead.", "info");
      ui.projectId = project.id;
      ui.view = "tracker";
      render();
      openDetail(data.investorId, dup.id);
      return;
    }
    const engagement = {
      id: U.uid(),
      investorId: data.investorId,
      stage: data.stage,
      priority: data.priority,
      owner: data.owner,
      contactIds: [],
      notes: "",
      archived: false,
      legacy: null,
      reviewFlags: []
    };
    project.engagements.push(engagement);
    ui.projectId = project.id;
    state.activeProjectId = project.id;
    ui.view = "tracker";
    commit();
    openDetail(data.investorId, engagement.id);
    U.toast("Engagement created in " + project.name + ".");
  }

  function commitActivity(payload) {
    const found = Views.findEngagement(state, payload.engagementId);
    if (!found) return;
    const type = payload.type;
    const kind = U.activityKindOf(type);
    state.activities.push({
      id: U.uid(),
      engagementId: payload.engagementId,
      date: payload.date,
      undated: !payload.date,
      type: type,
      kind: kind,
      outreachType: kind === "outreach" && U.OUTREACH_TYPES.indexOf(type) !== -1 ? type : "",
      contactId: payload.contactId,
      teamMember: payload.teamMember,
      summary: payload.summary,
      createdAt: new Date().toISOString()
    });
    if (payload.changeStage) found.engagement.stage = payload.changeStage;
    if (payload.follow && payload.follow.title) {
      state.tasks.push(newTask({
        title: payload.follow.title,
        owner: payload.follow.owner || "",
        dueDate: payload.follow.dueDate || "",
        projectId: found.project.id,
        engagementId: payload.engagementId,
        source: "follow-up"
      }));
    }
    commit();
    U.toast(payload.follow && payload.follow.title ? "Activity logged and follow-up scheduled." : "Activity logged.");
  }

  function newTask(data) {
    return Object.assign({
      id: U.uid(),
      title: "",
      owner: "",
      dueDate: "",
      status: "To do",
      waitingReason: "",
      priority: "",
      notes: "",
      projectId: "",
      engagementId: "",
      contactId: "",
      stage: "",
      kind: "task",
      templateKey: "",
      legacy: false,
      source: "",
      reviewFlags: []
    }, data);
  }

  function commitOutreach(payload) {
    const found = Views.findEngagement(state, payload.engagementId);
    if (!found) return;
    state.activities.push({
      id: U.uid(),
      engagementId: payload.engagementId,
      date: payload.date,
      undated: false,
      type: payload.outreachType,
      kind: "outreach",
      outreachType: payload.outreachType,
      contactId: payload.contactId,
      teamMember: payload.teamMember,
      summary: payload.summary,
      createdAt: new Date().toISOString()
    });
    if (payload.next && payload.next.title) {
      state.tasks.push(newTask({
        title: payload.next.title,
        owner: payload.next.owner || "",
        dueDate: payload.next.dueDate || "",
        projectId: found.project.id,
        engagementId: payload.engagementId,
        source: "outreach-follow-up"
      }));
    }
    commit();
    U.toast(payload.next && payload.next.title ? "Outreach recorded and next action scheduled." : "Outreach recorded.");
  }

  function commitActivityEdit(id, data) {
    const a = state.activities.find(function (x) { return x.id === id; });
    if (!a) return;
    a.date = data.date;
    a.undated = !data.date;
    a.type = data.type;
    a.kind = U.activityKindOf(data.type);
    a.outreachType = a.kind === "outreach" && U.OUTREACH_TYPES.indexOf(data.type) !== -1 ? data.type : "";
    a.contactId = data.contactId;
    a.teamMember = data.teamMember;
    a.summary = data.summary;
    commit();
    U.toast("Activity updated.");
  }

  function commitAgreement(projectId, payload) {
    const project = state.projects.find(function (p) { return p.id === projectId; });
    if (!project) return;
    const ag = project.agreement || CRM_MIGRATION.defaultAgreement();
    const before = ag.status;
    const partial = !!(payload.keepSent || payload.keepSigned);
    ["status", "sentDate", "sentBy", "signedDate", "docLink", "notes"].forEach(function (k) {
      if (payload[k] !== undefined) ag[k] = payload[k];
    });
    if (before !== ag.status || (partial && payload.notes)) {
      ag.history = ag.history || [];
      ag.history.push({
        id: U.uid(),
        date: payload.signedDate || payload.sentDate || U.todayISO(),
        from: before,
        to: ag.status,
        by: payload.sentBy || getMyOwner() || "",
        note: payload.notes || ""
      });
    }
    project.agreement = ag;
    commit();
    U.toast("Agreement status: " + U.agreementInfo(ag.status).label + ".");
  }

  function commitStageChange(projectId, toStageId, meta) {
    const project = state.projects.find(function (p) { return p.id === projectId; });
    if (!project) return;
    const from = project.deliveryStage;
    project.deliveryStage = toStageId;
    project.stageHistory = project.stageHistory || [];
    project.stageHistory.push({
      id: U.uid(),
      from: from,
      to: toStageId,
      date: meta.date,
      by: meta.by || "",
      note: meta.note || ""
    });
    commit();
    const info = U.projectStageInfo(toStageId);
    const hasTemplates = (state.taskTemplates || []).some(function (t) { return t.stage === toStageId && t.enabled; });
    if (hasTemplates) {
      U.toast("Stage set to " + (info ? info.label : toStageId) + " — apply this stage's task templates?", "info");
      Modals.templatesApplyModal(state, project, toStageId);
    } else {
      U.toast("Stage set to " + (info ? info.label : toStageId) + ".");
    }
  }

  function commitMilestones(projectId, list) {
    const project = state.projects.find(function (p) { return p.id === projectId; });
    if (!project) return;
    project.milestones = list;
    commit();
    U.toast("Milestones saved.");
  }

  function commitApplyTemplates(projectId, stageId, picks) {
    const project = state.projects.find(function (p) { return p.id === projectId; });
    if (!project) return;
    let created = 0;
    picks.forEach(function (p) {
      state.tasks.push(newTask({
        title: p.template.title,
        owner: p.owner || "",
        dueDate: p.due || "",
        projectId: project.id,
        stage: stageId,
        kind: "task",
        templateKey: stageId + ":" + U.normalizeKey(p.template.title),
        source: "template"
      }));
      created++;
    });
    commit();
    U.toast(created + " task" + (created === 1 ? "" : "s") + " created from templates.");
  }

  function commitTemplates(list) {
    state.taskTemplates = list;
    commit();
    U.toast("Templates saved.");
  }

  function commitBulkAssign(projectId, investorIds) {
    const project = state.projects.find(function (p) { return p.id === projectId; });
    if (!project) return;
    let added = 0;
    let skipped = 0;
    investorIds.forEach(function (invId) {
      const inv = Views.investorById(state, invId);
      if (!inv) return;
      const dup = project.engagements.find(function (e) { return !e.archived && e.investorId === invId; });
      if (dup) { skipped++; return; }
      project.engagements.push({
        id: U.uid(),
        investorId: invId,
        stage: "not_contacted",
        priority: "",
        owner: "",
        contactIds: [],
        notes: "",
        archived: false,
        legacy: null,
        reviewFlags: []
      });
      added++;
    });
    ui.selectedInvestors = [];
    commit();
    U.toast(added + " assigned to " + project.name + (skipped ? " · " + skipped + " already there" : "") + ".");
  }

  function applyImportPlan(plan) {
    const investorsCreated = [];
    let contactsCreated = 0;
    let engagementsCreated = 0;
    let skipped = 0;
    const projectById = {};
    state.projects.forEach(function (p) { projectById[p.id] = p; });
    const dest = plan.destination || "";

    plan.rows.forEach(function (row) {
      if (row.action === "reject" || row.action === "skip") { skipped++; return; }
      const d = row.data || {};
      let inv = row.investorId ? Views.investorById(state, row.investorId) : null;
      if (!inv) {
        inv = {
          id: U.uid(),
          name: row.name,
          type: d.type || "",
          website: "",
          location: "",
          preferences: "",
          notes: "",
          archived: false,
          contacts: []
        };
        state.investors.push(inv);
        investorsCreated.push(inv.name);
      }
      if ((d.contactName || d.contactEmail) && !inv.contacts.some(function (c) {
        if (d.contactEmail && c.email) return U.normalizeKey(c.email) === U.normalizeKey(d.contactEmail);
        return d.contactName && c.name && U.normalizeKey(c.name) === U.normalizeKey(d.contactName);
      })) {
        const flags = [];
        if (d.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.contactEmail)) flags.push("invalid-email-format");
        inv.contacts.push({
          id: U.uid(),
          name: d.contactName || "",
          title: d.contactTitle || "",
          email: d.contactEmail || "",
          phone: d.contactPhone || "",
          notes: "",
          isPrimary: inv.contacts.length === 0,
          reviewFlags: flags
        });
        contactsCreated++;
      }
      const target = row.projectId ? projectById[row.projectId] : (dest ? projectById[dest] : null);
      if (!target) return;
      if (target.engagements.some(function (e) { return !e.archived && e.investorId === inv.id; })) { skipped++; return; }

      const reached = /^(yes|y|true|1|done)$/i.test(String(d.reached || "").trim());
      const legacy = {
        reachedOut: reached,
        whoReachedOut: d.owner || "",
        dateReachedOut: d.outreachDate || "",
        response: d.response || "",
        movingForward: d.movingForward || "",
        nextSteps: d.nextSteps || ""
      };
      const derived = reached ? CRM_MIGRATION.deriveStage(legacy) : { stage: "not_contacted", flags: [] };
      const engagement = {
        id: U.uid(),
        investorId: inv.id,
        stage: derived.stage,
        priority: "",
        owner: legacy.whoReachedOut,
        contactIds: [],
        notes: "",
        archived: false,
        legacy: legacy,
        reviewFlags: derived.flags.slice()
      };
      if (row.action === "uncertain" && row.suggestion) {
        engagement.reviewFlags.push('possible-duplicate-name: file row may match "' + row.suggestion + '" — verify or merge manually');
      }
      target.engagements.push(engagement);
      engagementsCreated++;
      if (reached) {
        const validDate = d.outreachDate && U.isValidISODate(d.outreachDate) ? d.outreachDate : null;
        state.activities.push({
          id: U.uid(),
          engagementId: engagement.id,
          date: validDate,
          undated: !validDate,
          type: "Other outreach",
          kind: "outreach",
          outreachType: "",
          contactId: null,
          teamMember: legacy.whoReachedOut || "",
          summary: "Outreach imported from " + (plan.fileName || "file"),
          legacy: !validDate,
          createdAt: new Date().toISOString()
        });
        if (!validDate) engagement.reviewFlags.push("imported-outreach-undated: outreach recorded without a valid date — verify");
      }
    });

    commit();
    const msg = investorsCreated.length + " investors created · " + engagementsCreated + " assignments · " + contactsCreated + " contacts" +
      (skipped ? " · " + skipped + " skipped" : "");
    U.toast("Import finished: " + msg + ".", investorsCreated.length || engagementsCreated ? "success" : "info");
  }

  function handleRestoreFile(file) {
    const reader = new FileReader();
    reader.onload = function () {
      let parsed;
      try { parsed = JSON.parse(reader.result); }
      catch (e) { U.toast("Could not read file: " + e.message, "error"); return; }
      let incoming;
      try {
        incoming = CRM_MIGRATION.migrate(parsed).state;
      } catch (e) {
        U.toast("Cannot restore: " + e.message, "error");
        return;
      }
      if (!confirm("Replace ALL current data with this backup? This cannot be undone from the app (export a backup first).")) return;
      state = incoming;
      const first = state.projects.find(function (p) { return !p.archived; });
      ui.projectId = state.activeProjectId || (first ? first.id : null);
      ui.detailInvestorId = null;
      ui.stageDetail = null;
      ui.selectedInvestors = [];
      commit();
      U.toast("Backup restored.", "success");
    };
    reader.readAsText(file);
  }

  function getMyOwner() {
    return readMyOwner();
  }

  function setMyOwner(value) {
    ui.myOwner = value === "Suzana" || value === "Bruno" ? value : "";
    try {
      if (ui.myOwner) localStorage.setItem("hartmann-crm-me", ui.myOwner);
      else localStorage.removeItem("hartmann-crm-me");
    } catch (e) { }
  }

  function commitTask(id, data) {
    if (id) {
      const t = state.tasks.find(function (x) { return x.id === id; });
      if (t) Object.assign(t, data);
      U.toast("Task updated.");
    } else {
      state.tasks.push(newTask(data));
      U.toast(data.kind === "appointment" ? "Appointment created." : "Task created.");
    }
    commit();
  }

  function commitProject(id, name) {
    if (id) {
      const p = state.projects.find(function (x) { return x.id === id; });
      if (p) p.name = name;
      U.toast("Project renamed.");
    } else {
      const p = {
        id: U.uid(),
        name: name,
        archived: false,
        state: "active",
        deliveryStage: null,
        lead: "",
        milestones: [],
        stageNotes: {},
        stageHistory: [],
        agreement: CRM_MIGRATION.defaultAgreement(),
        engagements: []
      };
      state.projects.push(p);
      ui.projectId = p.id;
      state.activeProjectId = p.id;
      ui.view = "tracker";
      ui.search = "";
      ui.stageDetail = null;
      U.toast("Project created.");
    }
    commit();
  }

  function exportCsv() {
    const rows = [[
      "Project", "Investor", "Type", "Stage", "Priority", "Owner",
      "Contact Name", "Contact Title", "Contact Email", "Contact Phone",
      "Reached Out (legacy)", "Who Reached Out (legacy)", "Date Reached Out (legacy)",
      "Response (legacy)", "Moving Forward (legacy)", "Next Steps (legacy)", "Review Flags"
    ]];
    state.projects.forEach(function (p) {
      if (p.archived) return;
      p.engagements.forEach(function (e) {
        if (e.archived) return;
        const inv = Views.investorById(state, e.investorId);
        if (!inv) return;
        const legacy = e.legacy || {};
        const flags = (e.reviewFlags || []).concat(inv.contacts.flatMap(function (c) { return c.reviewFlags || []; })).join("; ");
        const base = [
          p.name, inv.name, inv.type, U.stageInfo(e.stage).label, e.priority, e.owner,
          "", "", "", "",
          legacy.reachedOut ? "Yes" : "No", legacy.whoReachedOut || "", legacy.dateReachedOut || "",
          legacy.response || "", legacy.movingForward || "", legacy.nextSteps || "", flags
        ];
        if (inv.contacts.length === 0) rows.push(base);
        else inv.contacts.forEach(function (c) {
          const row = base.slice();
          row[6] = c.name; row[7] = c.title; row[8] = c.email; row[9] = c.phone;
          rows.push(row);
        });
      });
    });
    const csv = rows.map(function (r) { return r.map(U.csvCell).join(","); }).join("\r\n");
    U.downloadBlob(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), "hartmann-crm-export.csv");
  }

  function handleImportJson(file) {
    const reader = new FileReader();
    reader.onload = function () {
      let parsed;
      try { parsed = JSON.parse(reader.result); }
      catch (e) { alert("Could not read file: " + e.message); return; }
      let incoming;
      try {
        const result = CRM_MIGRATION.migrate(parsed);
        incoming = result.state;
      } catch (e) {
        alert("Cannot import: " + e.message);
        return;
      }
      const mode = prompt("Import mode: type REPLACE to overwrite everything, or MERGE to add alongside existing data:", "MERGE");
      if (!mode) return;
      const m = mode.trim().toUpperCase();
      if (m === "REPLACE") {
        if (!confirm("Replace ALL current data with the imported file? This cannot be undone from the app (export a backup first).")) return;
        state = incoming;
        const first = state.projects.find(function (p) { return !p.archived; });
        ui.projectId = first ? first.id : null;
        state.activeProjectId = ui.projectId;
        ui.detailInvestorId = null;
        commit();
        U.toast("Import replaced the dataset.", "info");
      } else if (m === "MERGE") {
        remapIds(incoming);
        state.investors = state.investors.concat(incoming.investors);
        state.projects = state.projects.concat(incoming.projects);
        state.activities = state.activities.concat(incoming.activities);
        state.tasks = state.tasks.concat(incoming.tasks);
        if (!state.activeProjectId) state.activeProjectId = incoming.activeProjectId || state.activeProjectId;
        commit();
        U.toast("Merged " + incoming.investors.length + " investors and " + incoming.projects.length + " projects (ids remapped to avoid clashes).", "info");
      } else {
        alert("Unknown mode. Type REPLACE or MERGE.");
      }
    };
    reader.readAsText(file);
  }

  function handleImportCsv(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const rows = U.parseCsv(reader.result);
        if (rows.length < 2) { alert("CSV file seems empty."); return; }
        const headers = rows[0].map(function (h, i) { return String(h || ("col" + i)).trim(); });
        const findCol = function (names) {
          for (let i = 0; i < headers.length; i++) {
            if (names.indexOf(U.normalizeKey(headers[i])) !== -1) return i;
          }
          return -1;
        };
        const nameCol = findCol(["company", "company name", "investor", "investor name", "institution", "institution name", "name", "organization", "organisation"]);
        if (nameCol === -1) { alert("Could not find an investor/company name column. Headers: " + headers.join(", ")); return; }
        const typeCol = findCol(["type", "company type", "investor type", "category"]);
        const priorityCol = findCol(["priority", "importance"]);
        const cNameCol = findCol(["contact name", "full name", "contact person", "person"]);
        const cTitleCol = findCol(["contact title", "title", "job title", "role", "position"]);
        const cEmailCol = findCol(["contact email", "email", "e-mail", "email address"]);
        const cPhoneCol = findCol(["phone", "telephone", "tel"]);
        const reachedCol = findCol(["reached out", "reached out (legacy)", "outreach", "contacted"]);
        const whoCol = findCol(["who reached out", "who reached out (legacy)", "owner", "who"]);
        const dateCol = findCol(["date reached out", "date reached out (legacy)", "date", "outreach date"]);
        const respCol = findCol(["response", "response (legacy)"]);
        const movingCol = findCol(["moving forward", "moving forward (legacy)"]);
        const nextCol = findCol(["next steps", "next steps (legacy)"]);
        const stageCol = findCol(["stage"]);

        const project = activeProject() || state.projects.find(function (p) { return !p.archived; });
        if (!project) {
          const p = { id: U.uid(), name: file.name.replace(/\.csv$/i, "") || "Imported", archived: false, engagements: [] };
          state.projects.push(p);
          ui.projectId = p.id;
          state.activeProjectId = p.id;
        }
        const target = activeProject() || state.projects[state.projects.length - 1];
        let newInvestors = 0, newEngagements = 0, newContacts = 0, rowsSkipped = 0;

        const get = function (row, col) { return col >= 0 && col < row.length ? String(row[col] || "").trim() : ""; };

        for (let r = 1; r < rows.length; r++) {
          const row = rows[r];
          const invName = get(row, nameCol);
          if (!invName) { rowsSkipped++; continue; }
          let inv = state.investors.find(function (i) { return U.normalizeKey(i.name) === U.normalizeKey(invName); });
          if (!inv) {
            inv = { id: U.uid(), name: invName, type: get(row, typeCol), website: "", location: "", preferences: "", notes: "", archived: false, contacts: [] };
            state.investors.push(inv);
            newInvestors++;
          } else if (!inv.type && get(row, typeCol)) {
            inv.type = get(row, typeCol);
          }
          let engagement = target.engagements.find(function (e) { return !e.archived && e.investorId === inv.id; });
          const isNewEngagement = !engagement;
          if (!engagement) {
            const legacy = {
              reachedOut: false, whoReachedOut: "", dateReachedOut: "",
              response: "", movingForward: "", nextSteps: ""
            };
            const reached = get(row, reachedCol).toLowerCase();
            if (reachedCol >= 0 && ["yes", "y", "true", "1", "done"].indexOf(reached) !== -1) legacy.reachedOut = true;
            if (whoCol >= 0) legacy.whoReachedOut = get(row, whoCol);
            if (dateCol >= 0) legacy.dateReachedOut = get(row, dateCol);
            if (respCol >= 0) legacy.response = get(row, respCol);
            if (movingCol >= 0) legacy.movingForward = get(row, movingCol);
            if (nextCol >= 0) legacy.nextSteps = get(row, nextCol);
            const derived = CRM_MIGRATION.deriveStage(legacy);
            const stage = stageCol >= 0 && get(row, stageCol) ? (function () {
              const s = U.normalizeKey(get(row, stageCol));
              const found = U.STAGES.find(function (x) { return x.id === s || U.normalizeKey(x.label) === s; });
              return found ? found.id : derived.stage;
            })() : derived.stage;
            engagement = {
              id: U.uid(), investorId: inv.id, stage: stage,
              priority: priorityCol >= 0 ? get(row, priorityCol) : "",
              owner: legacy.whoReachedOut, contactIds: [], notes: "", archived: false,
              legacy: legacy, reviewFlags: derived.flags
            };
            target.engagements.push(engagement);
            newEngagements++;
            if (legacy.reachedOut && legacy.dateReachedOut) {
              state.activities.push({
                id: U.uid(), engagementId: engagement.id, date: legacy.dateReachedOut, undated: false,
                type: "Outreach", contactId: null, teamMember: legacy.whoReachedOut,
                summary: "Outreach imported from CSV", createdAt: new Date().toISOString()
              });
            }
          }
          const cName = get(row, cNameCol);
          const cEmail = get(row, cEmailCol);
          if (cName || cEmail) {
            let contact = inv.contacts.find(function (c) {
              if (cEmail && c.email) return U.normalizeKey(c.email) === U.normalizeKey(cEmail);
              return cName && c.name && U.normalizeKey(c.name) === U.normalizeKey(cName);
            });
            if (!contact) {
              const flags = [];
              if (cEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cEmail)) flags.push("invalid-email-format");
              contact = {
                id: U.uid(), name: cName, title: get(row, cTitleCol), email: cEmail,
                phone: get(row, cPhoneCol), notes: "", isPrimary: inv.contacts.length === 0,
                reviewFlags: flags
              };
              inv.contacts.push(contact);
              newContacts++;
            }
          }
        }
        commit();
        alert("CSV import complete.\n\nNew investors: " + newInvestors +
          "\nNew engagements: " + newEngagements +
          "\nNew contacts: " + newContacts +
          "\nRows skipped (no name): " + rowsSkipped);
      } catch (e) {
        alert("Could not import CSV: " + e.message);
      }
    };
    reader.readAsText(file);
  }

  function wireEvents() {
    document.addEventListener("click", function (event) {
      if (event.target.closest("[data-stop]")) return;
      const actionTarget = event.target.closest("[data-action]");
      if (actionTarget) {
        const name = actionTarget.dataset.action;
        if (actions[name] && name.charAt(0) !== "_") {
          event.preventDefault();
          actions[name](actionTarget.dataset, event);
          return;
        }
      }
      const menu = el("menu");
      if (!menu.classList.contains("hidden") &&
        !event.target.closest("#menu") &&
        !event.target.closest("#menu-btn")) {
        menu.classList.add("hidden");
      }
    });

    document.addEventListener("change", function (event) {
      const target = event.target.closest("[data-change]");
      if (!target || !state) return;
      const kind = target.dataset.change;
      if (kind === "stage" || kind === "priority" || kind === "owner") {
        let found = null;
        state.projects.forEach(function (p) {
          p.engagements.forEach(function (e) { if (e.id === target.dataset.id) found = e; });
        });
        if (found) {
          found[kind] = target.value;
          commit();
        }
        return;
      }
      if (kind === "toggle-task") {
        const task = state.tasks.find(function (t) { return t.id === target.dataset.id; });
        if (task) {
          if (target.checked) task.status = "Completed";
          else task.status = task.status === "Completed" ? "To do" : task.status;
          commit();
        }
        return;
      }
      if (kind === "stageFilter") { ui.stageFilter = target.value; render(); return; }
      if (kind === "reviewOnly") { ui.reviewOnly = target.checked; render(); return; }
      if (kind === "taskStatus") { ui.taskStatus = target.value; render(); return; }
      if (kind === "taskOwner") { ui.taskOwner = target.value; render(); return; }
      if (kind === "taskProjectOnly") { ui.taskProjectOnly = target.checked; render(); return; }
      if (kind === "taskDue") { ui.taskDue = target.value; render(); return; }
      if (kind === "taskKind") { ui.taskKind = target.value; render(); return; }
      if (kind === "myOwner") { setMyOwner(target.value); render(); return; }
      if (kind === "myTasksOnly") { ui.myTasksOnly = target.checked; render(); return; }
      if (kind === "calendarOwner") { ui.calendarOwner = target.value; render(); return; }
      if (kind === "calendarKind") { ui.calendarKind = target.value; render(); return; }
      if (kind === "ovProject") { ui.ovProject = target.value; render(); return; }
      if (kind === "ovOwner") { ui.ovOwner = target.value; render(); return; }
      if (kind === "ovPeriod") { ui.ovPeriod = target.value; render(); return; }
      if (kind === "select-investor") {
        const id = target.dataset.id;
        const set = new Set(ui.selectedInvestors);
        if (target.checked) set.add(id); else set.delete(id);
        ui.selectedInvestors = Array.from(set);
        render();
        return;
      }
      if (kind === "select-all-investors") {
        const container = el("view-directory");
        const ids = Array.from(container.querySelectorAll('[data-change="select-investor"]')).map(function (i) { return i.dataset.id; });
        ui.selectedInvestors = target.checked ? ids : [];
        render();
        return;
      }
      if (kind === "stageNotes") {
        const project = Views.projectById(state, target.dataset.projectId);
        if (project) {
          project.stageNotes = project.stageNotes || {};
          project.stageNotes[target.dataset.stageId] = target.value;
          Store.markDirty();
        }
        return;
      }
      if (kind === "projectLead") {
        const project = Views.projectById(state, target.dataset.id);
        if (project) {
          project.lead = target.value;
          commit();
        }
        return;
      }
    });

    document.addEventListener("input", function (event) {
      const target = event.target.closest("[data-input]");
      if (!target) return;
      if (target.dataset.input === "search") {
        ui.search = target.value;
        render();
      }
    });

    document.addEventListener("dragstart", function (event) {
      const card = event.target.closest ? event.target.closest(".kanban-card") : null;
      if (!card) return;
      actions._dragging = true;
      event.dataTransfer.setData("text/plain", card.dataset.id);
      event.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    });

    document.addEventListener("dragend", function (event) {
      actions._dragging = false;
      const card = event.target.closest ? event.target.closest(".kanban-card") : null;
      if (card) card.classList.remove("dragging");
      document.querySelectorAll(".kanban-col.drop-target").forEach(function (c) { c.classList.remove("drop-target"); });
    });

    document.addEventListener("dragover", function (event) {
      const col = event.target.closest ? event.target.closest(".kanban-col") : null;
      if (!col) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      document.querySelectorAll(".kanban-col.drop-target").forEach(function (c) {
        if (c !== col) c.classList.remove("drop-target");
      });
      col.classList.add("drop-target");
    });

    document.addEventListener("dragleave", function (event) {
      const col = event.target.closest ? event.target.closest(".kanban-col") : null;
      if (col && (!event.relatedTarget || !col.contains(event.relatedTarget))) col.classList.remove("drop-target");
    });

    document.addEventListener("drop", function (event) {
      const col = event.target.closest ? event.target.closest(".kanban-col") : null;
      if (!col || !state) return;
      event.preventDefault();
      col.classList.remove("drop-target");
      const id = event.dataTransfer.getData("text/plain");
      const task = state.tasks.find(function (t) { return t.id === id; });
      const status = col.dataset.dropStatus;
      if (!task || !status || task.status === status) return;
      task.status = status;
      if (status !== "Waiting") task.waitingReason = "";
      commit();
      U.toast('Task moved to "' + status + '".');
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (Modals.isOpen()) { Modals.close(); return; }
        if (!el("conflict-backdrop").classList.contains("hidden")) return;
        if (!el("detail-drawer").classList.contains("hidden")) { closeDetail(); return; }
        if (!el("menu").classList.contains("hidden")) el("menu").classList.add("hidden");
      }
    });

    el("modal-form").addEventListener("submit", Modals.handleSubmit);
    el("modal-close").addEventListener("click", Modals.close);
    el("modal-cancel").addEventListener("click", Modals.close);
    el("modal-backdrop").addEventListener("click", function (e) {
      if (e.target === el("modal-backdrop")) Modals.close();
    });
    el("detail-close").addEventListener("click", closeDetail);
    el("detail-backdrop").addEventListener("click", closeDetail);
    el("conflict-reload").addEventListener("click", actions["conflict-reload"]);
    el("conflict-overwrite").addEventListener("click", actions["conflict-overwrite"]);
    el("fatal-retry").addEventListener("click", actions["fatal-retry"]);
    el("save-status").addEventListener("click", function () {
      if (el("save-status").dataset.kind === "error") Store.flushNow();
    });

    el("import-json-input").addEventListener("change", function (e) {
      if (e.target.files[0]) handleImportJson(e.target.files[0]);
      e.target.value = "";
    });
    el("import-csv-input").addEventListener("change", function (e) {
      if (e.target.files[0]) handleImportCsv(e.target.files[0]);
      e.target.value = "";
    });
    el("import-investors-input").addEventListener("change", function (e) {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      if (!state) { U.toast("Load the CRM before importing.", "error"); return; }
      Modals.importWizardModal(state, { file: file });
    });

    const chatForm = el("chat-form");
    if (chatForm) {
      chatForm.addEventListener("submit", function (e) { e.preventDefault(); chatSend(); });
    }
    const chatInput = el("chat-input");
    if (chatInput) {
      chatInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chatSend(); }
      });
      chatInput.addEventListener("input", function () {
        this.style.height = "auto";
        this.style.height = Math.min(this.scrollHeight, 120) + "px";
      });
    }
    const notifBtn = el("notif-btn");
    if (notifBtn) notifBtn.addEventListener("click", function (e) { e.stopPropagation(); toggleNotif(); });
    document.addEventListener("click", function (e) {
      const panel = el("notif-panel");
      if (panel && !panel.classList.contains("hidden") && !e.target.closest("#notif-panel")) {
        closeNotif();
      }
    });
  }

  function themePref() {
    let saved = null;
    try { saved = localStorage.getItem("hartmann-crm-theme"); } catch (e) { }
    return (saved === "light" || saved === "dark") ? saved : "system";
  }

  function applyTheme(pref) {
    const root = document.documentElement;
    root.classList.toggle("light", pref === "light");
    root.classList.toggle("dark", pref === "dark");
    const next = pref === "system" ? "light" : (pref === "light" ? "dark" : "system");
    const label = next === "light" ? "Light UI" : (next === "dark" ? "Dark UI" : "System UI");
    const a = el("theme-toggle-label"); if (a) a.textContent = label;
    const b = el("theme-toggle-label-menu"); if (b) b.textContent = label;
  }

  function initTheme() {
    applyTheme(themePref());
  }

  function init() {
    initTheme();
    acquireTokenFromLink();
    Store.init({
      getState: function () { return state; },
      onStatus: setStatus,
      onUnauthorized: function () { setStatus("", "Access key rejected"); showAccess(); },
      onConflict: function (payload) {
        actions._conflictPayload = payload;
        showConflict(payload);
      },
      onSaved: refreshChanges
    });
    wireEvents();
    window.addEventListener("beforeunload", function (event) {
      if (Store.isDirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
    window.addEventListener("online", function () { updateSyncIndicator(); refreshNow(); });
    window.addEventListener("offline", function () { updateSyncIndicator(); });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) refreshNow();
    });
    window.addEventListener("focus", function () { if (!document.hidden) refreshNow(); });
    updateSyncIndicator();
    scheduleSync(4000);
    bootstrap();
  }

  return {
    init: init,
    commitInvestor: commitInvestor,
    commitContact: commitContact,
    commitEngagement: commitEngagement,
    commitActivity: commitActivity,
    commitActivityEdit: commitActivityEdit,
    commitOutreach: commitOutreach,
    commitAgreement: commitAgreement,
    commitStageChange: commitStageChange,
    commitMilestones: commitMilestones,
    commitApplyTemplates: commitApplyTemplates,
    commitTemplates: commitTemplates,
    commitBulkAssign: commitBulkAssign,
    commitTask: commitTask,
    commitProject: commitProject,
    applyImportPlan: applyImportPlan,
    handleRestoreFile: handleRestoreFile,
    getMyOwner: getMyOwner,
    getState: function () { return state; },
    getUi: function () { return ui; },
    openDetail: openDetail,
    closeDrawer: closeDrawer
  };
})();

document.addEventListener("DOMContentLoaded", App.init);
