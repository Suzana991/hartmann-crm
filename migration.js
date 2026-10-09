(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.CRM_MIGRATION = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SCHEMA_VERSION = 3;
  var MAX_STATE_CHARS = 600000;
  var VALID_STAGES = [
    "not_contacted", "awaiting_response", "in_discussion", "reviewing_materials",
    "due_diligence", "committed", "funded", "declined", "on_hold"
  ];
  var DELIVERY_STAGES = [
    "onboarding", "engagement_agreement", "due_diligence", "materials_preparation",
    "investor_outreach", "negotiation_structuring", "closing", "post_closing"
  ];
  var PROJECT_STATES = ["active", "on_hold", "archived"];
  var AGREEMENT_STATUSES = ["not_started", "drafting", "sent", "signed", "declined"];
  var ACTIVITY_KINDS = ["outreach", "reply", "materials", "note", "appointment"];
  var OUTREACH_TYPES = ["Email", "Call", "Meeting", "Message", "Other outreach"];
  var TASK_KINDS = ["task", "appointment"];
  var TASK_STATUS_MAP = { "Pending": "To do", "Ongoing": "In progress", "Completed": "Completed" };
  var KNOWN_TASK_STATUSES = ["To do", "In progress", "Waiting", "Completed"];

  function defaultAgreement() {
    return { status: "not_started", sentDate: "", sentBy: "", signedDate: "", docLink: "", notes: "", history: [] };
  }

  function defaultTaskTemplates() {
    function t(stage, title) {
      return { id: stage + "_" + title.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40), stage: stage, title: title, enabled: true };
    }
    return [
      t("onboarding", "Collect project information"),
      t("onboarding", "Confirm funding request"),
      t("onboarding", "Identify missing information"),
      t("engagement_agreement", "Prepare agreement"),
      t("engagement_agreement", "Record sent"),
      t("engagement_agreement", "Follow up on agreement"),
      t("engagement_agreement", "Record signature"),
      t("due_diligence", "Collect documents"),
      t("due_diligence", "Review financial model"),
      t("due_diligence", "Resolve open questions"),
      t("materials_preparation", "Draft teaser"),
      t("materials_preparation", "Prepare investment presentation"),
      t("materials_preparation", "Review data room"),
      t("investor_outreach", "Build target list"),
      t("investor_outreach", "Assign outreach"),
      t("investor_outreach", "Distribute materials"),
      t("investor_outreach", "Schedule follow-ups"),
      t("negotiation_structuring", "Compare proposals"),
      t("negotiation_structuring", "Track outstanding conditions"),
      t("negotiation_structuring", "Coordinate next discussions"),
      t("closing", "Track documents"),
      t("closing", "Monitor conditions"),
      t("closing", "Confirm completion")
    ];
  }

  function makeError(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  function str(v) {
    if (v === null || v === undefined) return "";
    return typeof v === "string" ? v : String(v);
  }

  function truthy(v) {
    return v === true || v === "true" || v === "True" || v === "yes" || v === "Yes" || v === 1;
  }

  function normName(s) {
    return str(s).trim().toLowerCase().replace(/\s+/g, " ");
  }

  function normEmail(s) {
    return str(s).trim().toLowerCase();
  }

  function isValidEmail(s) {
    var v = str(s).trim();
    if (!v) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  function defaultId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function detectVersion(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw makeError("unrecognized-data", "Data file is not a CRM object and cannot be read.");
    }
    if (typeof payload.schemaVersion === "number") return payload.schemaVersion;
    if (Array.isArray(payload.projects)) return 1;
    throw makeError("unrecognized-data", "Unrecognized data format: no schemaVersion and no legacy projects array.");
  }

  function deriveStage(legacy) {
    var flags = [];
    var reached = truthy(legacy.reachedOut);
    var date = str(legacy.dateReachedOut).trim();
    var resp = str(legacy.response).trim();
    var mf = str(legacy.movingForward).trim();
    if (!reached) {
      if (date) flags.push("inconsistent-outreach: date recorded but reachedOut is false — verify which field is correct");
      return { stage: "not_contacted", flags: flags };
    }
    if (mf === "On hold") return { stage: "on_hold", flags: flags };
    if (mf === "No") {
      flags.push("stage-derived: movingForward=No mapped to declined — verify");
      return { stage: "declined", flags: flags };
    }
    if (mf === "Yes") return { stage: "in_discussion", flags: flags };
    if (resp === "Yes") return { stage: "in_discussion", flags: flags };
    if (resp === "Follow up") return { stage: "in_discussion", flags: flags };
    if (resp === "No") {
      flags.push("stage-derived: response=No is ambiguous (no reply vs decline) — mapped to awaiting_response, verify");
      return { stage: "awaiting_response", flags: flags };
    }
    if (resp === "" || resp === "Pending") return { stage: "awaiting_response", flags: flags };
    flags.push("stage-derived: unrecognized response value '" + resp + "' — verify");
    return { stage: "awaiting_response", flags: flags };
  }

  function mapTaskStatus(status) {
    var s = str(status).trim();
    if (TASK_STATUS_MAP[s]) return { status: TASK_STATUS_MAP[s], flag: null };
    if (KNOWN_TASK_STATUSES.indexOf(s) !== -1) return { status: s, flag: null };
    if (!s) return { status: "To do", flag: null };
    return { status: "To do", flag: "task-status-unmapped: legacy status '" + s + "' mapped to 'To do' — verify" };
  }

  function migrateLegacy(payload, idFactory, now) {
    var source = JSON.parse(JSON.stringify(payload));
    var report = {
      schemaVersion: SCHEMA_VERSION,
      migratedAt: now,
      sourceSchemaVersion: 1,
      sourceCounts: { projects: 0, institutions: 0, contacts: 0, tasks: 0 },
      counts: { investors: 0, projects: 0, engagements: 0, contacts: 0, activities: 0, tasks: 0, reviewFlags: 0 },
      mapping: [],
      flags: []
    };
    var state = {
      schemaVersion: SCHEMA_VERSION,
      investors: [],
      projects: [],
      activities: [],
      tasks: [],
      activeProjectId: null,
      migrationReport: report,
      legacyBackup: source
    };
    var investorByName = new Map();
    var usedInvestorIds = new Set();

    var srcProjects = Array.isArray(source.projects) ? source.projects : [];
    report.sourceCounts.projects = srcProjects.length;

    srcProjects.forEach(function (srcProject) {
      var project = {
        id: str(srcProject.id) || idFactory(),
        name: str(srcProject.name).trim() || "Untitled project",
        archived: false,
        engagements: []
      };
      state.projects.push(project);

      var srcInsts = Array.isArray(srcProject.institutions) ? srcProject.institutions : [];
      srcInsts.forEach(function (inst) {
        report.sourceCounts.institutions += 1;
        var key = normName(inst.companyName);
        var investor = investorByName.get(key);
        if (!investor) {
          var invId = str(inst.id) || idFactory();
          if (usedInvestorIds.has(invId)) invId = idFactory();
          usedInvestorIds.add(invId);
          investor = {
            id: invId,
            name: str(inst.companyName),
            type: str(inst.companyType),
            website: "",
            location: "",
            preferences: "",
            notes: "",
            archived: false,
            contacts: []
          };
          investorByName.set(key, investor);
          state.investors.push(investor);
        } else if (!investor.type && str(inst.companyType)) {
          investor.type = str(inst.companyType);
        }

        var srcContacts = Array.isArray(inst.contacts) ? inst.contacts : [];
        var mappingContacts = [];
        srcContacts.forEach(function (srcC, idx) {
          report.sourceCounts.contacts += 1;
          var flags = [];
          var email = str(srcC.email);
          if (email && !isValidEmail(email)) flags.push("invalid-email-format");
          var contact = {
            id: idFactory(),
            name: str(srcC.name),
            title: str(srcC.title),
            email: email,
            phone: str(srcC.phone),
            notes: str(srcC.notes),
            isPrimary: false,
            reviewFlags: flags
          };
          investor.contacts.push(contact);
          mappingContacts.push({
            sourceIndex: idx,
            sourceName: contact.name,
            sourceEmail: contact.email,
            contactId: contact.id
          });
        });

        var legacy = {
          reachedOut: inst.reachedOut === undefined ? false : inst.reachedOut,
          whoReachedOut: str(inst.whoReachedOut),
          dateReachedOut: str(inst.dateReachedOut),
          response: str(inst.response),
          movingForward: str(inst.movingForward),
          nextSteps: str(inst.nextSteps)
        };
        var derived = deriveStage(legacy);
        var engagement = {
          id: idFactory(),
          investorId: investor.id,
          stage: derived.stage,
          priority: str(inst.importance),
          owner: legacy.whoReachedOut,
          contactIds: [],
          notes: "",
          archived: false,
          legacy: legacy,
          reviewFlags: derived.flags.slice()
        };
        project.engagements.push(engagement);

        var mappingEntry = {
          source: {
            projectId: project.id,
            projectName: project.name,
            institutionId: str(inst.id),
            institutionName: str(inst.companyName)
          },
          investorId: investor.id,
          engagementId: engagement.id,
          contacts: mappingContacts,
          outreachActivityId: null,
          nextStepsTaskId: null
        };

        var reached = truthy(legacy.reachedOut);
        var date = str(legacy.dateReachedOut).trim();
        var inconsistent = !!date && !reached;
        if (reached && !inconsistent) {
          var activity = {
            id: idFactory(),
            engagementId: engagement.id,
            date: date || null,
            undated: !date,
            type: "Outreach",
            contactId: null,
            teamMember: legacy.whoReachedOut,
            summary: "Initial outreach (migrated from legacy record)",
            legacy: true,
            createdAt: now
          };
          state.activities.push(activity);
          mappingEntry.outreachActivityId = activity.id;
        }

        var nextSteps = str(legacy.nextSteps).trim();
        if (nextSteps) {
          var followTask = {
            id: idFactory(),
            title: nextSteps,
            owner: "",
            dueDate: "",
            status: "To do",
            priority: "",
            notes: "",
            projectId: project.id,
            engagementId: engagement.id,
            contactId: null,
            legacy: true,
            source: "legacy-nextSteps",
            reviewFlags: []
          };
          state.tasks.push(followTask);
          mappingEntry.nextStepsTaskId = followTask.id;
        }

        report.mapping.push(mappingEntry);
      });

      var srcTasks = Array.isArray(srcProject.tasks) ? srcProject.tasks : [];
      srcTasks.forEach(function (t) {
        report.sourceCounts.tasks += 1;
        var mapped = mapTaskStatus(t.status);
        var flags = mapped.flag ? [mapped.flag] : [];
        state.tasks.push({
          id: str(t.id) || idFactory(),
          title: str(t.title),
          owner: "",
          dueDate: "",
          status: mapped.status,
          priority: "",
          notes: "",
          projectId: project.id,
          engagementId: null,
          contactId: null,
          legacy: true,
          source: "legacy-task",
          reviewFlags: flags
        });
      });
    });

    detectContactDuplicates(state.investors, report);

    var projectIds = new Set(state.projects.map(function (p) { return p.id; }));
    var srcActive = str(source.activeProjectId);
    state.activeProjectId = projectIds.has(srcActive)
      ? srcActive
      : (state.projects.length ? state.projects[0].id : null);

    report.counts.investors = state.investors.length;
    report.counts.projects = state.projects.length;
    report.counts.engagements = state.projects.reduce(function (n, p) { return n + p.engagements.length; }, 0);
    report.counts.contacts = state.investors.reduce(function (n, i) { return n + i.contacts.length; }, 0);
    report.counts.activities = state.activities.length;
    report.counts.tasks = state.tasks.length;
    report.counts.reviewFlags =
      state.projects.reduce(function (n, p) {
        return n + p.engagements.reduce(function (m, e) { return m + e.reviewFlags.length; }, 0);
      }, 0) +
      state.investors.reduce(function (n, i) {
        return n + i.contacts.reduce(function (m, c) { return m + (c.reviewFlags || []).length; }, 0);
      }, 0) +
      state.tasks.reduce(function (n, t) { return n + (t.reviewFlags || []).length; }, 0);

    return { state: state, report: report };
  }

  function detectContactDuplicates(investors, report) {
    investors.forEach(function (inv) {
      var byEmail = new Map();
      inv.contacts.forEach(function (c) {
        var e = normEmail(c.email);
        if (!e || !isValidEmail(e)) return;
        if (!byEmail.has(e)) byEmail.set(e, []);
        byEmail.get(e).push(c);
      });
      byEmail.forEach(function (group, email) {
        if (group.length < 2) return;
        var ids = group.map(function (c) { return c.id; });
        group.forEach(function (c) {
          c.reviewFlags = (c.reviewFlags || []).concat(["possible-duplicate-email: same address as another contact — verify before merging"]);
        });
        report.flags.push({ type: "possible-duplicate-contacts", investorId: inv.id, email: email, contactIds: ids });
      });
    });
  }

  function validateV2(state) {
    function fail(msg) { throw makeError("invalid-data", "Invalid CRM data: " + msg); }
    if (!state || typeof state !== "object" || Array.isArray(state)) fail("root must be an object");
    if (state.schemaVersion !== 2) fail("schemaVersion must be 2");
    ["investors", "projects", "activities", "tasks"].forEach(function (k) {
      if (!Array.isArray(state[k])) fail(k + " must be an array");
    });
    var size = JSON.stringify(state).length;
    if (size > MAX_STATE_CHARS) fail("payload too large (" + size + " chars, limit " + MAX_STATE_CHARS + ")");

    var investorIds = new Set();
    var contactIds = new Set();
    state.investors.forEach(function (inv) {
      if (!inv || typeof inv !== "object") fail("investor entry is not an object");
      if (!inv.id || typeof inv.id !== "string") fail("investor missing string id");
      if (investorIds.has(inv.id)) fail("duplicate investor id '" + inv.id + "'");
      investorIds.add(inv.id);
      if (typeof inv.name !== "string") fail("investor '" + inv.id + "' name must be a string");
      if (!Array.isArray(inv.contacts)) fail("investor '" + inv.id + "' contacts must be an array");
      inv.contacts.forEach(function (c) {
        if (!c || typeof c !== "object") fail("contact entry is not an object");
        if (!c.id || typeof c.id !== "string") fail("contact missing string id");
        if (contactIds.has(c.id)) fail("duplicate contact id '" + c.id + "'");
        contactIds.add(c.id);
        if (typeof c.name !== "string" || typeof c.email !== "string") fail("contact '" + c.id + "' name/email must be strings");
      });
    });

    var engagementIds = new Set();
    var projectIds = new Set();
    state.projects.forEach(function (p) {
      if (!p || typeof p !== "object") fail("project entry is not an object");
      if (!p.id || typeof p.id !== "string") fail("project missing string id");
      if (projectIds.has(p.id)) fail("duplicate project id '" + p.id + "'");
      projectIds.add(p.id);
      if (typeof p.name !== "string") fail("project '" + p.id + "' name must be a string");
      if (!Array.isArray(p.engagements)) fail("project '" + p.id + "' engagements must be an array");
      p.engagements.forEach(function (e) {
        if (!e || typeof e !== "object") fail("engagement entry is not an object");
        if (!e.id || typeof e.id !== "string") fail("engagement missing string id");
        if (engagementIds.has(e.id)) fail("duplicate engagement id '" + e.id + "'");
        engagementIds.add(e.id);
        if (!investorIds.has(e.investorId)) fail("engagement '" + e.id + "' references unknown investor '" + e.investorId + "'");
        if (VALID_STAGES.indexOf(e.stage) === -1) fail("engagement '" + e.id + "' has unknown stage '" + e.stage + "'");
        if (!Array.isArray(e.contactIds)) fail("engagement '" + e.id + "' contactIds must be an array");
        e.contactIds.forEach(function (cid) {
          if (!contactIds.has(cid)) fail("engagement '" + e.id + "' references unknown contact '" + cid + "'");
        });
      });
    });

    state.activities.forEach(function (a) {
      if (!a || typeof a !== "object") fail("activity entry is not an object");
      if (!a.id || typeof a.id !== "string") fail("activity missing string id");
      if (!engagementIds.has(a.engagementId)) fail("activity '" + a.id + "' references unknown engagement '" + a.engagementId + "'");
      if (a.contactId !== null && a.contactId !== undefined && !contactIds.has(a.contactId)) fail("activity '" + a.id + "' references unknown contact '" + a.contactId + "'");
      if (!(a.date === null || typeof a.date === "string")) fail("activity '" + a.id + "' date must be string or null");
    });

    var taskIds = new Set();
    state.tasks.forEach(function (t) {
      if (!t || typeof t !== "object") fail("task entry is not an object");
      if (!t.id || typeof t.id !== "string") fail("task missing string id");
      if (taskIds.has(t.id)) fail("duplicate task id '" + t.id + "'");
      taskIds.add(t.id);
      if (typeof t.title !== "string") fail("task '" + t.id + "' title must be a string");
      if (t.projectId && !projectIds.has(t.projectId)) fail("task '" + t.id + "' references unknown project '" + t.projectId + "'");
      if (t.engagementId && !engagementIds.has(t.engagementId)) fail("task '" + t.id + "' references unknown engagement '" + t.engagementId + "'");
      if (t.contactId && !contactIds.has(t.contactId)) fail("task '" + t.id + "' references unknown contact '" + t.contactId + "'");
      if (KNOWN_TASK_STATUSES.indexOf(t.status) === -1) fail("task '" + t.id + "' has unknown status '" + t.status + "'");
    });

    if (state.activeProjectId && !projectIds.has(state.activeProjectId)) fail("activeProjectId references unknown project '" + state.activeProjectId + "'");
    return true;
  }

  function activityKindFromType(type) {
    var t = str(type);
    if (t === "Email" || t === "Call" || t === "Meeting" || t === "Message" || t === "Other outreach" || t === "Outreach") return "outreach";
    if (t === "Reply received") return "reply";
    if (t === "Materials sent") return "materials";
    return "note";
  }

  function upgradeToV3(state) {
    state.projects.forEach(function (p) {
      if (PROJECT_STATES.indexOf(p.state) === -1) p.state = p.archived ? "archived" : "active";
      if (p.state === "archived") p.archived = true;
      if (DELIVERY_STAGES.indexOf(p.deliveryStage) === -1) p.deliveryStage = null;
      if (typeof p.lead !== "string") p.lead = "";
      if (!Array.isArray(p.milestones)) p.milestones = [];
      p.milestones = p.milestones.filter(function (m) { return m && typeof m === "object"; }).map(function (m) {
        return { id: str(m.id) || defaultId(), label: str(m.label), date: str(m.date) };
      });
      if (!p.stageNotes || typeof p.stageNotes !== "object" || Array.isArray(p.stageNotes)) p.stageNotes = {};
      if (!Array.isArray(p.stageHistory)) p.stageHistory = [];
      var ag = (p.agreement && typeof p.agreement === "object") ? p.agreement : {};
      var upgraded = defaultAgreement();
      if (AGREEMENT_STATUSES.indexOf(ag.status) !== -1) upgraded.status = ag.status;
      upgraded.sentDate = str(ag.sentDate);
      upgraded.sentBy = str(ag.sentBy);
      upgraded.signedDate = str(ag.signedDate);
      upgraded.docLink = str(ag.docLink);
      upgraded.notes = str(ag.notes);
      upgraded.history = Array.isArray(ag.history) ? ag.history : [];
      p.agreement = upgraded;
    });
    state.activities.forEach(function (a) {
      if (ACTIVITY_KINDS.indexOf(a.kind) === -1) a.kind = activityKindFromType(a.type);
      if (typeof a.outreachType !== "string") a.outreachType = "";
      if (a.kind === "outreach" && !a.outreachType && OUTREACH_TYPES.indexOf(str(a.type)) !== -1) a.outreachType = str(a.type);
    });
    state.tasks.forEach(function (t) {
      if (DELIVERY_STAGES.indexOf(t.stage) === -1) t.stage = "";
      if (typeof t.waitingReason !== "string") t.waitingReason = "";
      if (TASK_KINDS.indexOf(t.kind) === -1) t.kind = "task";
      if (typeof t.templateKey !== "string") t.templateKey = "";
    });
    if (!Array.isArray(state.taskTemplates)) state.taskTemplates = defaultTaskTemplates();
    state.schemaVersion = 3;
    return state;
  }

  function validateV3(state) {
    function fail(msg) { throw makeError("invalid-data", "Invalid CRM data: " + msg); }
    if (!state || typeof state !== "object" || Array.isArray(state)) fail("root must be an object");
    if (state.schemaVersion !== SCHEMA_VERSION) fail("schemaVersion must be " + SCHEMA_VERSION);
    ["investors", "projects", "activities", "tasks"].forEach(function (k) {
      if (!Array.isArray(state[k])) fail(k + " must be an array");
    });
    if (state.taskTemplates !== undefined && !Array.isArray(state.taskTemplates)) fail("taskTemplates must be an array");
    var size = JSON.stringify(state).length;
    if (size > MAX_STATE_CHARS) fail("payload too large (" + size + " chars, limit " + MAX_STATE_CHARS + ")");

    var investorIds = new Set();
    var contactIds = new Set();
    state.investors.forEach(function (inv) {
      if (!inv || typeof inv !== "object") fail("investor entry is not an object");
      if (!inv.id || typeof inv.id !== "string") fail("investor missing string id");
      if (investorIds.has(inv.id)) fail("duplicate investor id '" + inv.id + "'");
      investorIds.add(inv.id);
      if (typeof inv.name !== "string") fail("investor '" + inv.id + "' name must be a string");
      if (!Array.isArray(inv.contacts)) fail("investor '" + inv.id + "' contacts must be an array");
      inv.contacts.forEach(function (c) {
        if (!c || typeof c !== "object") fail("contact entry is not an object");
        if (!c.id || typeof c.id !== "string") fail("contact missing string id");
        if (contactIds.has(c.id)) fail("duplicate contact id '" + c.id + "'");
        contactIds.add(c.id);
        if (typeof c.name !== "string" || typeof c.email !== "string") fail("contact '" + c.id + "' name/email must be strings");
      });
    });

    var engagementIds = new Set();
    var projectIds = new Set();
    state.projects.forEach(function (p) {
      if (!p || typeof p !== "object") fail("project entry is not an object");
      if (!p.id || typeof p.id !== "string") fail("project missing string id");
      if (projectIds.has(p.id)) fail("duplicate project id '" + p.id + "'");
      projectIds.add(p.id);
      if (typeof p.name !== "string") fail("project '" + p.id + "' name must be a string");
      if (PROJECT_STATES.indexOf(p.state) === -1) fail("project '" + p.id + "' has unknown state '" + p.state + "'");
      if (p.deliveryStage !== null && DELIVERY_STAGES.indexOf(p.deliveryStage) === -1) fail("project '" + p.id + "' has unknown delivery stage '" + p.deliveryStage + "'");
      if (typeof p.lead !== "string" || ["", "Suzana", "Bruno"].indexOf(p.lead) === -1) fail("project '" + p.id + "' lead must be '', 'Suzana' or 'Bruno'");
      if (!Array.isArray(p.milestones)) fail("project '" + p.id + "' milestones must be an array");
      if (!p.stageNotes || typeof p.stageNotes !== "object") fail("project '" + p.id + "' stageNotes must be an object");
      if (!Array.isArray(p.stageHistory)) fail("project '" + p.id + "' stageHistory must be an array");
      if (!p.agreement || typeof p.agreement !== "object") fail("project '" + p.id + "' agreement must be an object");
      if (AGREEMENT_STATUSES.indexOf(p.agreement.status) === -1) fail("project '" + p.id + "' agreement has unknown status '" + p.agreement.status + "'");
      if (!Array.isArray(p.engagements)) fail("project '" + p.id + "' engagements must be an array");
      p.engagements.forEach(function (e) {
        if (!e || typeof e !== "object") fail("engagement entry is not an object");
        if (!e.id || typeof e.id !== "string") fail("engagement missing string id");
        if (engagementIds.has(e.id)) fail("duplicate engagement id '" + e.id + "'");
        engagementIds.add(e.id);
        if (!investorIds.has(e.investorId)) fail("engagement '" + e.id + "' references unknown investor '" + e.investorId + "'");
        if (VALID_STAGES.indexOf(e.stage) === -1) fail("engagement '" + e.id + "' has unknown stage '" + e.stage + "'");
        if (!Array.isArray(e.contactIds)) fail("engagement '" + e.id + "' contactIds must be an array");
        e.contactIds.forEach(function (cid) {
          if (!contactIds.has(cid)) fail("engagement '" + e.id + "' references unknown contact '" + cid + "'");
        });
      });
    });

    state.activities.forEach(function (a) {
      if (!a || typeof a !== "object") fail("activity entry is not an object");
      if (!a.id || typeof a.id !== "string") fail("activity missing string id");
      if (!engagementIds.has(a.engagementId)) fail("activity '" + a.id + "' references unknown engagement '" + a.engagementId + "'");
      if (a.contactId !== null && a.contactId !== undefined && !contactIds.has(a.contactId)) fail("activity '" + a.id + "' references unknown contact '" + a.contactId + "'");
      if (!(a.date === null || typeof a.date === "string")) fail("activity '" + a.id + "' date must be string or null");
      if (ACTIVITY_KINDS.indexOf(a.kind) === -1) fail("activity '" + a.id + "' has unknown kind '" + a.kind + "'");
      if (a.kind === "outreach" && a.outreachType && OUTREACH_TYPES.indexOf(a.outreachType) === -1) fail("activity '" + a.id + "' has unknown outreach type '" + a.outreachType + "'");
    });

    var taskIds = new Set();
    state.tasks.forEach(function (t) {
      if (!t || typeof t !== "object") fail("task entry is not an object");
      if (!t.id || typeof t.id !== "string") fail("task missing string id");
      if (taskIds.has(t.id)) fail("duplicate task id '" + t.id + "'");
      taskIds.add(t.id);
      if (typeof t.title !== "string") fail("task '" + t.id + "' title must be a string");
      if (t.projectId && !projectIds.has(t.projectId)) fail("task '" + t.id + "' references unknown project '" + t.projectId + "'");
      if (t.engagementId && !engagementIds.has(t.engagementId)) fail("task '" + t.id + "' references unknown engagement '" + t.engagementId + "'");
      if (t.contactId && !contactIds.has(t.contactId)) fail("task '" + t.id + "' references unknown contact '" + t.contactId + "'");
      if (KNOWN_TASK_STATUSES.indexOf(t.status) === -1) fail("task '" + t.id + "' has unknown status '" + t.status + "'");
      if (t.stage !== undefined && t.stage !== "" && DELIVERY_STAGES.indexOf(t.stage) === -1) fail("task '" + t.id + "' has unknown delivery stage '" + t.stage + "'");
      if (t.kind !== undefined && TASK_KINDS.indexOf(t.kind) === -1) fail("task '" + t.id + "' has unknown kind '" + t.kind + "'");
    });

    if (state.taskTemplates) {
      state.taskTemplates.forEach(function (tpl) {
        if (!tpl || typeof tpl !== "object") fail("task template entry is not an object");
        if (typeof tpl.title !== "string" || !tpl.title) fail("task template needs a title");
        if (DELIVERY_STAGES.indexOf(tpl.stage) === -1) fail("task template has unknown stage '" + tpl.stage + "'");
      });
    }

    if (state.activeProjectId && !projectIds.has(state.activeProjectId)) fail("activeProjectId references unknown project '" + state.activeProjectId + "'");
    return true;
  }

  function migrate(payload, opts) {
    opts = opts || {};
    var idFactory = opts.idFactory || defaultId;
    var now = opts.now || new Date().toISOString();
    var version = detectVersion(payload);
    if (version > SCHEMA_VERSION) {
      throw makeError("unsupported-version",
        "This data was created by a newer version of the CRM (schema v" + version + "). " +
        "This build supports up to v" + SCHEMA_VERSION + ". Update the application before opening this data.");
    }
    if (version === SCHEMA_VERSION) {
      validateV3(payload);
      return { state: payload, report: payload.migrationReport || null, alreadyMigrated: true, fromVersion: SCHEMA_VERSION };
    }
    if (version === 2) {
      validateV2(payload);
      var upgraded = upgradeToV3(payload);
      validateV3(upgraded);
      return { state: upgraded, report: upgraded.migrationReport || null, alreadyMigrated: false, fromVersion: 2 };
    }
    var result = migrateLegacy(payload, idFactory, now);
    upgradeToV3(result.state);
    validateV3(result.state);
    return { state: result.state, report: result.report, alreadyMigrated: false, fromVersion: 1 };
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    MAX_STATE_CHARS: MAX_STATE_CHARS,
    VALID_STAGES: VALID_STAGES,
    DELIVERY_STAGES: DELIVERY_STAGES,
    PROJECT_STATES: PROJECT_STATES,
    AGREEMENT_STATUSES: AGREEMENT_STATUSES,
    ACTIVITY_KINDS: ACTIVITY_KINDS,
    OUTREACH_TYPES: OUTREACH_TYPES,
    KNOWN_TASK_STATUSES: KNOWN_TASK_STATUSES,
    detectVersion: detectVersion,
    deriveStage: deriveStage,
    mapTaskStatus: mapTaskStatus,
    defaultAgreement: defaultAgreement,
    defaultTaskTemplates: defaultTaskTemplates,
    upgradeToV3: upgradeToV3,
    validateV2: validateV2,
    validateV3: validateV3,
    migrate: migrate
  };
});
