window.Modals = (function () {
  "use strict";

  let submitCallback = null;

  function backdrop() { return document.getElementById("modal-backdrop"); }

  function open(title, bodyHtml, onSubmit, submitLabel) {
    document.getElementById("modal-title").textContent = title;
    document.getElementById("modal-body").innerHTML = bodyHtml;
    document.getElementById("modal-submit").textContent = submitLabel || "Save";
    submitCallback = onSubmit;
    backdrop().classList.remove("hidden");
    const first = document.querySelector("#modal-body input:not([type=hidden]), #modal-body select, #modal-body textarea");
    if (first) {
      try { first.focus(); } catch (e) { }
    }
  }

  function close() {
    backdrop().classList.add("hidden");
    submitCallback = null;
    document.getElementById("modal-body").innerHTML = "";
  }

  function isOpen() {
    return !backdrop().classList.contains("hidden");
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!submitCallback) return;
    const form = document.getElementById("modal-form");
    const data = Object.fromEntries(new FormData(form).entries());
    submitCallback(data, form);
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
        name: String(data.name || "").trim(),
        type: String(data.type || "").trim(),
        website: String(data.website || "").trim(),
        location: String(data.location || "").trim(),
        preferences: String(data.preferences || "").trim(),
        notes: String(data.notes || "").trim()
      };
      if (!result.name) return;
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
      if (!result.name && !result.title && !result.email) return;
      close();
      App.commitContact(investor.id, editing ? contact.id : null, result);
    });
  }

  function activityModal(state, engagementId, preset) {
    preset = preset || {};
    const found = Views.findEngagement(state, engagementId);
    if (!found) return;
    const inv = Views.investorById(state, found.engagement.investorId);
    const contactOptions = [{ value: "", label: "— none —" }].concat(
      (inv ? inv.contacts : []).map(function (c) {
        const d = U.contactDisplay(c);
        return { value: c.id, label: d.primary + (d.secondary ? " (" + d.secondary + ")" : "") };
      })
    );
    const body =
      field("Date", "date", preset.date !== undefined ? preset.date : U.todayISO(), { type: "date", help: "Leave empty only for undated historical records" }) +
      select("Type", "type", U.ACTIVITY_TYPES.map(function (t) { return { value: t, label: t }; }), { value: preset.type || "Email" }) +
      select("Contact", "contactId", contactOptions, { value: "", help: "Person this activity involved (optional)" }) +
      select("Team member", "teamMember", [{ value: "", label: "— unknown —" }].concat(U.TEAM.map(function (t) { return { value: t, label: t }; })), { value: preset.teamMember || "" }) +
      textarea("Summary", "summary", "", { placeholder: "What happened? e.g. Sent deck, brief call with…" , required: true }) +
      '<div class="modal-divider"><span>Optional</span></div>' +
      checkbox("Change engagement stage", "doStage", false) +
      select("New stage", "stage", U.STAGES.map(function (s) { return { value: s.id, label: s.label }; }), { value: found.engagement.stage }) +
      checkbox("Schedule follow-up task", "doFollow", false) +
      field("Follow-up title", "followTitle", "Follow up with " + (inv ? inv.name : ""), { placeholder: "e.g. Send updated deck" }) +
      field("Follow-up due date", "followDue", "", { type: "date" }) +
      select("Follow-up owner", "followOwner", [{ value: "", label: "— unset —" }].concat(U.TEAM.map(function (t) { return { value: t, label: t }; })), { value: preset.teamMember || "" });
    open("Log activity — " + (found.project.name + " · " + (inv ? inv.name : "")), body, function (data) {
      const summary = String(data.summary || "").trim();
      if (!summary) return;
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
    }, "Log activity");
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
      select("Stage", "stage", U.STAGES.map(function (s) { return { value: s.id, label: s.label }; }), { value: "not_contacted" }) +
      select("Priority", "priority", [{ value: "", label: "— unset —" }].concat(U.PRIORITIES.map(function (p) { return { value: p, label: p }; })), { value: "" }) +
      select("Owner", "owner", [{ value: "", label: "— unset —" }].concat(U.TEAM.map(function (t) { return { value: t, label: t }; })), { value: "" });
    open(investorId ? "Add to project" : "Add engagement", body, function (data) {
      const chosenInvestor = investorId || data.investorId;
      if (!chosenInvestor || !data.projectId) return;
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

  function taskModal(state, task, defaults) {
    defaults = defaults || {};
    const editing = !!task;
    const t = task || {
      title: "", owner: "", dueDate: "", status: "To do", priority: "",
      notes: "", projectId: defaults.projectId || state.activeProjectId || "",
      engagementId: defaults.engagementId || "", contactId: ""
    };
    const projectOptions = [{ value: "", label: "— none —" }].concat(
      state.projects.filter(function (p) { return !p.archived; }).map(function (p) { return { value: p.id, label: p.name }; })
    );
    const body =
      field("Task", "title", t.title, { required: true, placeholder: "e.g. Send deck to Banca Ifis", wide: true }) +
      select("Status", "status", U.TASK_STATUSES.map(function (s) { return { value: s, label: s }; }), { value: t.status }) +
      select("Owner", "owner", [{ value: "", label: "— unset —" }].concat(U.TEAM.map(function (x) { return { value: x, label: x }; })), { value: t.owner }) +
      field("Due date", "dueDate", t.dueDate, { type: "date" }) +
      select("Priority", "priority", [{ value: "", label: "— unset —" }].concat(U.PRIORITIES.map(function (p) { return { value: p, label: p }; })), { value: t.priority }) +
      select("Project", "projectId", projectOptions, { value: t.projectId }) +
      select("Engagement", "engagementId", [{ value: "", label: "— none —" }], { value: t.engagementId }) +
      select("Contact", "contactId", [{ value: "", label: "— none —" }], { value: t.contactId }) +
      textarea("Notes", "notes", t.notes, { placeholder: "Optional details" });
    open(editing ? "Edit task" : "Add task", body, function (data) {
      const title = String(data.title || "").trim();
      if (!title) return;
      close();
      App.commitTask(editing ? task.id : null, {
        title: title,
        status: String(data.status || "To do"),
        owner: String(data.owner || ""),
        dueDate: data.dueDate ? String(data.dueDate) : "",
        priority: String(data.priority || ""),
        notes: String(data.notes || "").trim(),
        projectId: String(data.projectId || ""),
        engagementId: String(data.engagementId || ""),
        contactId: String(data.contactId || "")
      });
    });
    wireLinkage(state, { engagementId: t.engagementId, contactId: t.contactId });
  }

  function wireLinkage(state, initial) {
    initial = initial || {};
    const form = document.getElementById("modal-form");
    const projectSel = form.querySelector('[name="projectId"]');
    const engSel = form.querySelector('[name="engagementId"]');
    const contactSel = form.querySelector('[name="contactId"]');
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
      const name = String(data.name || "").trim();
      if (!name) return;
      close();
      App.commitProject(editing ? project.id : null, name);
    });
  }

  return {
    open: open,
    close: close,
    isOpen: isOpen,
    handleSubmit: handleSubmit,
    investorModal: investorModal,
    contactModal: contactModal,
    activityModal: activityModal,
    engagementModal: engagementModal,
    taskModal: taskModal,
    projectModal: projectModal
  };
})();
