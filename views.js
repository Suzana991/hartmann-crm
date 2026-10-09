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

  function activityKind(a) {
    if (a.kind) return a.kind;
    return U.activityKindOf(a.type);
  }

  function isOutreachActivity(a) {
    if (a.kind) return a.kind === "outreach";
    return ["Outreach", "Email", "Call", "Meeting", "Message", "Other outreach"].indexOf(a.type) !== -1;
  }

  function lastOutreach(state, engagement) {
    const acts = activitiesFor(state, engagement.id).filter(isOutreachActivity);
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

  function overdueTasks(state) {
    return state.tasks.filter(U.isOverdue);
  }

  function dueTodayTasks(state) {
    return state.tasks.filter(U.dueToday);
  }

  function waitingTasks(state) {
    return state.tasks.filter(function (t) { return t.status === "Waiting"; });
  }

  function uncontactedCount(state) {
    return allEngagements(state).filter(function (x) {
      if (lastOutreach(state, x.engagement).text !== "—") return false;
      return !(x.engagement.legacy && x.engagement.legacy.reachedOut);
    }).length;
  }

  function investorReviewCount(state, investorId) {
    const inv = investorById(state, investorId);
    if (!inv) return 0;
    let n = contactFlagCount(state, investorId);
    const engIds = new Set();
    const contactIds = new Set(inv.contacts.map(function (c) { return c.id; }));
    state.projects.forEach(function (p) {
      p.engagements.forEach(function (e) {
        if (e.investorId !== investorId) return;
        n += engagementFlags(e).length;
        engIds.add(e.id);
      });
    });
    state.tasks.forEach(function (t) {
      if ((t.engagementId && engIds.has(t.engagementId)) || (t.contactId && contactIds.has(t.contactId))) {
        n += (t.reviewFlags || []).length;
      }
    });
    return n;
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

  function projectTasksOf(state, projectId, stageId) {
    return state.tasks.filter(function (t) {
      return t.projectId === projectId && (stageId === undefined || t.stage === stageId);
    });
  }

  function findEngagement(state, engagementId) {
    for (const p of state.projects) {
      const e = p.engagements.find(function (x) { return x.id === engagementId; });
      if (e) return { engagement: e, project: p };
    }
    return null;
  }

  function sidebar(projects, activeProjectId) {
    if (projects.length === 0) {
      return '<div class="empty-mini">No projects yet</div>';
    }
    return projects.filter(function (p) { return !p.archived; }).map(function (p) {
      const count = p.engagements.filter(function (e) { return !e.archived; }).length;
      const info = p.deliveryStage ? U.projectStageInfo(p.deliveryStage) : null;
      return '<button class="project-row' + (p.id === activeProjectId ? " active" : "") + '" data-action="open-project" data-id="' + U.esc(p.id) + '"' +
        (info ? ' title="Delivery stage: ' + U.esc(info.label) + '"' : "") + ">" +
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
    const overdue = overdueTasks(state).length;
    const today = dueTodayTasks(state).length;
    const waiting = waitingTasks(state).length;
    const uncontacted = uncontactedCount(state);

    const attention = [
      { label: "Overdue", value: overdue, sub: "tasks past due", filter: "overdue", alert: overdue > 0 },
      { label: "Due today", value: today, sub: "tasks due " + U.fmtDate(U.todayISO()), filter: "today", alert: today > 0 },
      { label: "Waiting", value: waiting, sub: "blocked on reply or documents", filter: "waiting" },
      { label: "Needs review", value: flags, sub: "flags to verify after migration", filter: "review", alert: flags > 0 },
      { label: "Not contacted", value: uncontacted, sub: "engagements with no outreach", filter: "uncontacted" }
    ].map(function (c) {
      return '<button class="attention-card' + (c.alert ? " alert" : "") + '" data-action="attention" data-filter="' + c.filter + '">' +
        '<div class="stat-value">' + c.value + "</div>" +
        '<div class="stat-label">' + U.esc(c.label) + "</div>" +
        '<div class="stat-sub">' + U.esc(c.sub) + "</div>" +
        "</button>";
    }).join("");

    const quick = '<div class="quick-row">' +
      '<button class="primary-btn ghost" data-action="quick-outreach">Record outreach</button>' +
      '<button class="ghost-btn" data-action="quick-activity">Log activity</button>' +
      '<button class="ghost-btn" data-action="add-task">Add task</button>' +
      '<button class="ghost-btn" data-action="import-investors">Import investors…</button>' +
      '<button class="ghost-btn" data-action="manage-templates">Stage templates…</button>' +
      '<span class="spacer"></span>' +
      "</div>";

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
      return '<div class="mini-row" data-action="edit-activity" data-id="' + U.esc(a.id) + '" role="button">' +
        '<span class="mini-date">' + (a.date ? U.esc(U.fmtDate(a.date)) : "<em>Undated</em>") + "</span>" +
        '<span class="mini-main">' + U.esc(inv ? inv.name : "Unknown") +
        (eng ? ' <span class="mini-sub">· ' + U.esc(eng.project.name) + "</span>" : "") + "</span>" +
        '<span class="mini-note">' + U.esc(a.summary || U.activityKindLabel(a)) + "</span>" +
        "</div>";
    }).join("") || '<div class="empty-mini">No activities recorded yet.</div>';

    const due = open.slice().sort(function (a, b) {
      const da = a.dueDate || "9999-12-31";
      const db = b.dueDate || "9999-12-31";
      return da < db ? -1 : da > db ? 1 : 0;
    }).slice(0, 8).map(function (t) {
      const proj = t.projectId ? projectById(state, t.projectId) : null;
      return '<div class="mini-row" data-action="edit-task" data-id="' + U.esc(t.id) + '" role="button">' +
        '<span class="mini-main">' + U.esc(t.title) + (t.kind === "appointment" ? ' <span class="chip chip-warning">appt</span>' : "") + "</span>" +
        '<span class="mini-note' + (U.isOverdue(t) ? " overdue" : "") + '">' +
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
      '<div class="attention-row">' + attention + "</div>" +
      quick +
      '<div class="card-row">' + cards.map(function (c) {
        return '<div class="stat-card' + (c.alert ? " alert" : "") + '"><div class="stat-value">' + c.value + "</div><div class=\"stat-label\">" + U.esc(c.label) + "</div></div>";
      }).join("") + "</div>" +
      '<div class="panel"><div class="panel-head"><h3>Pipeline</h3></div><div class="panel-body">' + pipeline + "</div></div>" +
      '<div class="split">' +
      '<div class="panel"><div class="panel-head"><h3>Recent activity</h3></div><div class="panel-body list">' + recent + "</div></div>" +
      '<div class="panel"><div class="panel-head"><h3>Tasks due</h3></div><div class="panel-body list">' + due + "</div></div>" +
      "</div>";
  }

  function calendarItems(state, ui) {
    const items = [];
    const owner = ui.calendarOwner || "";
    const kindFilter = ui.calendarKind || "";

    if (kindFilter !== "activities" && kindFilter !== "project") {
      state.tasks.forEach(function (t) {
        if (!t.dueDate || !U.isValidISODate(t.dueDate)) return;
        const kind = t.kind === "appointment" ? "appointment" : "task";
        if (kindFilter === "tasks" && kind !== "task") return;
        if (kindFilter === "appointments" && kind !== "appointment") return;
        if (owner && (t.owner || "") !== owner) return;
        const color = U.isOverdue(t) ? "#ff6b6b" : U.dueToday(t) ? "#f5b942" : t.status === "Completed" ? "#3ddc97" : "#6c9cff";
        items.push({
          date: t.dueDate, kind: kind, id: t.id, action: "edit-task", color: color,
          done: t.status === "Completed", label: t.title
        });
      });
    }

    if (kindFilter !== "tasks" && kindFilter !== "appointments" && kindFilter !== "project") {
      state.activities.forEach(function (a) {
        if (!a.date || !U.isValidISODate(a.date)) return;
        if (owner && (a.teamMember || "") !== owner) return;
        const found = findEngagement(state, a.engagementId);
        const inv = found ? investorById(state, found.engagement.investorId) : null;
        const k = activityKind(a);
        const colors = { outreach: "#3fb984", reply: "#22d3ee", materials: "#a78bfa", appointment: "#f4b942", note: "#8b90a6" };
        items.push({
          date: a.date, kind: "activity", id: a.id, action: "edit-activity",
          color: colors[k] || "#8b90a6", done: false,
          label: (inv ? inv.name + " — " : "") + (a.summary || U.activityKindLabel(a))
        });
      });
    }

    if (kindFilter !== "tasks" && kindFilter !== "appointments" && kindFilter !== "activities") {
      state.projects.forEach(function (p) {
        if (p.archived) return;
        (p.milestones || []).forEach(function (m) {
          if (!m.date || !U.isValidISODate(m.date)) return;
          items.push({
            date: m.date, kind: "milestone", id: p.id, action: "edit-milestones",
            color: "#f4b942", done: false, label: p.name + " — " + m.label
          });
        });
        const ag = p.agreement;
        if (ag) {
          if (ag.status === "sent" || ag.status === "signed") {
            if (ag.sentDate && U.isValidISODate(ag.sentDate)) {
              items.push({ date: ag.sentDate, kind: "agreement", id: p.id, action: "edit-agreement", color: "#6c9cff", done: false, label: p.name + " — agreement sent" });
            }
            if (ag.signedDate && U.isValidISODate(ag.signedDate)) {
              items.push({ date: ag.signedDate, kind: "agreement", id: p.id, action: "edit-agreement", color: "#3ddc97", done: false, label: p.name + " — agreement signed" });
            }
          }
        }
      });
    }

    items.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    return items;
  }

  function calCellHtml(state, ui, byDate, date, inMonth) {
    const list = byDate[date] || [];
    const shown = list.slice(0, 6);
    const more = list.length - shown.length;
    const cls = "cal-cell" + (inMonth ? "" : " other-month") + (date === U.todayISO() ? " today" : "");
    const p = U.parseISO(date);
    const head = '<div class="cal-cell-head"><span>' + p.d + " " + U.MONTHS[p.m - 1] + "</span>" +
      '<button type="button" class="cal-add" data-action="calendar-add" data-date="' + date + '" title="Add a task on this day">+</button></div>';
    const body = shown.map(function (it) {
      return '<button type="button" class="cal-item' + (it.done ? " completed" : "") + (it.kind === "appointment" ? " scheduled" : "") +
        '" style="--it-color:' + it.color + '" data-action="' + U.esc(it.action) + '" data-id="' + U.esc(it.id) + '" title="' + U.esc(it.label) + '">' +
        U.esc(it.label) + "</button>";
    }).join("");
    const rest = more > 0 ? '<div class="empty-mini">+' + more + " more</div>" : "";
    return '<div class="' + cls + '">' + head + body + rest + "</div>";
  }

  function calLegendHtml() {
    return '<div class="cal-legend">' +
      '<span class="li"><span class="sw" style="background:#6c9cff"></span>task</span>' +
      '<span class="li"><span class="sw" style="background:#f4b942"></span>due today / milestone</span>' +
      '<span class="li"><span class="sw" style="background:#ff6b6b"></span>overdue</span>' +
      '<span class="li"><span class="sw" style="background:#3fb984"></span>outreach</span>' +
      '<span class="li"><span class="sw" style="background:#22d3ee"></span>reply</span>' +
      '<span class="li"><span class="sw" style="background:#a78bfa"></span>materials</span>' +
      '<span class="li"><span class="sw" style="background:#3ddc97"></span>signed / completed</span>' +
      "</div>";
  }

  function calendar(state, ui) {
    const anchor = ui.calendarAnchor && U.isValidISODate(ui.calendarAnchor) ? ui.calendarAnchor : U.todayISO();
    const items = calendarItems(state, ui);
    const byDate = {};
    items.forEach(function (it) { (byDate[it.date] = byDate[it.date] || []).push(it); });

    const tabs = ["month", "week", "agenda"].map(function (v) {
      return '<button type="button" class="view-tab' + (ui.calendarView === v ? " active" : "") + '" data-action="cal-view" data-cal-view="' + v + '">' +
        v.charAt(0).toUpperCase() + v.slice(1) + "</button>";
    }).join("");
    const owners = ["", "Suzana", "Bruno", "Both"].map(function (o) {
      return '<option value="' + U.esc(o) + '"' + (ui.calendarOwner === o ? " selected" : "") + ">" + (o || "Anyone") + "</option>";
    }).join("");
    const kinds = [
      { value: "", label: "Everything" },
      { value: "tasks", label: "Tasks" },
      { value: "appointments", label: "Appointments" },
      { value: "activities", label: "Activities" },
      { value: "project", label: "Project dates" }
    ].map(function (k) {
      return '<option value="' + k.value + '"' + (ui.calendarKind === k.value ? " selected" : "") + ">" + k.label + "</option>";
    }).join("");

    const toolbar = '<div class="cal-toolbar">' +
      '<button type="button" class="ghost-btn" data-action="cal-prev" title="Previous">‹</button>' +
      '<button type="button" class="ghost-btn" data-action="cal-today">Today</button>' +
      '<button type="button" class="ghost-btn" data-action="cal-next" title="Next">›</button>' +
      '<strong class="legend">' + (ui.calendarView === "month"
        ? U.MONTHS[Number(anchor.slice(5, 7)) - 1] + " " + anchor.slice(0, 4)
        : U.fmtDate(anchor)) + "</strong>" +
      '<span class="spacer"></span>' + tabs +
      '<select data-change="calendarOwner">' + owners + "</select>" +
      '<select data-change="calendarKind">' + kinds + "</select>" +
      "</div>" + calLegendHtml();

    if (ui.calendarView === "agenda") {
      const today = U.todayISO();
      const start = anchor < today ? today : anchor;
      const end = U.addDaysISO(start, 60);
      const overdue = items.filter(function (it) { return it.kind === "task" && it.date < today && !it.done; });
      const upcoming = items.filter(function (it) { return it.date >= start && it.date <= end; });
      const group = function (list) {
        const days = {};
        list.forEach(function (it) { (days[it.date] = days[it.date] || []).push(it); });
        return Object.keys(days).sort().map(function (d) {
          return '<div class="agenda-day">' + U.esc(U.fmtDate(d)) + (d === today ? " — today" : "") + "</div>" +
            days[d].map(function (it) {
              return '<div class="cal-list-row">' +
                '<span class="clr-date">' + U.esc(U.fmtDate(it.date)) + "</span>" +
                '<button type="button" class="link-btn" data-action="' + U.esc(it.action) + '" data-id="' + U.esc(it.id) + '">' + U.esc(it.label) + "</button>" +
                '<span class="clr-kind" style="color:' + it.color + '">' + U.esc(it.kind) + "</span>" +
                "</div>";
            }).join("");
        }).join("");
      };
      return toolbar + '<div class="panel"><div class="panel-body">' +
        (overdue.length ? '<div class="agenda-day" style="color:var(--danger)">Overdue</div>' + overdue.map(function (it) {
          return '<div class="cal-list-row">' +
            '<span class="clr-date overdue">' + U.esc(U.fmtDate(it.date)) + "</span>" +
            '<button type="button" class="link-btn" data-action="' + U.esc(it.action) + '" data-id="' + U.esc(it.id) + '">' + U.esc(it.label) + "</button>" +
            '<span class="clr-kind" style="color:' + it.color + '">' + U.esc(it.kind) + "</span>" +
            "</div>";
        }).join("") : "") +
        (upcoming.length ? group(upcoming) : '<div class="empty-mini">Nothing scheduled in the next 60 days.</div>') +
        "</div></div>";
    }

    const dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(function (d) {
      return '<div class="cal-dow">' + d + "</div>";
    }).join("");

    if (ui.calendarView === "week") {
      const start = U.startOfWeekISO(anchor);
      const days = [];
      for (let i = 0; i < 7; i++) days.push(U.addDaysISO(start, i));
      const p = U.parseISO(start);
      const endP = U.parseISO(days[6]);
      return toolbar +
        '<div class="legend" style="margin-bottom:8px">' + p.d + " " + U.MONTHS[p.m - 1] + " – " + endP.d + " " + U.MONTHS[endP.m - 1] + " " + endP.y + "</div>" +
        '<div class="cal-grid">' + dow + days.map(function (d) { return calCellHtml(state, ui, byDate, d, true); }).join("") + "</div>";
    }

    const weeks = U.monthGrid(anchor);
    return toolbar + '<div class="cal-grid">' + dow +
      weeks.map(function (week) {
        return week.map(function (d) { return calCellHtml(state, ui, byDate, d, d.slice(0, 7) === anchor.slice(0, 7)); }).join("");
      }).join("") + "</div>";
  }

  function stageDetailHtml(state, ui, project, stageId) {
    const info = U.projectStageInfo(stageId);
    if (!info) return "";
    const history = (project.stageHistory || []).filter(function (h) { return h.to === stageId; }).slice().reverse();
    const tasks = projectTasksOf(state, project.id, stageId).slice().sort(function (a, b) {
      const done = (a.status === "Completed" ? 1 : 0) - (b.status === "Completed" ? 1 : 0);
      if (done !== 0) return done;
      return (a.dueDate || "9999") < (b.dueDate || "9999") ? -1 : 1;
    });
    const taskRows = tasks.map(function (t) {
      const overdue = U.isOverdue(t);
      return '<div class="task-row' + (t.status === "Completed" ? " done" : "") + '">' +
        '<input type="checkbox" class="task-check" data-change="toggle-task" data-id="' + U.esc(t.id) + '"' + (t.status === "Completed" ? " checked" : "") + " />" +
        '<div class="task-main"><div class="task-title">' + U.esc(t.title) + "</div>" +
        '<div class="task-sub">' + (t.owner ? U.esc(t.owner) : "unassigned") +
        (t.dueDate ? ' · <span class="' + (overdue ? "overdue" : "") + '">due ' + U.esc(U.fmtDate(t.dueDate)) + "</span>" : " · no due date") +
        (t.status === "Waiting" && t.waitingReason ? " · waiting: " + U.esc(t.waitingReason) : "") +
        "</div></div>" +
        '<span class="chip ' + (t.status === "Completed" ? "chip-success" : t.status === "Waiting" ? "chip-warning" : t.status === "In progress" ? "chip-info" : "chip-plain") + '">' + U.esc(t.status) + "</span>" +
        '<div class="row-actions">' +
        '<button class="ghost-btn" data-action="edit-task" data-id="' + U.esc(t.id) + '">Edit</button>' +
        "</div></div>";
    }).join("");

    return '<div class="stage-detail">' +
      '<div class="stage-detail-head"><h4>' + U.esc(info.label) + "</h4>" +
      '<div class="row-actions">' +
      '<button class="ghost-btn" data-action="apply-templates" data-id="' + U.esc(project.id) + '" data-stage-id="' + U.esc(stageId) + '">Apply templates</button>' +
      '<button class="ghost-btn" data-action="add-stage-task" data-id="' + U.esc(project.id) + '" data-stage-id="' + U.esc(stageId) + '">+ Task</button>' +
      '<button class="ghost-btn" data-action="close-stage-detail">Close</button>' +
      "</div></div>" +
      '<label class="field wide">Stage notes<textarea class="stage-notes" data-change="stageNotes" data-project-id="' + U.esc(project.id) +
      '" data-stage-id="' + U.esc(stageId) + '" placeholder="What is happening in this stage?">' + U.esc(project.stageNotes && project.stageNotes[stageId] ? project.stageNotes[stageId] : "") + "</textarea></label>" +
      (history.length ? '<div class="history-list">' + history.map(function (h) {
        return '<div class="history-row"><span>' + U.esc(U.fmtDate(h.date)) + " · " + U.esc(h.from ? (U.projectStageInfo(h.from) || {}).label || h.from : "Stage not set") +
          " → " + U.esc(info.label) + (h.by ? " · " + U.esc(h.by) : "") + (h.note ? " — " + U.esc(h.note) : "") + "</span>" +
          '<button class="ghost-btn danger" data-action="revoke-step" data-id="' + U.esc(project.id) + '" data-history-id="' + U.esc(h.id) + '">Revoke</button></div>';
      }).join("") + "</div>" : "") +
      (taskRows ? '<div class="task-list" style="margin-top:10px">' + taskRows + "</div>" : '<div class="empty-mini">No tasks in this stage yet.</div>') +
      "</div>";
  }

  function projectHead(state, ui, project) {
    const reached = new Set((project.stageHistory || []).map(function (h) { return h.to; }));
    const currentIdx = project.deliveryStage ? U.PROJECT_STAGES.findIndex(function (s) { return s.id === project.deliveryStage; }) : -1;
    const segs = U.PROJECT_STAGES.map(function (s, i) {
      const cur = project.deliveryStage === s.id;
      const sel = ui.stageDetail === s.id;
      const openN = projectTasksOf(state, project.id, s.id).filter(U.taskIsOpen).length;
      const phase = cur ? "current" : reached.has(s.id) || (currentIdx !== -1 && i < currentIdx) ? "done" : "upcoming";
      return '<button type="button" class="stage-seg' + (cur ? " current" : "") + (sel ? " selected" : "") +
        '" style="--seg-color:' + s.color + '" data-action="set-stage" data-id="' + U.esc(project.id) + '" data-stage-id="' + s.id + '">' +
        '<span class="seg-title">' + U.esc(s.label) + "</span>" +
        "<span>" + phase + (openN ? " · " + openN + " open" : "") + "</span>" +
        "</button>";
    }).join("");

    const ag = project.agreement || { status: "not_started" };
    const agreement =
      '<div class="agreement-panel">' +
      '<div class="agreement-row"><strong>Client engagement agreement</strong> ' + U.agreementChip(ag.status) +
      (ag.sentDate ? "<span>Sent " + U.esc(U.fmtDate(ag.sentDate)) + (ag.sentBy ? " by " + U.esc(ag.sentBy) : "") + "</span>" : "") +
      (ag.signedDate ? "<span>Signed " + U.esc(U.fmtDate(ag.signedDate)) + "</span>" : "") +
      (ag.docLink ? '<a class="link-btn" href="' + U.esc(ag.docLink) + '" target="_blank" rel="noopener">open document</a>' : "") +
      "</div>" +
      '<div class="agreement-actions">' +
      '<button class="ghost-btn" data-action="agreement-sent" data-id="' + U.esc(project.id) + '">Record sent</button>' +
      '<button class="ghost-btn" data-action="agreement-signed" data-id="' + U.esc(project.id) + '">Record signed</button>' +
      '<button class="ghost-btn" data-action="edit-agreement" data-id="' + U.esc(project.id) + '">Edit agreement…</button>' +
      "</div></div>";

    const milestones = (project.milestones || []);
    const msRows = milestones.length
      ? milestones.slice().sort(function (a, b) { return (a.date || "9999") < (b.date || "9999") ? -1 : 1; }).map(function (m) {
        const past = m.date && m.date < U.todayISO();
        return '<div class="milestone-row"><span class="ms-label">' + U.esc(m.label) + "</span>" +
          '<span class="' + (past ? "overdue" : "") + '">' + (m.date ? U.esc(U.fmtDate(m.date)) : "no date") + "</span></div>";
      }).join("")
      : '<div class="empty-mini">No milestone dates yet.</div>';

    const stateInfo = U.projectStateOf(project);
    const badge = stateInfo === "on_hold" ? '<span class="chip chip-warning">On hold</span>' :
      stateInfo === "archived" ? '<span class="chip chip-plain">Archived</span>' : "";

    return '<div class="project-head">' +
      '<div class="project-head-top">' +
      "<div><h3 style=\"margin:0 0 4px\">" + U.esc(project.name) + "</h3>" +
      '<div class="project-badges">' + badge + U.projectStageChip(project.deliveryStage) +
      '<span class="legend">' + project.engagements.filter(function (e) { return !e.archived; }).length + " engagements</span></div></div>" +
      '<div class="project-badges">' +
      '<label class="check-line">Lead<select data-change="projectLead" data-id="' + U.esc(project.id) + '">' +
      '<option value="">—</option>' +
      ["Suzana", "Bruno"].map(function (t) { return '<option value="' + t + '"' + (project.lead === t ? " selected" : "") + ">" + t + "</option>"; }).join("") +
      "</select></label>" +
      '<button class="ghost-btn" data-action="edit-milestones" data-id="' + U.esc(project.id) + '">Milestones…</button>' +
      '<button class="ghost-btn" data-action="manage-templates">Templates…</button>' +
      '<button class="ghost-btn" data-action="rename-project">Rename</button>' +
      '<button class="ghost-btn danger" data-action="archive-project">Archive</button>' +
      "</div></div>" +
      '<div class="stage-strip">' + segs + "</div>" +
      (ui.stageDetail ? stageDetailHtml(state, ui, project, ui.stageDetail) : "") +
      agreement +
      '<div class="agreement-panel"><div class="agreement-row"><strong>Milestones</strong></div>' + msRows +
      '<div class="agreement-actions"><button class="ghost-btn" data-action="edit-milestones" data-id="' + U.esc(project.id) + '">Edit milestones…</button></div></div>' +
      "</div>";
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
      return projectHead(state, ui, project) + toolbar +
        '<div class="empty-state"><p>' + (total === 0 ? "No engagements in this project yet." : "No rows match the current filters.") + "</p>" +
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

    return projectHead(state, ui, project) + toolbar +
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

    const selected = new Set(ui.selectedInvestors || []);
    const shownSelected = rows.filter(function (r) { return selected.has(r.id); }).length;
    const allChecked = rows.length > 0 && shownSelected === rows.length;

    const toolbar = '<div class="toolbar">' +
      '<input class="input-search" data-input="search" placeholder="Search investors, contacts…" value="' + U.esc(ui.search) + '" />' +
      '<button class="ghost-btn" data-action="import-investors">Import…</button>' +
      '<button class="ghost-btn" data-action="bulk-assign"' + (selected.size === 0 ? " disabled" : "") + ">Assign to project" +
      (selected.size ? " (" + selected.size + ")" : "") + "</button>" +
      (selected.size ? '<button class="ghost-btn danger" data-action="clear-selection">Clear selection</button>' : "") +
      '<span class="spacer"></span><span class="legend">' + rows.length + " of " + state.investors.length + " investors" +
      (selected.size ? " · " + selected.size + " selected" : "") + "</span></div>";

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
        '<td class="cell-select" data-stop><input type="checkbox" data-change="select-investor" data-id="' + U.esc(inv.id) + '"' +
        (selected.has(inv.id) ? " checked" : "") + ' title="Select for bulk actions" /></td>' +
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
      '<thead><tr><th class="cell-select"><input type="checkbox" data-change="select-all-investors"' + (allChecked ? " checked" : "") +
      ' title="Select all shown" /></th>' +
      "<th>Investor</th><th>Type</th><th>Location</th><th>Contacts</th><th>Projects</th><th>Last outreach</th><th>⚑</th></tr></thead>" +
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
    if (ui.taskKind) rows = rows.filter(function (t) { return (t.kind || "task") === ui.taskKind; });
    if (ui.taskOwner) rows = rows.filter(function (t) { return t.owner === ui.taskOwner; });
    if (ui.myTasksOnly && ui.myOwner) rows = rows.filter(function (t) { return t.owner === ui.myOwner; });
    if (ui.taskProjectOnly && ui.projectId) rows = rows.filter(function (t) { return !t.projectId || t.projectId === ui.projectId; });
    if (ui.taskDue) {
      const today = U.todayISO();
      rows = rows.filter(function (t) {
        if (ui.taskDue === "overdue") return U.isOverdue(t);
        if (ui.taskDue === "today") return U.dueToday(t);
        if (ui.taskDue === "week") return t.status !== "Completed" && t.dueDate && t.dueDate >= today && t.dueDate <= U.addDaysISO(today, 7);
        if (ui.taskDue === "none") return !t.dueDate;
        return true;
      });
    }
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

    const dueOptions = [
      { value: "", label: "Any due date" },
      { value: "overdue", label: "Overdue" },
      { value: "today", label: "Due today" },
      { value: "week", label: "Next 7 days" },
      { value: "none", label: "No due date" }
    ].map(function (d) {
      return '<option value="' + d.value + '"' + (ui.taskDue === d.value ? " selected" : "") + ">" + d.label + "</option>";
    }).join("");

    const kindOptions = [
      { value: "", label: "Tasks + appointments" },
      { value: "task", label: "Tasks only" },
      { value: "appointment", label: "Appointments only" }
    ].map(function (k) {
      return '<option value="' + k.value + '"' + (ui.taskKind === k.value ? " selected" : "") + ">" + k.label + "</option>";
    }).join("");

    const viewTabs = '<div class="view-tabs">' +
      '<button type="button" class="view-tab' + (ui.taskView !== "kanban" ? " active" : "") + '" data-action="task-view" data-task-view="list">List</button>' +
      '<button type="button" class="view-tab' + (ui.taskView === "kanban" ? " active" : "") + '" data-action="task-view" data-task-view="kanban">Board</button>' +
      "</div>";

    const myOptions = ['<option value="">View as: anyone</option>'].concat(
      ["Suzana", "Bruno"].map(function (t) {
        return '<option value="' + t + '"' + (ui.myOwner === t ? " selected" : "") + ">" + t + "</option>";
      })).join("");

    const toolbar = '<div class="toolbar">' +
      viewTabs +
      '<input class="input-search" data-input="search" placeholder="Search tasks…" value="' + U.esc(ui.search) + '" />' +
      '<select data-change="taskStatus">' + statusOptions + "</select>" +
      '<select data-change="taskDue">' + dueOptions + "</select>" +
      '<select data-change="taskKind">' + kindOptions + "</select>" +
      '<select data-change="taskOwner"><option value="">Anyone</option>' +
      U.TEAM.map(function (t) { return '<option value="' + U.esc(t) + '"' + (ui.taskOwner === t ? " selected" : "") + ">" + U.esc(t) + "</option>"; }).join("") +
      "</select>" +
      '<select data-change="myOwner" class="my-tasks-pref" title="Remember who is using this device">' + myOptions + "</select>" +
      (ui.myOwner ? '<label class="check-line"><input type="checkbox" data-change="myTasksOnly"' + (ui.myTasksOnly ? " checked" : "") + " /> Only my tasks</label>" : "") +
      '<label class="check-line"><input type="checkbox" data-change="taskProjectOnly"' + (ui.taskProjectOnly ? " checked" : "") + " /> Current project only</label>" +
      '<span class="spacer"></span><span class="legend">' + rows.length + " tasks</span></div>";

    if (ui.taskView === "kanban") {
      const cols = U.TASK_STATUSES.map(function (status) {
        const items = rows.filter(function (t) { return t.status === status; });
        const cards = items.map(function (t) {
          const overdue = U.isOverdue(t);
          return '<div class="kanban-card" draggable="true" data-id="' + U.esc(t.id) + '" data-action="edit-task">' +
            '<div class="kc-title">' + U.esc(t.title) + "</div>" +
            '<div class="kc-meta">' +
            (t.kind === "appointment" ? '<span class="chip chip-warning">appt</span>' : "") +
            (t.owner ? '<span class="chip chip-plain">' + U.esc(t.owner) + "</span>" : "") +
            (t.dueDate ? '<span class="' + (overdue ? "overdue" : "") + '">' + U.esc(U.fmtDate(t.dueDate)) + "</span>" : "") +
            U.priorityChip(t.priority) +
            (t.stage ? U.projectStageChip(t.stage) : "") +
            "</div></div>";
        }).join("");
        return '<div class="kanban-col" data-drop-status="' + U.esc(status) + '">' +
          "<h4>" + U.esc(status) + ' <span class="count-badge">' + items.length + "</span></h4>" +
          (cards || '<div class="empty-mini">Nothing here.</div>') +
          "</div>";
      }).join("");
      return toolbar + '<div class="kanban">' + cols + "</div>";
    }

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
      const overdue = U.isOverdue(t);
      return '<div class="task-row' + (t.status === "Completed" ? " done" : "") + '">' +
        '<input type="checkbox" class="task-check" data-change="toggle-task" data-id="' + U.esc(t.id) + '"' + (t.status === "Completed" ? " checked" : "") + " />" +
        '<div class="task-main">' +
        '<div class="task-title">' + U.esc(t.title) +
        (t.kind === "appointment" ? ' <span class="chip chip-warning">appointment</span>' : "") +
        (t.source === "legacy-nextSteps" ? ' <span class="chip chip-plain" title="Created from legacy next steps">legacy</span>' : "") + "</div>" +
        '<div class="task-sub">' + U.esc(linked || "No project") +
        (t.owner ? " · " + U.esc(t.owner) : "") +
        (t.dueDate ? ' · <span class="' + (overdue ? "overdue" : "") + '">due ' + U.esc(U.fmtDate(t.dueDate)) + "</span>" : " · no due date") +
        (t.status === "Waiting" && t.waitingReason ? " · waiting: " + U.esc(t.waitingReason) : "") +
        "</div></div>" +
        (t.stage ? U.projectStageChip(t.stage) : "") +
        '<span class="chip ' + (t.status === "Completed" ? "chip-success" : t.status === "In progress" ? "chip-info" : t.status === "Waiting" ? "chip-warning" : "chip-plain") + '">' + U.esc(t.status) + "</span>" +
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
        '<button class="primary-btn ghost" data-action="record-outreach" data-engagement-id="' + U.esc(e.id) + '">Record outreach</button>' +
        '<button class="primary-btn ghost" data-action="log-activity" data-engagement-id="' + U.esc(e.id) + '">Log activity</button>' +
        '<button class="primary-btn ghost" data-action="add-task" data-engagement-id="' + U.esc(e.id) + '">Add task</button>' +
        "</div></div>";
    }).join("") || '<div class="detail-section"><p class="empty-mini">Not assigned to any project yet.</p></div>';

    const acts = investorActivities(state, inv.id);
    const timeline = '<div class="detail-section"><div class="detail-section-head"><h3>Activity</h3>' +
      (engagements.length
        ? '<div class="row-actions">' +
        '<button class="ghost-btn" data-action="record-outreach" data-engagement-id="' + U.esc(engagements[0].engagement.id) + '">Record outreach</button>' +
        '<button class="ghost-btn" data-action="log-activity" data-engagement-id="' + U.esc(engagements[0].engagement.id) + '">+ Log activity</button></div>'
        : "") +
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
            '<span class="chip chip-plain">' + U.esc(U.activityKindLabel(a)) + "</span>" +
            '<span class="activity-summary">' + U.esc(a.summary) + "</span>" +
            '<span class="activity-meta">' + U.esc(a.teamMember || "") + (contactName ? " · " + U.esc(contactName) : "") + (proj ? " · " + U.esc(proj) : "") + "</span>" +
            '<span class="activity-actions">' +
            '<button class="link-btn" data-action="edit-activity" data-id="' + U.esc(a.id) + '">Edit</button>' +
            '<button class="link-btn" data-action="delete-activity" data-id="' + U.esc(a.id) + '">Delete</button>' +
            "</span>" +
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
          const overdue = U.isOverdue(t);
          return '<div class="task-row' + (t.status === "Completed" ? " done" : "") + '">' +
            '<input type="checkbox" class="task-check" data-change="toggle-task" data-id="' + U.esc(t.id) + '"' + (t.status === "Completed" ? " checked" : "") + " />" +
            '<div class="task-main"><div class="task-title">' + U.esc(t.title) + "</div>" +
            '<div class="task-sub">' + (t.owner ? U.esc(t.owner) : "unassigned") +
            (t.dueDate ? ' · <span class="' + (overdue ? "overdue" : "") + '">due ' + U.esc(U.fmtDate(t.dueDate)) + "</span>" : " · no due date") +
            (t.status === "Waiting" && t.waitingReason ? " · waiting: " + U.esc(t.waitingReason) : "") +
            "</div></div>" +
            '<span class="chip ' + (t.status === "Completed" ? "chip-success" : t.status === "Waiting" ? "chip-warning" : "chip-plain") + '">' + U.esc(t.status) + "</span>" +
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
    overdueTasks: overdueTasks,
    dueTodayTasks: dueTodayTasks,
    waitingTasks: waitingTasks,
    reviewCount: reviewCount,
    investorReviewCount: investorReviewCount,
    projectTasksOf: projectTasksOf,
    calendarItems: calendarItems,
    sidebar: sidebar,
    overview: overview,
    calendar: calendar,
    tracker: tracker,
    directory: directory,
    tasks: tasks,
    detail: detail
  };
})();
