(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.CRM_MIGRATION = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SCHEMA_VERSION = 2;
  var MAX_STATE_CHARS = 600000;
  var VALID_STAGES = [
    "not_contacted", "awaiting_response", "in_discussion", "reviewing_materials",
    "due_diligence", "committed", "funded", "declined", "on_hold"
  ];
  var TASK_STATUS_MAP = { "Pending": "To do", "Ongoing": "In progress", "Completed": "Completed" };
  var KNOWN_TASK_STATUSES = ["To do", "In progress", "Completed"];

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
    if (state.schemaVersion !== SCHEMA_VERSION) fail("schemaVersion must be " + SCHEMA_VERSION);
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
      validateV2(payload);
      return { state: payload, report: payload.migrationReport || null, alreadyMigrated: true };
    }
    var result = migrateLegacy(payload, idFactory, now);
    validateV2(result.state);
    return { state: result.state, report: result.report, alreadyMigrated: false };
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    MAX_STATE_CHARS: MAX_STATE_CHARS,
    VALID_STAGES: VALID_STAGES,
    KNOWN_TASK_STATUSES: KNOWN_TASK_STATUSES,
    detectVersion: detectVersion,
    deriveStage: deriveStage,
    mapTaskStatus: mapTaskStatus,
    validateV2: validateV2,
    migrate: migrate
  };
});
