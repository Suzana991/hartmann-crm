window.Modals = (function () {
  "use strict";

  let submitCallback = null;
  let submitting = false;

  function backdrop() { return document.getElementById("modal-backdrop"); }
  function form() { return document.getElementById("modal-form"); }
  function bodyEl() { return document.getElementById("modal-body"); }
  function submitBtn() { return document.getElementById("modal-submit"); }

  function showError(message) {
    const box = document.getElementById("modal-error");
    if (!box) return;
    if (!message) { box.classList.add("hidden"); box.textContent = ""; return; }
    box.textContent = message;
    box.classList.remove("hidden");
  }

  function setSubmitLabel(label) {
    submitBtn().textContent = label || "Save";
  }

  function wireReveals() {
    const body = bodyEl();
    body.querySelectorAll("[data-reveal]").forEach(function (block) {
      const name = block.dataset.reveal;
      const cb = body.querySelector('input[type="checkbox"][name="' + name + '"]');
      if (!cb) return;
      const sync = function () { block.classList.toggle("hidden", !cb.checked); };
      cb.addEventListener("change", sync);
      sync();
    });
    body.querySelectorAll("[data-reveal-select]").forEach(function (block) {
      const sel = body.querySelector('select[name="' + block.dataset.revealSelect + '"]');
      if (!sel) return;
      const values = String(block.dataset.revealValues || "").split(",").map(function (v) { return v.trim(); }).filter(Boolean);
      const sync = function () { block.classList.toggle("hidden", values.indexOf(sel.value) === -1); };
      sel.addEventListener("change", sync);
      sync();
    });
  }

  function open(title, bodyHtml, onSubmit, submitLabel, opts) {
    opts = opts || {};
    if (window.App && window.App.closeDrawer) window.App.closeDrawer();
    document.getElementById("modal-title").textContent = title;
    bodyEl().innerHTML = bodyHtml;
    setSubmitLabel(submitLabel || "Save");
    showError("");
    submitting = false;
    submitCallback = onSubmit;
    submitBtn().disabled = false;
    backdrop().classList.remove("hidden");
    wireReveals();
    if (opts.onOpen) opts.onOpen(form());
    const first = bodyEl().querySelector("input:not([type=hidden]):not([type=file]), select, textarea");
    if (first) {
      try { first.focus(); } catch (e) { }
    }
  }

  function close() {
    backdrop().classList.add("hidden");
    submitCallback = null;
    submitting = false;
    showError("");
    bodyEl().innerHTML = "";
    setSubmitLabel("Save");
  }

  function isOpen() {
    return !backdrop().classList.contains("hidden");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!submitCallback || submitting) return;
    const f = form();
    const data = Object.fromEntries(new FormData(f).entries());
    submitting = true;
    submitBtn().disabled = true;
    showError("");
    try {
      await submitCallback(data, f);
    } catch (e) {
      showError(e && e.message ? e.message : String(e));
    }
    submitting = false;
    if (isOpen()) submitBtn().disabled = false;
  }

  function field(label, name, value, opts) {
    opts = opts || {};
    return '<label class="field' + (opts.wide ? " wide" : "") + '">' + U.esc(label) +
      '<input type="' + (opts.type || "text") + '" name="' + U.esc(name) + '" value="' + U.esc(value || "") + '"' +
      (opts.placeholder ? ' placeholder="' + U.esc(opts.placeholder) + '"' : "") +
      (opts.required ? " required" : "") +
      (opts.list ? ' list="' + U.esc(opts.list) + '"' : "") +
      " />" +
      (opts.help ? '<span class="help-text">' + U.esc(opts.help) + "</span>" : "") +
      "</label>";
  }

  function select(label, name, options, opts) {
    opts = opts || {};
    const optsHtml = options.map(function (o) {
      return '<option value="' + U.esc(o.value) + '"' + (String(o.value) === String(opts.value || "") ? " selected" : "") + ">" + U.esc(o.label) + "</option>";
    }).join("");
    return '<label class="field' + (opts.wide ? " wide" : "") + '">' + U.esc(label) +
      '<select name="' + U.esc(name) + '"' + (opts.required ? " required" : "") + ">" + optsHtml + "</select>" +
      (opts.help ? '<span class="help-text">' + U.esc(opts.help) + "</span>" : "") +
      "</label>";
  }

  function textarea(label, name, value, opts) {
    opts = opts || {};
    return '<label class="field' + (opts.wide === false ? "" : " wide") + '">' + U.esc(label) +
      '<textarea name="' + U.esc(name) + '"' +
      (opts.placeholder ? ' placeholder="' + U.esc(opts.placeholder) + '"' : "") +
      (opts.required ? " required" : "") + ">" + U.esc(value || "") + "</textarea>" +
      (opts.help ? '<span class="help-text">' + U.esc(opts.help) + "</span>" : "") +
      "</label>";
  }

  function checkbox(label, name, checked) {
    return '<div class="field check-field">' +
      '<label class="check-line"><input type="checkbox" name="' + U.esc(name) + '"' + (checked ? " checked" : "") + " /> " + U.esc(label) + "</label></div>";
  }

  function divider(text) {
    return '<div class="modal-divider"><span>' + U.esc(text) + "</span></div>";
  }

  function required(value, message) {
    const v = String(value || "").trim();
    if (!v) throw new Error(message);
    return v;
  }

  function investorModal(investor) {
    const editing = !!investor;
    const inv = investor || { name: "", type: "", website: "", location: "", preferences: "", notes: "" };
    const body =
      '<datalist id="investor-type-list">' + U.INVESTOR_TYPES.map(function (t) { return '<option value="' + U.esc(t) + '">'; }).join("") + "</datalist>" +
      field("Name", "name", inv.name, { required: true, placeholder: "e.g. Goldman Sachs", wide: true }) +
      field("Type", "type", inv.type, { placeholder: "e.g. Family office", list: "investor-type-list", help: "Pick a suggestion or type your own" }) +
      field("Website", "website", inv.website, { placeholder: "https://…" }) +
      field("Location", "location", inv.location, { placeholder: "e.g. Milan, Italy" }) +
      textarea("Preferences", "preferences", inv.preferences, { placeholder: "What they invest in, ticket sizes, constraints…" }) +
      textarea("Notes", "notes", inv.notes, { placeholder: "General notes" });
    open(editing ? "Edit investor" : "Add investor", body, function (data) {
      const result = {
        name: required(data.name, "Name is required."),
        type: String(data.type || "").trim(),
        website: String(data.website || "").trim(),
        location: String(data.location || "").trim(),
        preferences: String(data.preferences || "").trim(),
        notes: String(data.notes || "").trim()
      };
      close();
      App.commitInvestor(editing ? investor.id : null, result);
    });
  }

  function contactModal(investor, contact) {
    const editing = !!contact;
    const c = contact || { name: "", title: "", email: "", phone: "", notes: "", isPrimary: false };
    const body =
      field("Name", "name", c.name, { placeholder: "e.g. Jane Doe" }) +
      field("Title", "title", c.title, { placeholder: "e.g. Managing Director" }) +
      field("Email", "email", c.email, { placeholder: "jane@firm.com", help: "Kept as typed — invalid addresses get a review flag, not a block" }) +
      field("Phone", "phone", c.phone, { placeholder: "+39 …" }) +
      textarea("Notes", "notes", c.notes, { placeholder: "Context, intro path…" }) +
      checkbox("Primary contact", "isPrimary", !!c.isPrimary);
    open(editing ? "Edit contact" : "Add contact — " + investor.name, body, function (data) {
      const result = {
        name: String(data.name || "").trim(),
        title: String(data.title || "").trim(),
        email: String(data.email || "").trim(),
        phone: String(data.phone || "").trim(),
        notes: String(data.notes || "").trim(),
        isPrimary: data.isPrimary === "on"
      };
      if (!result.name && !result.title && !result.email) throw new Error("Give the contact at least a name, title or email.");
      close();
      App.commitContact(investor.id, editing ? contact.id : null, result);
    });
  }

  function contactOptionsFor(state, engagement) {
    const inv = engagement ? Views.investorById(state, engagement.investorId) : null;
    return [{ value: "", label: "— none —" }].concat(
      (inv ? inv.contacts : []).map(function (c) {
        const d = U.contactDisplay(c);
        return { value: c.id, label: d.primary + (d.secondary ? " (" + d.secondary + ")" : "") };
      })
    );
  }

  function activityModal(state, engagementId, preset) {
    preset = preset || {};
    const found = Views.findEngagement(state, engagementId);
    if (!found) return;
    const inv = Views.investorById(state, found.engagement.investorId);
    const body =
      field("Date", "date", preset.date !== undefined && preset.date !== null ? preset.date : U.todayISO(), { type: "date", help: "Backdating is fine — Last outreach follows the latest dated outreach" }) +
      select("Type", "type", U.ACTIVITY_TYPES.map(function (t) { return { value: t, label: t }; }), { value: preset.type || "Email" }) +
      select("Contact", "contactId", contactOptionsFor(state, found.engagement), { value: preset.contactId || "", help: "Person this activity involved (optional)" }) +
      select("Team member", "teamMember", [{ value: "", label: "— unknown —" }].concat(U.TEAM.map(function (t) { return { value: t, label: t }; })), { value: preset.teamMember || App.getMyOwner() }) +
      textarea("Summary", "summary", preset.summary || "", { placeholder: "What happened? e.g. Sent deck, brief call with…", required: true }) +
      divider("Optional — stage change") +
      checkbox("Change investor discussion stage", "doStage", false) +
      '<div class="reveal-block" data-reveal="doStage">' +
      select("New investor discussion stage", "stage", U.STAGES.map(function (s) { return { value: s.id, label: s.label }; }), { value: found.engagement.stage, help: "Investor stage — independent from the project delivery stage" }) +
      "</div>" +
      divider("Optional — follow-up task") +
      checkbox("Schedule follow-up", "doFollow", false) +
      '<div class="reveal-block" data-reveal="doFollow">' +
      field("Follow-up title", "followTitle", "Follow up with " + (inv ? inv.name : ""), { placeholder: "e.g. Send updated deck" }) +
      field("Follow-up due date", "followDue", "", { type: "date" }) +
      select("Follow-up owner", "followOwner", [{ value: "", label: "— unset —" }].concat(U.TEAM.map(function (t) { return { value: t, label: t }; })), { value: preset.teamMember || App.getMyOwner() }) +
      "</div>";
    open("Log activity — " + (found.project.name + " · " + (inv ? inv.name : "")), body, function (data) {
      const summary = required(data.summary, "Summary is required — describe what happened.");
      close();
      App.commitActivity({
        engagementId: engagementId,
        date: data.date ? String(data.date) : null,
        type: String(data.type || "Note"),
        contactId: data.contactId || null,
        teamMember: String(data.teamMember || ""),
        summary: summary,
        changeStage: data.doStage === "on" ? String(data.stage) : null,
        follow: data.doFollow === "on" ? {
          title: String(data.followTitle || "").trim(),
          dueDate: data.followDue ? String(data.followDue) : "",
          owner: String(data.followOwner || "")
        } : null
      });
    }, "Save activity");
  }

  function recordOutreachModal(state, engagementId, preset) {
    preset = preset || {};
    const found = Views.findEngagement(state, engagementId);
    if (!found) return;
    const inv = Views.investorById(state, found.engagement.investorId);
    const body =
      field("Outreach date", "date", preset.date || U.todayISO(), { type: "date", required: true, help: "Backdated entries are supported" }) +
      select("Outreach type", "outreachType", U.OUTREACH_TYPES.map(function (t) { return { value: t, label: t }; }), { value: preset.outreachType || "Email" }) +
      select("Team member", "teamMember", [{ value: "", label: "— unknown —" }].concat(["Suzana", "Bruno", "Both"].map(function (t) { return { value: t, label: t }; })), { value: preset.teamMember || App.getMyOwner() }) +
      select("Contact", "contactId", contactOptionsFor(state, found.engagement), { value: preset.contactId || "", help: "Optional" }) +
      textarea("Description", "summary", preset.summary || "", { placeholder: "Brief description of the outreach…", required: true }) +
      divider("Optional next action") +
      checkbox("Add next action", "doNext", false) +
      '<div class="reveal-block" data-reveal="doNext">' +
      field("Next action", "nextTitle", "", { placeholder: "e.g. Send updated deck" }) +
      field("Due date", "nextDue", "", { type: "date" }) +
      select("Owner", "nextOwner", [{ value: "", label: "— unset —" }].concat(["Suzana", "Bruno", "Both"].map(function (t) { return { value: t, label: t }; })), { value: preset.teamMember || App.getMyOwner() }) +
      "</div>";
    open("Record outreach — " + (found.project.name + " · " + (inv ? inv.name : "")), body, function (data) {
      const summary = required(data.summary, "Description is required.");
      const date = required(data.date, "Outreach date is required.");
      if (!U.isValidISODate(date)) throw new Error("Outreach date must be a valid date (YYYY-MM-DD).");
      close();
      App.commitOutreach({
        engagementId: engagementId,
        date: date,
        outreachType: String(data.outreachType || "Other outreach"),
        teamMember: String(data.teamMember || ""),
        contactId: data.contactId || null,
        summary: summary,
        next: data.doNext === "on" ? {
          title: String(data.nextTitle || "").trim(),
          dueDate: data.nextDue ? String(data.nextDue) : "",
          owner: String(data.nextOwner || "")
        } : null
      });
    }, "Record outreach");
  }

  function activityEditModal(state, activity) {
    const found = Views.findEngagement(state, activity.engagementId);
    if (!found) return;
    const inv = Views.investorById(state, found.engagement.investorId);
    const body =
      field("Date", "date", activity.date || "", { type: "date", help: "Leave empty only for undated historical records" }) +
      select("Type", "type", U.ACTIVITY_TYPES.map(function (t) { return { value: t, label: t }; }), { value: activity.type }) +
      select("Contact", "contactId", contactOptionsFor(state, found.engagement), { value: activity.contactId || "" }) +
      select("Team member", "teamMember", [{ value: "", label: "— unknown —" }].concat(U.TEAM.map(function (t) { return { value: t, label: t }; })), { value: activity.teamMember || "" }) +
      textarea("Summary", "summary", activity.summary || "", { required: true });
    open("Edit activity — " + (inv ? inv.name : ""), body, function (data) {
      const summary = required(data.summary, "Summary is required.");
      const date = data.date ? String(data.date) : null;
      if (date && !U.isValidISODate(date)) throw new Error("Date must be a valid date (YYYY-MM-DD).");
      close();
      App.commitActivityEdit(activity.id, {
        date: date,
        type: String(data.type || "Note"),
        contactId: data.contactId || null,
        teamMember: String(data.teamMember || ""),
        summary: summary
      });
    }, "Save changes");
  }

  function engagementModal(state, investorId, defaults) {
    defaults = defaults || {};
    let investorOptions;
    if (investorId) {
      const inv = Views.investorById(state, investorId);
      if (!inv) return;
      investorOptions = [{ value: inv.id, label: inv.name }];
    } else {
      investorOptions = state.investors.filter(function (i) { return !i.archived; })
        .sort(function (a, b) { return a.name.localeCompare(b.name); })
        .map(function (i) { return { value: i.id, label: i.name }; });
      if (investorOptions.length === 0) {
        U.toast("Create an investor first, then assign it to a project.", "info");
        return;
      }
      investorOptions.unshift({ value: "", label: "— select investor —" });
    }
    const occupied = new Set();
    if (investorId) {
      state.projects.forEach(function (p) {
        p.engagements.forEach(function (e) {
          if (!e.archived && e.investorId === investorId) occupied.add(p.id);
        });
      });
    }
    const projectOptions = state.projects.filter(function (p) { return !p.archived && !occupied.has(p.id); })
      .map(function (p) { return { value: p.id, label: p.name }; });
    if (projectOptions.length === 0) {
      U.toast(investorId ? "This investor is already in every project." : "No free project — pick another investor or add a project.", "info");
      return;
    }
    const body =
      (investorId ? "" : select("Investor", "investorId", investorOptions, { required: true })) +
      select("Project", "projectId", projectOptions, { required: true, value: defaults.projectId }) +
      select("Investor discussion stage", "stage", U.STAGES.map(function (s) { return { value: s.id, label: s.label }; }), { value: "not_contacted", help: "Investor stage — not the project delivery stage" }) +
      select("Priority", "priority", [{ value: "", label: "— unset —" }].concat(U.PRIORITIES.map(function (p) { return { value: p, label: p }; })), { value: "" }) +
      select("Owner", "owner", [{ value: "", label: "— unset —" }].concat(U.TEAM.map(function (t) { return { value: t, label: t }; })), { value: "" });
    open(investorId ? "Add to project" : "Add engagement", body, function (data) {
      const chosenInvestor = investorId || data.investorId;
      if (!chosenInvestor || !data.projectId) throw new Error("Choose an investor and a project.");
      close();
      App.commitEngagement({
        investorId: chosenInvestor,
        projectId: String(data.projectId),
        stage: String(data.stage || "not_contacted"),
        priority: String(data.priority || ""),
        owner: String(data.owner || "")
      });
    });
  }

  function engagementPickerModal(state, onPick) {
    const options = [{ value: "", label: "— select investor and project —" }];
    state.projects.forEach(function (p) {
      if (p.archived) return;
      p.engagements.forEach(function (e) {
        if (e.archived) return;
        const inv = Views.investorById(state, e.investorId);
        options.push({ value: e.id, label: p.name + " → " + (inv ? inv.name : "?") });
      });
    });
    if (options.length === 1) {
      U.toast("No engagements yet — add an investor to a project first.", "info");
      return;
    }
    const body = select("Investor and project", "engagementId", options, { required: true, wide: true });
    open("Log activity", body, function (data) {
      const id = data.engagementId;
      if (!id) throw new Error("Choose an engagement to log against.");
      close();
      setTimeout(function () {
        if (onPick) onPick(id);
        else activityModal(state, id, {});
      }, 0);
    });
  }

  function taskModal(state, task, defaults) {
    defaults = defaults || {};
    const editing = !!task;
    const t = task || {
      title: "", owner: defaults.owner || "", dueDate: defaults.dueDate || "", status: "To do", priority: "",
      notes: "", projectId: defaults.projectId || state.activeProjectId || "",
      engagementId: defaults.engagementId || "", contactId: "",
      stage: defaults.stage || "", kind: defaults.kind || "task"
    };
    const projectOptions = [{ value: "", label: "— none —" }].concat(
      state.projects.filter(function (p) { return !p.archived; }).map(function (p) { return { value: p.id, label: p.name }; })
    );
    const body =
      field("Task", "title", t.title, { required: true, placeholder: "e.g. Send deck to Banca Ifis", wide: true }) +
      select("Kind", "kind", [{ value: "task", label: "Task" }, { value: "appointment", label: "Appointment (planned call/meeting)" }], { value: t.kind || "task" }) +
      select("Status", "status", U.TASK_STATUSES.map(function (s) { return { value: s, label: s }; }), { value: t.status }) +
      '<div class="reveal-block" data-reveal-select="status" data-reveal-values="Waiting">' +
      select("Waiting reason", "waitingReason", [{ value: "", label: "— not specified —" }, { value: "Awaiting investor reply", label: "Awaiting investor reply" }, { value: "Awaiting internal input", label: "Awaiting internal input" }, { value: "Awaiting documents", label: "Awaiting documents" }, { value: "On hold", label: "On hold" }], { value: t.waitingReason || "" }) +
      "</div>" +
      select("Owner", "owner", [{ value: "", label: "— Unassigned —" }, { value: "Suzana", label: "Suzana" }, { value: "Bruno", label: "Bruno" }], { value: t.owner }) +
      field("Due date", "dueDate", t.dueDate, { type: "date" }) +
      select("Priority", "priority", [{ value: "", label: "— unset —" }].concat(U.PRIORITIES.map(function (p) { return { value: p, label: p }; })), { value: t.priority }) +
      select("Project", "projectId", projectOptions, { value: t.projectId }) +
      select("Delivery stage", "stage", [{ value: "", label: "— none —" }].concat(U.PROJECT_STAGES.map(function (s) { return { value: s.id, label: s.label }; })), { value: t.stage || "", help: "Project delivery stage (distinct from investor stage)" }) +
      select("Engagement", "engagementId", [{ value: "", label: "— none —" }], { value: t.engagementId }) +
      select("Contact", "contactId", [{ value: "", label: "— none —" }], { value: t.contactId }) +
      textarea("Description", "notes", t.notes, { placeholder: "Optional details" });
    open(editing ? "Edit task" : (t.kind === "appointment" ? "New appointment" : "Add task"), body, function (data) {
      const title = required(data.title, "Task title is required.");
      const due = data.dueDate ? String(data.dueDate) : "";
      if (due && !U.isValidISODate(due)) throw new Error("Due date must be a valid date (YYYY-MM-DD).");
      close();
      App.commitTask(editing ? task.id : null, {
        title: title,
        kind: String(data.kind || "task"),
        status: String(data.status || "To do"),
        waitingReason: String(data.status || "") === "Waiting" ? String(data.waitingReason || "") : "",
        owner: String(data.owner || ""),
        dueDate: due,
        priority: String(data.priority || ""),
        notes: String(data.notes || "").trim(),
        projectId: String(data.projectId || ""),
        stage: String(data.stage || ""),
        engagementId: String(data.engagementId || ""),
        contactId: String(data.contactId || "")
      });
    });
    wireLinkage(state, { engagementId: t.engagementId, contactId: t.contactId });
  }

  function wireLinkage(state, initial) {
    initial = initial || {};
    const f = form();
    const projectSel = f.querySelector('[name="projectId"]');
    const engSel = f.querySelector('[name="engagementId"]');
    const contactSel = f.querySelector('[name="contactId"]');
    if (!projectSel || !engSel || !contactSel) return;
    let firstEngagementRefresh = true;
    let firstContactRefresh = true;

    function refreshEngagements() {
      const projectId = projectSel.value;
      const current = firstEngagementRefresh ? (initial.engagementId || engSel.value) : engSel.value;
      firstEngagementRefresh = false;
      const options = ['<option value="">— none —</option>'];
      state.projects.forEach(function (p) {
        if (p.id !== projectId || p.archived) return;
        p.engagements.forEach(function (e) {
          if (e.archived) return;
          const inv = Views.investorById(state, e.investorId);
          options.push('<option value="' + U.esc(e.id) + '">' + U.esc(inv ? inv.name : "?") + " · " + U.esc(U.stageInfo(e.stage).label) + "</option>");
        });
      });
      engSel.innerHTML = options.join("");
      if ([].slice.call(engSel.options).some(function (o) { return o.value === current; })) engSel.value = current;
      refreshContacts();
    }

    function refreshContacts() {
      const engId = engSel.value;
      const current = firstContactRefresh ? (initial.contactId || contactSel.value) : contactSel.value;
      firstContactRefresh = false;
      const options = ['<option value="">— none —</option>'];
      if (engId) {
        const found = Views.findEngagement(state, engId);
        if (found) {
          const inv = Views.investorById(state, found.engagement.investorId);
          if (inv) {
            inv.contacts.forEach(function (c) {
              const d = U.contactDisplay(c);
              options.push('<option value="' + U.esc(c.id) + '">' + U.esc(d.primary) + "</option>");
            });
          }
        }
      }
      contactSel.innerHTML = options.join("");
      if ([].slice.call(contactSel.options).some(function (o) { return o.value === current; })) contactSel.value = current;
    }

    projectSel.addEventListener("change", refreshEngagements);
    engSel.addEventListener("change", refreshContacts);
    refreshEngagements();
  }

  function projectModal(project) {
    const editing = !!project;
    const body = field("Project name", "name", project ? project.name : "", { required: true, wide: true, placeholder: "e.g. Palazzo Ricci" });
    open(editing ? "Rename project" : "New project", body, function (data) {
      const name = required(data.name, "Project name is required.");
      close();
      App.commitProject(editing ? project.id : null, name);
    });
  }

  function agreementModal(project, mode) {
    const ag = project.agreement || { status: "not_started", sentDate: "", sentBy: "", signedDate: "", docLink: "", notes: "", history: [] };
    let body;
    if (mode === "sent") {
      body =
        field("Sent date", "sentDate", U.todayISO(), { type: "date", required: true }) +
        select("Recorded by", "sentBy", ["Suzana", "Bruno"].map(function (t) { return { value: t, label: t }; }), { value: App.getMyOwner() || "Suzana" }) +
        textarea("Notes", "notes", "", { placeholder: "Optional note about sending the agreement" });
      open("Record agreement sent — " + project.name, body, function (data) {
        const date = required(data.sentDate, "Sent date is required.");
        if (!U.isValidISODate(date)) throw new Error("Sent date must be a valid date.");
        close();
        App.commitAgreement(project.id, {
          status: "sent", sentDate: date, sentBy: String(data.sentBy || ""),
          notes: String(data.notes || "").trim(), keepSigned: true
        });
      }, "Save");
      return;
    }
    if (mode === "signed") {
      body =
        field("Signed date", "signedDate", U.todayISO(), { type: "date", required: true }) +
        textarea("Notes", "notes", "", { placeholder: "Optional note" });
      open("Record agreement signed — " + project.name, body, function (data) {
        const date = required(data.signedDate, "Signed date is required.");
        if (!U.isValidISODate(date)) throw new Error("Signed date must be a valid date.");
        close();
        App.commitAgreement(project.id, {
          status: "signed", signedDate: date, keepSent: true,
          notes: String(data.notes || "").trim()
        });
      }, "Save");
      return;
    }
    body =
      select("Status", "status", U.AGREEMENT_STATUSES.map(function (s) { return { value: s.id, label: s.label }; }), { value: ag.status || "not_started", wide: true }) +
      '<div class="reveal-block" data-reveal-select="status" data-reveal-values="sent,signed">' +
      field("Sent date", "sentDate", ag.sentDate || "", { type: "date" }) +
      select("Sent by", "sentBy", [{ value: "", label: "— unknown —" }].concat(["Suzana", "Bruno", "Both"].map(function (t) { return { value: t, label: t }; })), { value: ag.sentBy || "" }) +
      "</div>" +
      '<div class="reveal-block" data-reveal-select="status" data-reveal-values="signed">' +
      field("Signed date", "signedDate", ag.signedDate || "", { type: "date" }) +
      "</div>" +
      field("Document link", "docLink", ag.docLink || "", { placeholder: "https://… (optional)", wide: true }) +
      textarea("Notes", "notes", ag.notes || "", { placeholder: "Optional notes" });
    open("Client engagement agreement — " + project.name, body, function (data) {
      const status = String(data.status || "not_started");
      const payload = {
        status: status,
        sentDate: data.sentDate ? String(data.sentDate) : "",
        sentBy: String(data.sentBy || ""),
        signedDate: data.signedDate ? String(data.signedDate) : "",
        docLink: String(data.docLink || "").trim(),
        notes: String(data.notes || "").trim()
      };
      if (payload.sentDate && !U.isValidISODate(payload.sentDate)) throw new Error("Sent date must be a valid date.");
      if (payload.signedDate && !U.isValidISODate(payload.signedDate)) throw new Error("Signed date must be a valid date.");
      if ((status === "sent" || status === "signed") && !payload.sentDate && !ag.sentDate) throw new Error("A sent date is required when the status is Sent or Signed.");
      close();
      App.commitAgreement(project.id, payload);
    }, "Save agreement");
  }

  function stageChangeModal(project, toStageId) {
    const info = U.projectStageInfo(toStageId);
    const current = project.deliveryStage ? (U.projectStageInfo(project.deliveryStage) || {}).label : "Stage not set";
    const body =
      field("Date", "date", U.todayISO(), { type: "date", required: true }) +
      select("Changed by", "by", [{ value: "", label: "— unknown —" }].concat(["Suzana", "Bruno"].map(function (t) { return { value: t, label: t }; })), { value: App.getMyOwner() || "" }) +
      textarea("Note", "note", "", { placeholder: "Optional note for the stage history" });
    open('Set delivery stage: ' + current + " → " + (info ? info.label : toStageId) + " — " + project.name, body, function (data) {
      const date = required(data.date, "Date is required.");
      if (!U.isValidISODate(date)) throw new Error("Date must be a valid date.");
      close();
      App.commitStageChange(project.id, toStageId, {
        date: date, by: String(data.by || ""), note: String(data.note || "").trim()
      });
    }, "Set stage");
  }

  function milestonesModal(project) {
    const rows = (project.milestones || []).map(function (m, i) {
      return '<div class="wizard-row">' +
        '<input class="inline-input" data-ms-label="' + i + '" value="' + U.esc(m.label) + '" placeholder="Milestone label" style="flex:1" />' +
        '<input class="inline-input" type="date" data-ms-date="' + i + '" value="' + U.esc(m.date) + '" />' +
        '<button type="button" class="ghost-btn danger" data-ms-remove="' + i + '">Remove</button>' +
        "</div>";
    }).join("");
    const body =
      '<div class="wizard-steps" style="grid-column:1/-1"><span class="step active">Target milestone dates — shown on the project card and Calendar</span></div>' +
      '<div id="ms-rows" style="grid-column:1/-1">' + (rows || '<div class="empty-mini">No milestones yet.</div>') + "</div>" +
      '<div class="wizard-row" style="border-top:1px solid var(--border)">' +
      '<input class="inline-input" id="ms-new-label" placeholder="New milestone label" style="flex:1" />' +
      '<input class="inline-input" type="date" id="ms-new-date" />' +
      "</div>";
    open("Milestones — " + project.name, body, function () {
      const f = form();
      const out = [];
      f.querySelectorAll("[data-ms-label]").forEach(function (inp) {
        const idx = Number(inp.dataset.msLabel);
        const label = inp.value.trim();
        const dateEl = f.querySelector('[data-ms-date="' + idx + '"]');
        if (label) out.push({ id: (project.milestones[idx] || {}).id || U.uid(), label: label, date: dateEl ? dateEl.value : "" });
      });
      const newLabel = f.querySelector("#ms-new-label");
      const newDate = f.querySelector("#ms-new-date");
      if (newLabel && newLabel.value.trim()) out.push({ id: U.uid(), label: newLabel.value.trim(), date: newDate ? newDate.value : "" });
      close();
      App.commitMilestones(project.id, out);
    }, "Save milestones", {
      onOpen: function (f) {
        f.querySelectorAll("[data-ms-remove]").forEach(function (btn) {
          btn.addEventListener("click", function () { btn.closest(".wizard-row").remove(); });
        });
      }
    });
  }

  function templatesApplyModal(state, project, stageId) {
    const info = U.projectStageInfo(stageId);
    const templates = (state.taskTemplates || []).filter(function (t) { return t.stage === stageId && t.enabled; });
    if (templates.length === 0) {
      U.toast("No enabled templates for this stage. Edit them under Templates.", "info");
      return;
    }
    const existingKeys = new Set(state.tasks.filter(function (t) { return t.projectId === project.id && t.templateKey; }).map(function (t) { return t.templateKey; }));
    const rows = templates.map(function (t, i) {
      const key = stageId + ":" + U.normalizeKey(t.title);
      const dup = existingKeys.has(key);
      return '<div class="wizard-row">' +
        '<label class="check-line"><input type="checkbox" name="tpl_' + i + '"' + (dup ? "" : " checked") + (dup ? " disabled" : "") + " /> " + U.esc(t.title) + "</label>" +
        (dup ? '<span class="chip chip-plain">already exists</span>' : "") +
        '<select class="inline-select" name="tplOwner_' + i + '"><option value="">Unassigned</option><option value="Suzana">Suzana</option><option value="Bruno">Bruno</option></select>' +
        '<input class="inline-input" type="date" name="tplDue_' + i + '" title="Due date" />' +
        "</div>";
    }).join("");
    const body =
      '<div class="wizard-steps" style="grid-column:1/-1"><span class="step active">' + U.esc(info ? info.label : stageId) + "</span>" +
      '<span class="step">select tasks, set owners and dates, then create</span></div>' +
      rows;
    open("Apply stage templates — " + project.name, body, function (data) {
      const picks = templates.map(function (t, i) {
        return {
          template: t,
          selected: data["tpl_" + i] === "on",
          owner: String(data["tplOwner_" + i] || ""),
          due: data["tplDue_" + i] ? String(data["tplDue_" + i]) : ""
        };
      }).filter(function (p) { return p.selected; });
      if (picks.length === 0) throw new Error("Select at least one template task.");
      close();
      App.commitApplyTemplates(project.id, stageId, picks);
    }, "Create tasks");
  }

  function templatesManageModal(state) {
    const stages = U.PROJECT_STAGES.map(function (s) {
      const items = (state.taskTemplates || []).map(function (t, i) { return { t: t, i: i }; }).filter(function (x) { return x.t.stage === s.id; });
      const rows = items.map(function (x) {
        return '<div class="wizard-row">' +
          '<input class="inline-input" data-tpl-title="' + x.i + '" value="' + U.esc(x.t.title) + '" style="flex:1" />' +
          '<label class="check-line"><input type="checkbox" data-tpl-enabled="' + x.i + '"' + (x.t.enabled ? " checked" : "") + " /> enabled</label>" +
          '<button type="button" class="ghost-btn danger" data-tpl-remove="' + x.i + '">Remove</button>' +
          "</div>";
      }).join("");
      return '<div class="modal-divider"><span>' + U.esc(s.label) + "</span></div>" +
        (rows || '<div class="empty-mini">No templates for this stage.</div>') +
        '<div class="wizard-row"><input class="inline-input" data-tpl-new="' + s.id + '" placeholder="Add template task…" style="flex:1" /></div>';
    }).join("");
    const body = '<div style="grid-column:1/-1">' + stages + "</div>";
    open("Stage task templates", body, function () {
      const f = form();
      const out = [];
      const seen = new Set();
      f.querySelectorAll("[data-tpl-title]").forEach(function (inp) {
        const idx = Number(inp.dataset.tplTitle);
        const orig = (state.taskTemplates || [])[idx];
        if (!orig) return;
        const title = inp.value.trim();
        if (!title) return;
        const enabledEl = f.querySelector('[data-tpl-enabled="' + idx + '"]');
        out.push({ id: orig.id, stage: orig.stage, title: title, enabled: enabledEl ? enabledEl.checked : true });
        seen.add(orig.id);
      });
      f.querySelectorAll("[data-tpl-new]").forEach(function (inp) {
        const title = inp.value.trim();
        if (!title) return;
        out.push({ id: U.uid(), stage: inp.dataset.tplNew, title: title, enabled: true });
      });
      if (out.length === 0) throw new Error("Keep at least one template, or disable them instead of deleting all.");
      close();
      App.commitTemplates(out);
    }, "Save templates", {
      onOpen: function (f) {
        f.querySelectorAll("[data-tpl-remove]").forEach(function (btn) {
          btn.addEventListener("click", function () { btn.closest(".wizard-row").remove(); });
        });
      }
    });
  }

  function assignProjectsModal(state, investorIds) {
    if (!investorIds || investorIds.length === 0) {
      U.toast("Select investors first.", "info");
      return;
    }
    const projectOptions = state.projects.filter(function (p) { return !p.archived; })
      .map(function (p) { return { value: p.id, label: p.name }; });
    if (projectOptions.length === 0) {
      U.toast("Create a project first.", "info");
      return;
    }
    const names = investorIds.map(function (id) {
      const inv = Views.investorById(state, id);
      return inv ? inv.name : null;
    }).filter(Boolean);
    const body =
      select("Destination project", "projectId", [{ value: "", label: "— choose a project —" }].concat(projectOptions), { required: true, wide: true }) +
      '<div class="review-list">' + names.map(function (n) {
        return '<div class="rline"><span class="rname">' + U.esc(n) + "</span></div>";
      }).join("") + "</div>" +
      '<div class="help-text" style="grid-column:1/-1">' + names.length +
      " investors selected. Existing relationships in the target project are skipped; new assignments start as Not contacted — no outreach is invented.</div>";
    open("Assign to project (" + names.length + ")", body, function (data) {
      if (!data.projectId) throw new Error("Choose a destination project.");
      close();
      App.commitBulkAssign(String(data.projectId), investorIds);
    }, "Assign");
  }

  const IMPORT_FIELDS = [
    { key: "name", label: "Investor name *", guess: ["company", "company name", "investor", "investor name", "institution", "institution name", "name", "organization", "organisation"], required: true },
    { key: "type", label: "Investor type", guess: ["type", "company type", "investor type", "category"] },
    { key: "contactName", label: "Contact name", guess: ["contact name", "full name", "contact person", "person"] },
    { key: "contactTitle", label: "Contact title", guess: ["contact title", "title", "job title", "role", "position"] },
    { key: "contactEmail", label: "Contact email", guess: ["contact email", "email", "e-mail", "email address"] },
    { key: "contactPhone", label: "Contact phone", guess: ["phone", "telephone", "tel"] },
    { key: "stage", label: "Investor stage", guess: ["stage", "discussion stage"] },
    { key: "owner", label: "Owner", guess: ["owner", "who reached out", "who reached out (legacy)", "who"] },
    { key: "reached", label: "Reached out (yes/no)", guess: ["reached out", "reached out (legacy)", "outreach", "contacted"] },
    { key: "outreachDate", label: "Outreach date", guess: ["date reached out", "date reached out (legacy)", "date", "outreach date"] },
    { key: "response", label: "Response", guess: ["response", "response (legacy)"] },
    { key: "movingForward", label: "Moving forward", guess: ["moving forward", "moving forward (legacy)"] },
    { key: "nextSteps", label: "Next steps", guess: ["next steps", "next steps (legacy)"] },
    { key: "project", label: "Project column (multi-project files)", guess: ["project", "project name", "deal"] }
  ];

  function guessColumn(headers, guess) {
    for (let i = 0; i < guess.length; i++) {
      const idx = headers.findIndex(function (h) { return U.normalizeKey(h) === guess[i]; });
      if (idx !== -1) return idx;
    }
    for (let i = 0; i < guess.length; i++) {
      const idx = headers.findIndex(function (h) { return U.normalizeKey(h).indexOf(guess[i]) !== -1; });
      if (idx !== -1) return idx;
    }
    return -1;
  }

  function importWizardModal(state, ctx) {
    ctx = ctx || {};
    const wiz = { step: 1, headers: [], rows: [], mapping: {}, destination: ctx.preselectProject || "", useProjectColumn: false, plan: null, fileName: "" };

    function projectOptions() {
      return [{ value: "", label: ctx.requireChoice ? "— choose a project —" : "Directory only (no project)" }]
        .concat(state.projects.filter(function (p) { return !p.archived; }).map(function (p) { return { value: p.id, label: p.name }; }));
    }

    function stepsHtml() {
      const labels = ["File", "Map columns", "Destination", "Review", "Confirm"];
      return '<div class="wizard-steps">' + labels.map(function (l, i) {
        const n = i + 1;
        const cls = n === wiz.step ? "step active" : n < wiz.step ? "step done" : "step";
        return '<span class="' + cls + '">' + n + ". " + U.esc(l) + "</span>";
      }).join("") + "</div>";
    }

    function bodyFor() {
      if (wiz.step === 1) {
        return stepsHtml() +
          '<div class="wizard-row">Choose a CSV or investor-list JSON file. Full CRM backups (with schemaVersion) open the restore flow instead.</div>' +
          '<label class="field wide">File<input type="file" id="wiz-file" accept=".csv,.json,text/csv,application/json" /></label>' +
          (wiz.fileName ? '<div class="wizard-row"><strong>' + U.esc(wiz.fileName) + "</strong> · " + wiz.rows.length + " rows · " + wiz.headers.length + " columns</div>" : "");
      }
      if (wiz.step === 2) {
        const mapRows = IMPORT_FIELDS.map(function (f) {
          const opts = ['<option value="-1">— not mapped —</option>'].concat(wiz.headers.map(function (h, i) {
            return '<option value="' + i + '"' + (wiz.mapping[f.key] === i ? " selected" : "") + ">" + U.esc(h) + "</option>";
          })).join("");
          return '<label class="field"><span>' + U.esc(f.label) + '</span><select data-map="' + f.key + '">' + opts + "</select></label>";
        }).join("");
        const preview = wiz.rows.slice(0, 4).map(function (r) {
          return '<div class="rline">' + U.esc(r.join(" | ").slice(0, 220)) + "</div>";
        }).join("");
        return stepsHtml() + '<div class="map-grid">' + mapRows + "</div>" +
          '<div class="modal-divider"><span>Preview (first rows)</span></div>' +
          '<div class="review-list">' + preview + "</div>";
      }
      if (wiz.step === 3) {
        return stepsHtml() +
          select("Destination project", "destination", projectOptions(), { value: wiz.destination, required: !ctx.requireChoice, wide: true, help: ctx.requireChoice ? "Required — pick a project or Directory only." : "Preselected from where you opened the import." }) +
          (wiz.mapping.project !== undefined && wiz.mapping.project >= 0
            ? checkbox("Use the mapped project column (multi-project files)", "useProjectColumn", wiz.useProjectColumn)
            : '<div class="wizard-row">No project column mapped — all rows go to the selected destination.</div>');
      }
      if (wiz.step === 4) {
        const p = wiz.plan;
        const lines = p.rows.map(function (r) {
          const cls = "rline action-" + r.action;
          return '<div class="' + cls + '"><span class="rname">' + U.esc(r.name || "(no name)") + "</span>" +
            "<span>" + U.esc(r.actionLabel) + "</span>" +
            (r.projectName ? "<span>· " + U.esc(r.projectName) + "</span>" : "") +
            (r.reason ? '<span class="cell-sub">' + U.esc(r.reason) + "</span>" : "") +
            (r.suggestion ? '<label class="check-line"><input type="checkbox" data-merge="' + U.esc(r.rowId) + '" /> merge into "' + U.esc(r.suggestion) + '"</label>' : "") +
            "</div>";
        }).join("");
        return stepsHtml() + '<div class="review-list">' + (lines || '<div class="rline">No rows to import.</div>') + "</div>" +
          '<div class="help-text" style="grid-column:1/-1">Uncertain matches are never merged automatically — tick a merge box only when it is the same institution.</div>';
      }
      const s = wiz.plan.summary;
      return stepsHtml() +
        '<div class="counts-grid">' +
        '<div class="count-box"><strong>' + s.investorsCreated + "</strong>investors created</div>" +
        '<div class="count-box"><strong>' + s.investorsReused + "</strong>investors reused</div>" +
        '<div class="count-box"><strong>' + s.contactsCreated + "</strong>contacts created</div>" +
        '<div class="count-box"><strong>' + s.engagementsCreated + "</strong>project assignments created</div>" +
        '<div class="count-box"><strong>' + s.skipped + "</strong>already assigned (skipped)</div>" +
        '<div class="count-box"><strong>' + s.rejected + "</strong>rejected rows</div>" +
        "</div>" +
        '<div class="wizard-row">New assignments start as <strong>Not contacted</strong> unless validated historical outreach is mapped and supplied.</div>';
    }

    function labelFor(action) {
      return {
        create: "create investor", reuse: "reuse investor", skip: "already in project — skip",
        reject: "rejected", uncertain: "possible match — creates a separate investor, flagged for review", contact_create: "", contact_reuse: ""
      }[action] || action;
    }

    function buildPlan() {
      const rows = [];
      const summary = { investorsCreated: 0, investorsReused: 0, contactsCreated: 0, engagementsCreated: 0, skipped: 0, rejected: 0 };
      const projectById = {};
      state.projects.forEach(function (p) { projectById[p.id] = p; });
      const projectNameByKey = {};
      state.projects.forEach(function (p) { projectNameByKey[U.normalizeKey(p.name)] = p; });
      const dest = wiz.destination || "";
      const get = function (row, key) {
        const col = wiz.mapping[key];
        return col >= 0 && col < row.length ? String(row[col] || "").trim() : "";
      };
      const seenInFile = {};
      wiz.rows.forEach(function (row, i) {
        const name = get(row, "name");
        const rowId = "r" + i;
        if (!name) {
          summary.rejected++;
          rows.push({ rowId: rowId, name: "", action: "reject", actionLabel: labelFor("reject"), reason: "no investor name", projectName: "" });
          return;
        }
        let targetProject = null;
        let projectName = "";
        if (wiz.useProjectColumn && wiz.mapping.project >= 0) {
          const pn = get(row, "project");
          targetProject = projectNameByKey[U.normalizeKey(pn)] || null;
          if (!targetProject) {
            summary.rejected++;
            rows.push({ rowId: rowId, name: name, action: "reject", actionLabel: labelFor("reject"), reason: 'unknown project "' + pn + '" — flagged, not guessed', projectName: pn });
            return;
          }
          projectName = targetProject.name;
        } else if (dest) {
          targetProject = projectById[dest] || null;
          projectName = targetProject ? targetProject.name : "";
        }
        const key = U.normalizeKey(name);
        if (seenInFile[key]) {
          summary.skipped++;
          rows.push({ rowId: rowId, name: name, action: "skip", actionLabel: "duplicate row in file — skip", projectName: projectName });
          return;
        }
        seenInFile[key] = true;
        const exact = state.investors.find(function (inv) { return U.normalizeKey(inv.name) === key; });
        const fuzzy = exact ? null : state.investors.find(function (inv) {
          const a = U.normalizeKey(inv.name), b = key;
          return a && b && (a.indexOf(b) === 0 || b.indexOf(a) === 0) && Math.abs(a.length - b.length) <= 4;
        });
        let action = "create";
        let suggestion = null;
        if (exact) action = "reuse";
        else if (fuzzy) { action = "uncertain"; suggestion = fuzzy.name; }
        const matchedInvestor = exact || fuzzy;
        if (targetProject && matchedInvestor) {
          const engaged = targetProject.engagements.some(function (e) { return !e.archived && e.investorId === matchedInvestor.id; });
          if (engaged) {
            summary.skipped++;
            rows.push({
              rowId: rowId, name: name, action: "skip",
              actionLabel: exact ? labelFor("skip") : "possible match already in this project — skipped",
              projectName: projectName, investorId: matchedInvestor.id, projectId: targetProject.id,
              reason: exact ? "" : 'may already be in the project as "' + matchedInvestor.name + '"'
            });
            return;
          }
        }
        if (action === "create" || action === "uncertain") summary.investorsCreated++;
        if (action === "reuse") summary.investorsReused++;
        if (targetProject) summary.engagementsCreated++;
        const cName = get(row, "contactName");
        const cEmail = get(row, "contactEmail");
        if (cName || cEmail) {
          const existingContact = exact && exact.contacts.some(function (c) {
            if (cEmail && c.email) return U.normalizeKey(c.email) === U.normalizeKey(cEmail);
            return cName && c.name && U.normalizeKey(c.name) === U.normalizeKey(cName);
          });
          if (!existingContact) summary.contactsCreated++;
        }
        rows.push({
          rowId: rowId, name: name, action: action, actionLabel: labelFor(action), projectName: projectName,
          investorId: exact ? exact.id : null, suggestion: suggestion, projectId: targetProject ? targetProject.id : null,
          data: {
            name: name, type: get(row, "type"),
            contactName: cName, contactTitle: get(row, "contactTitle"), contactEmail: cEmail, contactPhone: get(row, "contactPhone"),
            stage: get(row, "stage"), owner: get(row, "owner"), reached: get(row, "reached"),
            outreachDate: get(row, "outreachDate"), response: get(row, "response"),
            movingForward: get(row, "movingForward"), nextSteps: get(row, "nextSteps")
          }
        });
      });
      if (wiz.plan && wiz.plan.merges) {
        Object.keys(wiz.plan.merges).forEach(function (rowId) {
          const r = rows.find(function (x) { return x.rowId === rowId; });
          if (r && r.action === "uncertain") {
            r.action = "reuse";
            r.actionLabel = labelFor("reuse");
            r.investorId = wiz.plan.merges[rowId];
            summary.investorsCreated--;
            summary.investorsReused++;
          }
        });
      }
      wiz.plan = wiz.plan || {};
      wiz.plan.rows = rows;
      wiz.plan.summary = summary;
    }

    function reRender(keepSubmit) {
      const active = document.activeElement;
      const activeName = active && active.name;
      const activeValue = active && active.value;
      open("Import investors", bodyFor(), onSubmit, nextLabel(), {
        onOpen: function (f) {
          if (wiz.step === 1) {
            const inp = f.querySelector("#wiz-file");
            if (inp) inp.addEventListener("change", function () { handleFile(inp.files[0]); });
          }
          if (wiz.step === 2) {
            f.querySelectorAll("[data-map]").forEach(function (sel) {
              sel.addEventListener("change", function () { wiz.mapping[sel.dataset.map] = Number(sel.value); });
            });
          }
          if (wiz.step === 4) {
            f.querySelectorAll("[data-merge]").forEach(function (cb) {
              cb.addEventListener("change", function () {
                wiz.plan.merges = wiz.plan.merges || {};
                const rid = cb.dataset.merge;
                if (cb.checked) {
                  const r = wiz.plan.rows.find(function (x) { return x.rowId === rid; });
                  if (r && r.suggestion) {
                    const sug = state.investors.find(function (i) { return i.name === r.suggestion; });
                    if (sug) wiz.plan.merges[rid] = sug.id;
                  }
                } else delete wiz.plan.merges[rid];
              });
            });
          }
          if (activeName) {
            const el = f.querySelector('[name="' + activeName + '"]');
            if (el && activeValue !== undefined) { el.value = activeValue; }
          }
        }
      });
    }

    function nextLabel() {
      if (wiz.step === 1) return "Next: map columns";
      if (wiz.step === 2) return "Next: destination";
      if (wiz.step === 3) return "Next: review";
      if (wiz.step === 4) return "Next: confirm";
      return "Confirm import";
    }

    function handleFile(file) {
      if (!file) return;
      wiz.fileName = file.name;
      const reader = new FileReader();
      reader.onload = function () {
        try {
        const text = String(reader.result || "");
        if (/\.json$/i.test(file.name)) {
          let parsed;
          try { parsed = JSON.parse(text); } catch (e) { throw new Error("Cannot parse JSON: " + e.message); }
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.schemaVersion) {
            close();
            U.toast("This file is a full CRM backup — opening the restore flow instead.", "info");
            App.handleRestoreFile(file);
            return;
          }
          let list = null;
          if (Array.isArray(parsed)) list = parsed;
          else if (Array.isArray(parsed.investors)) list = parsed.investors;
          else if (Array.isArray(parsed.companies)) list = parsed.companies;
          if (!list || list.length === 0) throw new Error("JSON does not look like an investor list (expected an array or {investors:[…]}).");
          const keys = [];
          list.forEach(function (o) {
            if (o && typeof o === "object") Object.keys(o).forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); });
          });
          wiz.headers = keys;
          wiz.rows = list.map(function (o) { return keys.map(function (k) { return o && o[k] !== undefined && o[k] !== null ? String(o[k]) : ""; }); });
        } else {
          const rows = U.parseCsv(text);
          if (rows.length < 2) throw new Error("CSV file seems empty (need a header row plus data).");
          wiz.headers = rows[0].map(function (h, i) { return String(h || ("col" + i)).trim(); });
          wiz.rows = rows.slice(1);
        }
        wiz.mapping = {};
        IMPORT_FIELDS.forEach(function (f) { wiz.mapping[f.key] = guessColumn(wiz.headers, f.guess); });
        wiz.step = 2;
        reRender();
        } catch (e) {
          showError(e && e.message ? e.message : String(e));
        }
      };
      reader.readAsText(file);
    }

    function onSubmit(data) {
      if (wiz.step === 1) {
        if (!wiz.rows.length) throw new Error("Choose a file first.");
        wiz.step = 2; reRender(); return;
      }
      if (wiz.step === 2) {
        if (wiz.mapping.name === undefined || wiz.mapping.name < 0) throw new Error("Map the investor name column (required).");
        wiz.step = 3; reRender(); return;
      }
      if (wiz.step === 3) {
        if (ctx.requireChoice && !wiz.destination) throw new Error("Choose a destination project, or Directory only.");
        wiz.destination = String(data.destination || "");
        wiz.useProjectColumn = data.useProjectColumn === "on";
        wiz.plan = { merges: {} };
        buildPlan();
        wiz.step = 4; reRender(); return;
      }
      if (wiz.step === 4) {
        buildPlan();
        wiz.step = 5; reRender(); return;
      }
      buildPlan();
      const plan = { rows: wiz.plan.rows, summary: wiz.plan.summary, destination: wiz.destination, fileName: wiz.fileName };
      close();
      App.applyImportPlan(plan);
    }

    reRender();
    if (ctx.file) handleFile(ctx.file);
  }

  return {
    open: open,
    close: close,
    isOpen: isOpen,
    handleSubmit: handleSubmit,
    setSubmitLabel: setSubmitLabel,
    investorModal: investorModal,
    contactModal: contactModal,
    activityModal: activityModal,
    recordOutreachModal: recordOutreachModal,
    activityEditModal: activityEditModal,
    engagementModal: engagementModal,
    engagementPickerModal: engagementPickerModal,
    taskModal: taskModal,
    projectModal: projectModal,
    agreementModal: agreementModal,
    stageChangeModal: stageChangeModal,
    milestonesModal: milestonesModal,
    templatesApplyModal: templatesApplyModal,
    templatesManageModal: templatesManageModal,
    assignProjectsModal: assignProjectsModal,
    importWizardModal: importWizardModal
  };
})();
