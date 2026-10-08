window.App = (function () {
  "use strict";

  let state = null;
  const ui = {
    view: "overview",
    projectId: null,
    search: "",
    stageFilter: "",
    reviewOnly: false,
    taskStatus: "",
    taskOwner: "",
    taskProjectOnly: false,
    detailInvestorId: null,
    detailEngagementId: null
  };

  const VIEW_META = {
    overview: { title: "Overview", primary: "＋ New project", action: "add-project" },
    tracker: { title: "Project tracker", primary: "＋ Add engagement", action: "add-engagement" },
    directory: { title: "Investor Directory", primary: "＋ Add investor", action: "add-investor" },
    tasks: { title: "Tasks", primary: "＋ Add task", action: "add-task" }
  };

  function el(id) { return document.getElementById(id); }

  function emptyState() {
    return { schemaVersion: 2, investors: [], projects: [], activities: [], tasks: [], activeProjectId: null };
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
    const meta = VIEW_META[ui.view] || VIEW_META.overview;
    let title = meta.title;
    let subtitle = "";
    if (ui.view === "tracker") {
      const p = activeProject();
      title = p ? p.name : "Project tracker";
      subtitle = p ? p.engagements.filter(function (e) { return !e.archived; }).length + " engagements" : "Select or create a project";
    } else if (ui.view === "directory") {
      subtitle = state.investors.length + " investors";
    } else if (ui.view === "tasks") {
      subtitle = Views.openTasks(state).length + " open tasks";
    } else {
      subtitle = state.investors.length + " investors · " + Views.allEngagements(state).length + " engagements";
    }
    el("view-title").textContent = title;
    el("view-subtitle").textContent = subtitle;
    const primary = el("primary-action-btn");
    primary.textContent = meta.primary;
    primary.dataset.action = meta.action;

    document.querySelectorAll(".view").forEach(function (v) { v.classList.add("hidden"); });
    const container = el("view-" + ui.view);
    container.classList.remove("hidden");
    const hadSearchFocus = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.input === "search";
    if (ui.view === "overview") container.innerHTML = Views.overview(state, ui);
    else if (ui.view === "tracker") container.innerHTML = Views.tracker(state, ui);
    else if (ui.view === "directory") container.innerHTML = Views.directory(state, ui);
    else if (ui.view === "tasks") container.innerHTML = Views.tasks(state, ui);
    if (hadSearchFocus) {
      const input = container.querySelector('[data-input="search"]');
      if (input) {
        input.focus();
        const v = input.value;
        input.setSelectionRange(v.length, v.length);
      }
    }
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
    const flags = Views.reviewCount(state);
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
        return;
      }
      const migrated = CRM_MIGRATION.migrate(result.data);
      state = migrated.state;
      const firstProject = state.projects.find(function (p) { return !p.archived; });
      ui.projectId = state.activeProjectId || (firstProject ? firstProject.id : null);
      render();
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

  const actions = {
    "open-view": function (ds) { switchView(ds.view); },
    "open-project": function (ds) {
      ui.projectId = ds.id;
      ui.view = "tracker";
      ui.search = "";
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
    "export-json": function () {
      U.downloadBlob(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }), "hartmann-crm-backup.json");
    },
    "export-csv": function () { exportCsv(); },
    "reload-data": function () {
      if (Store.isDirty() && !confirm("You have unsaved changes. Reload from the backend and discard them?")) return;
      bootstrap();
    },
    "toggle-theme": function () {
      const isLight = document.documentElement.classList.toggle("light");
      el("theme-toggle-label").textContent = isLight ? "Dark UI" : "Light UI";
      try { localStorage.setItem("hartmann-crm-theme", isLight ? "light" : "dark"); } catch (e) { }
    },
    "toggle-menu": function () { el("menu").classList.toggle("hidden"); },
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
    state.activities.push({
      id: U.uid(),
      engagementId: payload.engagementId,
      date: payload.date,
      undated: !payload.date,
      type: payload.type,
      contactId: payload.contactId,
      teamMember: payload.teamMember,
      summary: payload.summary,
      createdAt: new Date().toISOString()
    });
    if (payload.changeStage) found.engagement.stage = payload.changeStage;
    if (payload.follow && payload.follow.title) {
      state.tasks.push({
        id: U.uid(),
        title: payload.follow.title,
        owner: payload.follow.owner || "",
        dueDate: payload.follow.dueDate || "",
        status: "To do",
        priority: "",
        notes: "",
        projectId: found.project.id,
        engagementId: payload.engagementId,
        contactId: "",
        reviewFlags: [],
        source: "follow-up"
      });
    }
    commit();
    U.toast(payload.follow && payload.follow.title ? "Activity logged and follow-up scheduled." : "Activity logged.");
  }

  function commitTask(id, data) {
    if (id) {
      const t = state.tasks.find(function (x) { return x.id === id; });
      if (t) Object.assign(t, data);
      U.toast("Task updated.");
    } else {
      state.tasks.push(Object.assign({ id: U.uid(), reviewFlags: [] }, data));
      U.toast("Task created.");
    }
    commit();
  }

  function commitProject(id, name) {
    if (id) {
      const p = state.projects.find(function (x) { return x.id === id; });
      if (p) p.name = name;
      U.toast("Project renamed.");
    } else {
      const p = { id: U.uid(), name: name, archived: false, engagements: [] };
      state.projects.push(p);
      ui.projectId = p.id;
      state.activeProjectId = p.id;
      ui.view = "tracker";
      ui.search = "";
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
    });

    document.addEventListener("input", function (event) {
      const target = event.target.closest("[data-input]");
      if (!target) return;
      if (target.dataset.input === "search") {
        ui.search = target.value;
        render();
      }
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
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem("hartmann-crm-theme"); } catch (e) { }
    if (saved === "light") {
      document.documentElement.classList.add("light");
      el("theme-toggle-label").textContent = "Dark UI";
    }
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
      }
    });
    wireEvents();
    window.addEventListener("beforeunload", function (event) {
      if (Store.isDirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
    bootstrap();
  }

  return {
    init: init,
    commitInvestor: commitInvestor,
    commitContact: commitContact,
    commitEngagement: commitEngagement,
    commitActivity: commitActivity,
    commitTask: commitTask,
    commitProject: commitProject,
    getState: function () { return state; },
    getUi: function () { return ui; },
    openDetail: openDetail
  };
})();

document.addEventListener("DOMContentLoaded", App.init);
