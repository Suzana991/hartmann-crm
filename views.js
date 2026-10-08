window.Views = (function () {
  "use strict";

  function investorById(state, id) {
    return state.investors.find(function (i) { return i.id === id; }) || null;
  }

  function projectById(state, id) {
    return state.projects.find(function (p) { return p.id === id; }) || null;
  }

  function allEngagements(state) {
    const out = [];
    state.projects.forEach(function (p) {
      p.engagements.forEach(function (e) {
        if (!e.archived) out.push({ engagement: e, project: p });
      });
    });
    return out;
  }

  function activitiesFor(state, engagementId) {
    return state.activities
      .filter(function (a) { return a.engagementId === engagementId; })
      .sort(function (a, b) {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date < b.date ? 1 : -1;
      });
  }

  function investorActivities(state, investorId) {
    const engIds = new Set();
    state.projects.forEach(function (p) {
      p.engagements.forEach(function (e) {
        if (e.investorId === investorId) engIds.add(e.id);
      });
    });
    return state.activities
      .filter(function (a) { return engIds.has(a.engagementId); })
      .sort(function (a, b) {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date < b.date ? 1 : -1;
      });
  }

  function lastOutreach(state, engagement) {
    const acts = activitiesFor(state, engagement.id).filter(function (a) { return a.type === "Outreach" || a.type === "Email" || a.type === "Call" || a.type === "Meeting"; });
    if (acts.length === 0) {
      if (engagement.legacy && engagement.legacy.reachedOut) return { text: "Undated (legacy)", undated: true };
      return { text: "—", undated: false };
    }
    const dated = acts.find(function (a) { return !!a.date; });
    if (dated) return { text: U.fmtDate(dated.date), undated: false };
    return { text: "Undated (legacy)", undated: true };
  }

  function investorLastOutreach(state, investorId) {
    let best = null;
    state.projects.forEach(function (p) {
      p.engagements.forEach(function (e) {
        if (e.investorId !== investorId || e.archived) return;
        const lo = lastOutreach(state, e);
        if (lo.text === "—") return;
        if (!best) { best = lo; return; }
        if (!lo.undated && (best.undated || lo.text > best.text)) best = lo;
      });
    });
    return best || { text: "—", undated: false };
  }

  function engagementFlags(engagement) {
    return engagement.reviewFlags || [];
  }

  function contactFlagCount(state, investorId) {
    const inv = investorById(state, investorId);
    if (!inv) return 0;
    return inv.contacts.reduce(function (n, c) { return n + (c.reviewFlags || []).length; }, 0);
  }

  function engagementTasks(state, engagementId) {
    return state.tasks.filter(function (t) { return t.engagementId === engagementId && t.status !== "Completed"; });
  }

  function openTasks(state) {
    return state.tasks.filter(function (t) { return t.status !== "Completed"; });
  }

  function reviewCount(state) {
    let n = 0;
    state.projects.forEach(function (p) {
      p.engagements.forEach(function (e) { n += engagementFlags(e).length; });
    });
    state.investors.forEach(function (i) {
      i.contacts.forEach(function (c) { n += (c.reviewFlags || []).length; });
    });
    state.tasks.forEach(function (t) { n += (t.reviewFlags || []).length; });
    return n;
  }

  function sidebar(projects, activeProjectId) {
    if (projects.length === 0) {
      return '<div class="empty-mini">No projects yet</div>';
    }
    return projects.filter(function (p) { return !p.archived; }).map(function (p) {
      const count = p.engagements.filter(function (e) { return !e.archived; }).length;
      return '<button class="project-row' + (p.id === activeProjectId ? " active" : "") + '" data-action="open-project" data-id="' + U.esc(p.id) + '">' +
        '<span class="project-row-name">' + U.esc(p.name) + "</span>" +
        '<span class="project-row-count">' + count + "</span>" +
        "</button>";
    }).join("");
  }

  function overview(state, ui) {
    const engs = allEngagements(state);
    const contacted = engs.filter(function (x) { return lastOutreach(state, x.engagement).text !== "—" || (x.engagement.legacy && x.engagement.legacy.reachedOut); });
    const open = openTasks(state);
    const flags = reviewCount(state);
    const cards = [
      { label: "Projects", value: state.projects.filter(function (p) { return !p.archived; }).length },
      { label: "Investors", value: state.investors.length },
      { label: "Engagements", value: engs.length },
      { label: "Contacted", value: contacted.length },
      { label: "Open tasks", value: open.length },
      { label: "Needs review", value: flags, alert: flags > 0 }
    ];
    const pipeline = U.STAGES.map(function (s) {
      const n = engs.filter(function (x) { return x.engagement.stage === s.id; }).length;
      const pct = engs.length ? Math.round((n / engs.length) * 100) : 0;
      return '<div class="pipe-row">' +
        '<span class="pipe-label">' + U.esc(s.label) + "</span>" +
        '<span class="pipe-bar"><span class="pipe-fill" style="width:' + pct + "%;background:" + s.color + '"></span></span>' +
        '<span class="pipe-count">' + n + "</span>" +
        "</div>";
    }).join("");

    const recent = state.activities.slice().sort(function (a, b) {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date < b.date ? 1 : -1;
    }).slice(0, 8).map(function (a) {
      const eng = findEngagement(state, a.engagementId);
      const inv = eng ? investorById(state, eng.engagement.investorId) : null;
      return '<div class="mini-row">' +
        '<span class="mini-date">' + (a.date ? U.esc(U.fmtDate(a.date)) : '<em>Undated</em>') + "</span>" +
        '<span class="mini-main">' + U.esc(inv ? inv.name : "Unknown") +
        (eng ? ' <span class="mini-sub">· ' + U.esc(eng.project.name) + "</span>" : "") + "</span>" +
        '<span class="mini-note">' + U.esc(a.summary || a.type) + "</span>" +
        "</div>";
    }).join("") || '<div class="empty-mini">No activities recorded yet.</div>';

    const due = open.slice().sort(function (a, b) {
      const da = a.dueDate || "9999-12-31";
      const db = b.dueDate || "9999-12-31";
      return da < db ? -1 : da > db ? 1 : 0;
    }).slice(0, 8).map(function (t) {
      const overdue = t.dueDate && t.dueDate < U.todayISO();
      const proj = t.projectId ? projectById(state, t.projectId) : null;
      return '<div class="mini-row" data-action="edit-task" data-id="' + U.esc(t.id) + '" role="button">' +
        '<span class="mini-main">' + U.esc(t.title) + "</span>" +
        '<span class="mini-note' + (overdue ? " overdue" : "") + '">' +
        (t.dueDate ? U.esc(U.fmtDate(t.dueDate)) : "No due date") +
        (t.owner ? " · " + U.esc(t.owner) : "") + (proj ? " · " + U.esc(proj.name) : "") +
        "</span></div>";
    }).join("") || '<div class="empty-mini">No open tasks.</div>';

    let migrationNote = "";
    if (state.migrationReport) {
      const r = state.migrationReport;
      migrationNote = '<div class="banner">Migrated from the legacy dataset on ' + U.esc(String(r.migratedAt).slice(0, 10)) +
        " — " + r.sourceCounts.institutions + " institutions, " + r.sourceCounts.contacts +
        " contacts and " + r.sourceCounts.tasks + " tasks preserved. " +
        (r.counts.reviewFlags ? r.counts.reviewFlags + " items flagged for review." : "") + "</div>";
    }

    return migrationNote +
      '<div class="card-row">' + cards.map(function (c) {
        return '<div class="stat-card' + (c.alert ? " alert" : "") + '"><div class="stat-value">' + c.value + "</div><div class=\"stat-label\">" + U.esc(c.label) + "</div></div>";
      }).join("") + "</div>" +
      '<div class="panel"><div class="panel-head"><h3>Pipeline</h3></div><div class="panel-body">' + pipeline + "</div></div>" +
      '<div class="split">' +
      '<div class="panel"><div class="panel-head"><h3>Recent activity</h3></div><div class="panel-body list">' + recent + "</div></div>" +
      '<div class="panel"><div class="panel-head"><h3>Tasks due</h3></div><div class="panel-body list">' + due + "</div></div>" +
      "</div>";
  }

  function findEngagement(state, engagementId) {
    for (const p of state.projects) {
      const e = p.engagements.find(function (x) { return x.id === engagementId; });
      if (e) return { engagement: e, project: p };
    }
    return null;
  }

  function tracker(state, ui) {
    const project = projectById(state, ui.projectId);
    if (!project) {
      return '<div class="empty-state"><p>Select a project from the sidebar, or create one.</p>' +
        '<button class="primary-btn" data-action="add-project">+ New project</button></div>';
    }
    const search = U.normalizeKey(ui.search);
    let rows = project.engagements.filter(function (e) { return !e.archived; });
    if (ui.stageFilter) rows = rows.filter(function (e) { return e.stage === ui.stageFilter; });
    if (ui.reviewOnly) rows = rows.filter(function (e) { return engagementFlags(e).length > 0 || contactFlagCount(state, e.investorId) > 0; });
    if (search) {
      rows = rows.filter(function (e) {
        const inv = investorById(state, e.investorId);
        if (!inv) return false;
        const hay = [inv.name, inv.type, e.owner, e.priority, e.notes].concat(
          inv.contacts.map(function (c) { return c.name + " " + c.title + " " + c.email; })
        ).join(" ");
        return U.normalizeKey(hay).indexOf(search) !== -1;
      });
    }
    const total = project.engagements.filter(function (e) { return !e.archived; }).length;
    const contactedN = project.engagements.filter(function (e) { return !e.archived && (e.legacy && e.legacy.reachedOut || activitiesFor(state, e.id).length > 0); }).length;
    const flagsN = project.engagements.filter(function (e) { return !e.archived && engagementFlags(e).length > 0; }).length;

    const toolbar = '<div class="toolbar">' +
      '<input class="input-search" data-input="search" placeholder="Search investors, contacts…" value="' + U.esc(ui.search) + '" />' +
      '<select data-change="stageFilter"><option value="">All stages</option>' +
      U.STAGES.map(function (s) { return '<option value="' + s.id + '"' + (ui.stageFilter === s.id ? " selected" : "") + ">" + U.esc(s.label) + "</option>"; }).join("") +
      "</select>" +
      '<label class="check-line"><input type="checkbox" data-change="reviewOnly"' + (ui.reviewOnly ? " checked" : "") + " /> Needs review</label>" +
      '<span class="spacer"></span>' +
      '<span class="legend">' + contactedN + " of " + total + " contacted · " + flagsN + " flagged</span>" +
      "</div>";

    if (rows.length === 0) {
      return toolbar + '<div class="empty-state"><p>' + (total === 0 ? "No engagements in this project yet." : "No rows match the current filters.") + "</p>" +
        (total === 0 ? '<button class="primary-btn" data-action="add-engagement">+ Add engagement</button>' : "") + "</div>";
    }

    const body = rows.map(function (e) {
      const inv = investorById(state, e.investorId);
      if (!inv) return "";
      const lo = lastOutreach(state, e);
      const flags = engagementFlags(e).length + contactFlagCount(state, inv.id);
      const open = engagementTasks(state, e.id).length;
      return '<tr data-action="open-detail" data-id="' + U.esc(inv.id) + '" data-engagement-id="' + U.esc(e.id) + '"' +
        (lo.text !== "—" ? ' class="has-history"' : "") + ">" +
        "<td class=\"cell-name\">" + U.esc(inv.name) + "</td>" +
        "<td>" + (inv.type ? '<span class="chip chip-plain">' + U.esc(inv.type) + "</span>" : "—") + "</td>" +
        "<td>" + U.stageChip(e.stage) + "</td>" +
        "<td>" + U.priorityChip(e.priority) + "</td>" +
        "<td>" + (e.owner ? U.esc(e.owner) : "—") + "</td>" +
        "<td>" + inv.contacts.length + "</td>" +
        '<td class="' + (lo.undated ? "cell-undated" : "") + '">' + U.esc(lo.text) + "</td>" +
        "<td>" + (open ? '<span class="chip chip-plain">' + open + "</span>" : "—") + "</td>" +
        "<td>" + (flags ? '<span class="chip chip-danger" title="Needs review">' + flags + "</span>" : "") + "</td>" +
        "</tr>";
    }).join("");

    return toolbar +
      '<div class="table-wrap"><table class="data-table">' +
      "<thead><tr><th>Investor</th><th>Type</th><th>Stage</th><th>Priority</th><th>Owner</th><th>Contacts</th><th>Last outreach</th><th>Tasks</th><th>⚑</th></tr></thead>" +
      "<tbody>" + body + "</tbody></table></div>";
  }

  function directory(state, ui) {
    const search = U.normalizeKey(ui.search);
    let rows = state.investors.filter(function (i) { return !i.archived; });
    if (search) {
      rows = rows.filter(function (i) {
        const hay = [i.name, i.type, i.location, i.website].concat(
          i.contacts.map(function (c) { return c.name + " " + c.title + " " + c.email; })
        ).join(" ");
        return U.normalizeKey(hay).indexOf(search) !== -1;
      });
    }
    rows = rows.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });

    const toolbar = '<div class="toolbar">' +
      '<input class="input-search" data-input="search" placeholder="Search investors, contacts…" value="' + U.esc(ui.search) + '" />' +
      '<span class="spacer"></span><span class="legend">' + rows.length + " of " + state.investors.length + " investors</span></div>";

    if (rows.length === 0) {
      return toolbar + '<div class="empty-state"><p>' + (state.investors.length === 0 ? "No investors yet." : "Nothing matches the search.") + "</p>" +
        (state.investors.length === 0 ? '<button class="primary-btn" data-action="add-investor">+ Add investor</button>' : "") + "</div>";
    }

    const body = rows.map(function (inv) {
      const projectsIn = state.projects.filter(function (p) {
        return p.engagements.some(function (e) { return e.investorId === inv.id && !e.archived; });
      });
      const lo = investorLastOutreach(state, inv.id);
      const flags = contactFlagCount(state, inv.id);
      return '<tr data-action="open-detail" data-id="' + U.esc(inv.id) + '">' +
        '<td class="cell-name">' + U.esc(inv.name) + "</td>" +
        "<td>" + (inv.type ? '<span class="chip chip-plain">' + U.esc(inv.type) + "</span>" : "—") + "</td>" +
        "<td>" + (inv.location ? U.esc(inv.location) : "—") + "</td>" +
        "<td>" + inv.contacts.length + "</td>" +
        "<td>" + (projectsIn.length ? U.esc(projectsIn.map(function (p) { return p.name; }).join(", ")) : "—") + "</td>" +
        '<td class="' + (lo.undated ? "cell-undated" : "") + '">' + U.esc(lo.text) + "</td>" +
        "<td>" + (flags ? '<span class="chip chip-danger">' + flags + "</span>" : "") + "</td>" +
        "</tr>";
    }).join("");

    return toolbar +
      '<div class="table-wrap"><table class="data-table">' +
      "<thead><tr><th>Investor</th><th>Type</th><th>Location</th><th>Contacts</th><th>Projects</th><th>Last outreach</th><th>⚑</th></tr></thead>" +
      "<tbody>" + body + "</tbody></table></div>";
  }

  function tasks(state, ui) {
    let rows = state.tasks.slice();
    if (ui.taskStatus === "__all") {
    } else if (ui.taskStatus) {
      rows = rows.filter(function (t) { return t.status === ui.taskStatus; });
    } else {
      rows = rows.filter(function (t) { return t.status !== "Completed"; });
    }
    if (ui.taskOwner) rows = rows.filter(function (t) { return t.owner === ui.taskOwner; });
    if (ui.taskProjectOnly && ui.projectId) rows = rows.filter(function (t) { return !t.projectId || t.projectId === ui.projectId; });
    const search = U.normalizeKey(ui.search);
    if (search) {
      rows = rows.filter(function (t) { return U.normalizeKey(t.title + " " + t.notes).indexOf(search) !== -1; });
    }
    rows.sort(function (a, b) {
      const done = (a.status === "Completed" ? 1 : 0) - (b.status === "Completed" ? 1 : 0);
      if (done !== 0) return done;
      const da = a.dueDate || "9999-12-31";
      const db = b.dueDate || "9999-12-31";
      if (da !== db) return da < db ? -1 : 1;
      return 0;
    });

    const statusOptions = ['<option value="">Open tasks</option>', '<option value="__all"' + (ui.taskStatus === "__all" ? " selected" : "") + ">All tasks</option>"]
      .concat(U.TASK_STATUSES.map(function (s) {
        return '<option value="' + U.esc(s) + '"' + (ui.taskStatus === s ? " selected" : "") + ">" + U.esc(s) + "</option>";
      })).join("");

    const toolbar = '<div class="toolbar">' +
      '<input class="input-search" data-input="search" placeholder="Search tasks…" value="' + U.esc(ui.search) + '" />' +
      '<select data-change="taskStatus">' + statusOptions + "</select>" +
      '<select data-change="taskOwner"><option value="">Anyone</option>' +
      U.TEAM.map(function (t) { return '<option value="' + U.esc(t) + '"' + (ui.taskOwner === t ? " selected" : "") + ">" + U.esc(t) + "</option>"; }).join("") +
      "</select>" +
      '<label class="check-line"><input type="checkbox" data-change="taskProjectOnly"' + (ui.taskProjectOnly ? " checked" : "") + " /> Current project only</label>" +
      '<span class="spacer"></span><span class="legend">' + rows.length + " tasks</span></div>";

    if (rows.length === 0) {
      return toolbar + '<div class="empty-state"><p>No tasks match.</p><button class="primary-btn" data-action="add-task">+ Add task</button></div>';
    }

    const body = rows.map(function (t) {
      const proj = t.projectId ? projectById(state, t.projectId) : null;
      let linked = "";
      if (t.engagementId) {
        const found = findEngagement(state, t.engagementId);
        if (found) {
          const inv = investorById(state, found.engagement.investorId);
          linked = found.project.name + " → " + (inv ? inv.name : "?");
        }
      } else if (proj) linked = proj.name;
      const overdue = t.status !== "Completed" && t.dueDate && t.dueDate < U.todayISO();
      return '<div class="task-row' + (t.status === "Completed" ? " done" : "") + '">' +
        '<input type="checkbox" class="task-check" data-change="toggle-task" data-id="' + U.esc(t.id) + '"' + (t.status === "Completed" ? " checked" : "") + " />" +
        '<div class="task-main">' +
        '<div class="task-title">' + U.esc(t.title) + (t.source === "legacy-nextSteps" ? ' <span class="chip chip-plain" title="Created from legacy next steps">legacy</span>' : "") + "</div>" +
        '<div class="task-sub">' + U.esc(linked || "No project") +
        (t.owner ? " · " + U.esc(t.owner) : "") +
        (t.dueDate ? ' · <span class="' + (overdue ? "overdue" : "") + '">due ' + U.esc(U.fmtDate(t.dueDate)) + "</span>" : " · no due date") +
        "</div></div>" +
        '<span class="chip ' + (t.status === "Completed" ? "chip-success" : t.status === "In progress" ? "chip-info" : "chip-warning") + '">' + U.esc(t.status) + "</span>" +
        U.priorityChip(t.priority) +
        '<div class="row-actions">' +
        '<button class="ghost-btn" data-action="edit-task" data-id="' + U.esc(t.id) + '">Edit</button>' +
        '<button class="ghost-btn danger" data-action="delete-task" data-id="' + U.esc(t.id) + '">Delete</button>' +
        "</div></div>";
    }).join("");

    return toolbar + '<div class="task-list">' + body + "</div>";
  }

  function detail(state, investorId) {
    const inv = investorById(state, investorId);
    if (!inv) return "";
    const engagements = [];
    state.projects.forEach(function (p) {
      p.engagements.forEach(function (e) {
        if (e.investorId === inv.id && !e.archived) engagements.push({ engagement: e, project: p });
      });
    });

    const profile = '<div class="detail-section">' +
      '<div class="detail-actions">' +
      '<button class="ghost-btn" data-action="edit-investor" data-id="' + U.esc(inv.id) + '">Edit profile</button>' +
      '<button class="ghost-btn" data-action="add-engagement" data-investor-id="' + U.esc(inv.id) + '">+ Add to project</button>' +
      "</div>" +
      '<div class="kv-grid">' +
      kv("Type", inv.type) + kv("Website", inv.website) + kv("Location", inv.location) +
      kv("Preferences", inv.preferences, true) + kv("Notes", inv.notes, true) +
      "</div></div>";

    const contactsHtml = inv.contacts.length === 0
      ? '<div class="empty-mini">No contacts yet.</div>'
      : inv.contacts.map(function (c) {
        const flags = c.reviewFlags || [];
        return '<div class="contact-card' + (flags.length ? " has-review" : "") + '">' +
          '<div class="contact-card-head">' +
          U.contactDisplayHtml(c) +
          (c.isPrimary ? '<span class="chip chip-info" title="Primary contact">primary</span>' : "") +
          "</div>" +
          (c.phone ? '<div class="contact-line">' + U.esc(c.phone) + "</div>" : "") +
          (flags.length ? '<div class="flag-list">' + flags.map(function (f) { return '<span class="flag">' + U.esc(f) + "</span>"; }).join("") + "</div>" : "") +
          '<div class="contact-card-actions">' +
          '<button class="ghost-btn" data-action="toggle-primary" data-investor-id="' + U.esc(inv.id) + '" data-id="' + U.esc(c.id) + '">' + (c.isPrimary ? "Unset primary" : "Make primary") + "</button>" +
          '<button class="ghost-btn" data-action="edit-contact" data-investor-id="' + U.esc(inv.id) + '" data-id="' + U.esc(c.id) + '">Edit</button>' +
          '<button class="ghost-btn danger" data-action="remove-contact" data-investor-id="' + U.esc(inv.id) + '" data-id="' + U.esc(c.id) + '">Remove</button>' +
          "</div></div>";
      }).join("");

    const contacts = '<div class="detail-section">' +
      '<div class="detail-section-head"><h3>Contacts (' + inv.contacts.length + ")</h3>" +
      '<button class="ghost-btn" data-action="add-contact" data-investor-id="' + U.esc(inv.id) + '">+ Add contact</button></div>' +
      contactsHtml + "</div>";

    const engagementSections = engagements.map(function (x) {
      const e = x.engagement;
      const flags = engagementFlags(e);
      const legacy = e.legacy || {};
      const acts = activitiesFor(state, e.id);
      const lo = lastOutreach(state, e);
      const open = engagementTasks(state, e.id);
      return '<div class="detail-section engagement-block">' +
        '<div class="detail-section-head"><h3>' + U.esc(x.project.name) + "</h3>" +
        '<button class="ghost-btn danger" data-action="archive-engagement" data-id="' + U.esc(e.id) + '">Archive</button></div>' +
        '<div class="engagement-controls">' +
        '<label>Stage<select data-change="stage" data-id="' + U.esc(e.id) + '">' +
        U.STAGES.map(function (s) { return '<option value="' + s.id + '"' + (e.stage === s.id ? " selected" : "") + ">" + U.esc(s.label) + "</option>"; }).join("") +
        "</select></label>" +
        '<label>Priority<select data-change="priority" data-id="' + U.esc(e.id) + '">' +
        '<option value="">—</option>' +
        U.PRIORITIES.map(function (p) { return '<option value="' + p + '"' + (e.priority === p ? " selected" : "") + ">" + p + "</option>"; }).join("") +
        "</select></label>" +
        '<label>Owner<select data-change="owner" data-id="' + U.esc(e.id) + '">' +
        '<option value="">—</option>' +
        U.TEAM.map(function (t) { return '<option value="' + U.esc(t) + '"' + (e.owner === t ? " selected" : "") + ">" + U.esc(t) + "</option>"; }).join("") +
        "</select></label>" +
        "</div>" +
        '<div class="engagement-meta">Last outreach: <strong>' + U.esc(lo.text) + "</strong>" +
        " · Open tasks: <strong>" + open.length + "</strong> · Activities: <strong>" + acts.length + "</strong></div>" +
        (flags.length ? '<div class="flag-list">' + flags.map(function (f) { return '<span class="flag">' + U.esc(f) + "</span>"; }).join("") + "</div>" : "") +
        '<details class="legacy-box"' + (flags.length ? " open" : "") + "><summary>Legacy record (preserved from original CRM)</summary>" +
        '<div class="legacy-grid">' +
        kv("Reached out", legacy.reachedOut ? "Yes" : "No") +
        kv("Who reached out", legacy.whoReachedOut) +
        kv("Date reached out", legacy.dateReachedOut) +
        kv("Response", legacy.response) +
        kv("Moving forward", legacy.movingForward) +
        kv("Next steps", legacy.nextSteps, true) +
        "</div></details>" +
        '<div class="detail-actions">' +
        '<button class="primary-btn ghost" data-action="log-activity" data-engagement-id="' + U.esc(e.id) + '">Log activity</button>' +
        '<button class="primary-btn ghost" data-action="add-task" data-engagement-id="' + U.esc(e.id) + '">Add task</button>' +
        "</div></div>";
    }).join("") || '<div class="detail-section"><p class="empty-mini">Not assigned to any project yet.</p></div>';

    const acts = investorActivities(state, inv.id);
    const timeline = '<div class="detail-section"><div class="detail-section-head"><h3>Activity</h3>' +
      (engagements.length ? '<button class="ghost-btn" data-action="log-activity" data-engagement-id="' + U.esc(engagements[0].engagement.id) + '">+ Log activity</button>' : "") +
      "</div>" +
      (acts.length === 0 ? '<div class="empty-mini">No activities recorded.</div>' :
        acts.map(function (a) {
          const found = findEngagement(state, a.engagementId);
          const proj = found ? found.project.name : "";
          let contactName = "";
          if (a.contactId) {
            const c = inv.contacts.find(function (x) { return x.id === a.contactId; });
            if (c) contactName = U.contactDisplay(c).primary;
          }
          return '<div class="activity-row' + (a.date ? "" : " undated") + '">' +
            '<span class="activity-date">' + (a.date ? U.esc(U.fmtDate(a.date)) : "Undated (legacy)") + "</span>" +
            '<span class="chip chip-plain">' + U.esc(a.type) + "</span>" +
            '<span class="activity-summary">' + U.esc(a.summary) + "</span>" +
            '<span class="activity-meta">' + U.esc(a.teamMember || "") + (contactName ? " · " + U.esc(contactName) : "") + (proj ? " · " + U.esc(proj) : "") + "</span>" +
            "</div>";
        }).join("")) +
      "</div>";

    const engIds = new Set();
    state.projects.forEach(function (p) {
      p.engagements.forEach(function (e) {
        if (e.investorId === inv.id) engIds.add(e.id);
      });
    });
    const contactIds = new Set(inv.contacts.map(function (c) { return c.id; }));
    const linkedTasks = state.tasks.filter(function (t) {
      return (t.engagementId && engIds.has(t.engagementId)) || (t.contactId && contactIds.has(t.contactId));
    });
    const tasksHtml = '<div class="detail-section"><div class="detail-section-head"><h3>Linked tasks (' + linkedTasks.length + ")</h3>" +
      (engagements.length ? '<button class="ghost-btn" data-action="add-task" data-engagement-id="' + U.esc(engagements[0].engagement.id) + '">+ Add task</button>' : "") +
      "</div>" +
      (linkedTasks.length === 0 ? '<div class="empty-mini">No linked tasks.</div>' :
        linkedTasks.map(function (t) {
          const overdue = t.status !== "Completed" && t.dueDate && t.dueDate < U.todayISO();
          return '<div class="task-row' + (t.status === "Completed" ? " done" : "") + '">' +
            '<input type="checkbox" class="task-check" data-change="toggle-task" data-id="' + U.esc(t.id) + '"' + (t.status === "Completed" ? " checked" : "") + " />" +
            '<div class="task-main"><div class="task-title">' + U.esc(t.title) + "</div>" +
            '<div class="task-sub">' + (t.owner ? U.esc(t.owner) : "unassigned") +
            (t.dueDate ? ' · <span class="' + (overdue ? "overdue" : "") + '">due ' + U.esc(U.fmtDate(t.dueDate)) + "</span>" : " · no due date") +
            "</div></div>" +
            '<span class="chip ' + (t.status === "Completed" ? "chip-success" : "chip-warning") + '">' + U.esc(t.status) + "</span>" +
            '<button class="ghost-btn" data-action="edit-task" data-id="' + U.esc(t.id) + '">Edit</button>' +
            "</div>";
        }).join("")) +
      "</div>";

    return profile + contacts + engagementSections + timeline + tasksHtml;
  }

  function kv(label, value, wide) {
    if (!value) return "";
    return '<div class="kv' + (wide ? " wide" : "") + '"><span class="kv-label">' + U.esc(label) + "</span><span class=\"kv-value\">" + U.esc(value) + "</span></div>";
  }

  return {
    investorById: investorById,
    projectById: projectById,
    allEngagements: allEngagements,
    activitiesFor: activitiesFor,
    lastOutreach: lastOutreach,
    investorLastOutreach: investorLastOutreach,
    findEngagement: findEngagement,
    openTasks: openTasks,
    reviewCount: reviewCount,
    sidebar: sidebar,
    overview: overview,
    tracker: tracker,
    directory: directory,
    tasks: tasks,
    detail: detail
  };
})();
