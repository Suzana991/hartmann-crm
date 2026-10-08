const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const M = require("../migration.js");

function readFixture() {
  const raw = fs.readFileSync(path.join(__dirname, "fixtures", "legacy-data.json"), "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function seqIds(prefix) {
  let n = 0;
  return () => prefix + "_" + String(++n).padStart(5, "0");
}

function migrateFixture(opts = {}) {
  return M.migrate(readFixture(), {
    idFactory: seqIds(opts.prefix || "t"),
    now: opts.now || "2026-10-08T00:00:00.000Z"
  });
}

test("detectVersion classifies payload shapes", () => {
  assert.strictEqual(M.detectVersion({ projects: [] }), 1);
  assert.strictEqual(M.detectVersion({ schemaVersion: 2, investors: [] }), 2);
  assert.throws(() => M.detectVersion(null), (e) => e.code === "unrecognized-data");
  assert.throws(() => M.detectVersion({ foo: 1 }), (e) => e.code === "unrecognized-data");
  assert.throws(() => M.detectVersion([1]), (e) => e.code === "unrecognized-data");
});

test("migrate rejects unsupported future schema version clearly", () => {
  assert.throws(
    () => M.migrate({ schemaVersion: 3, investors: [] }),
    (e) => e.code === "unsupported-version" && /schema v3/.test(e.message) && /supports up to v2/.test(e.message)
  );
  assert.throws(
    () => M.migrate({ schemaVersion: 99 }),
    (e) => e.code === "unsupported-version"
  );
});

test("migrate rejects unrecognized data clearly", () => {
  assert.throws(() => M.migrate({ hello: "world" }), (e) => e.code === "unrecognized-data");
  assert.throws(() => M.migrate("text"), (e) => e.code === "unrecognized-data");
});

test("real data: source counts fully accounted for", () => {
  const { state, report, alreadyMigrated } = migrateFixture();
  assert.strictEqual(alreadyMigrated, false);
  assert.strictEqual(report.sourceSchemaVersion, 1);
  assert.strictEqual(report.sourceCounts.projects, 2);
  assert.strictEqual(report.sourceCounts.institutions, 73);
  assert.strictEqual(report.sourceCounts.contacts, 183);
  assert.strictEqual(report.sourceCounts.tasks, 1);
  assert.strictEqual(report.mapping.length, 73);
  assert.strictEqual(state.schemaVersion, 2);
  assert.strictEqual(state.projects.length, 2);
  assert.strictEqual(state.projects.reduce((n, p) => n + p.engagements.length, 0), 73);
  assert.strictEqual(state.investors.length, 73);
  assert.strictEqual(state.investors.reduce((n, i) => n + i.contacts.length, 0), 183);
  assert.strictEqual(report.counts.engagements, 73);
  assert.strictEqual(report.counts.contacts, 183);
});

test("real data: mapping covers every source institution and contact", () => {
  const fixture = readFixture();
  const { report, state } = migrateFixture();
  const srcInstIds = fixture.projects.flatMap((p) => p.institutions.map((i) => i.id));
  const mappedInstIds = report.mapping.map((m) => m.source.institutionId);
  assert.deepStrictEqual([...mappedInstIds].sort(), [...srcInstIds].sort());
  const mappedContactIds = report.mapping.flatMap((m) => m.contacts.map((c) => c.contactId));
  assert.strictEqual(mappedContactIds.length, 183);
  assert.strictEqual(new Set(mappedContactIds).size, 183);
  const investorIds = new Set(state.investors.map((i) => i.id));
  const engagementIds = new Set(state.projects.flatMap((p) => p.engagements.map((e) => e.id)));
  report.mapping.forEach((m) => {
    assert.ok(investorIds.has(m.investorId), "mapping investor resolves");
    assert.ok(engagementIds.has(m.engagementId), "mapping engagement resolves");
    m.contacts.forEach((c) => assert.ok(mappedContactIds.includes(c.contactId)));
  });
});

test("real data: outreach preserved on the single reached institution", () => {
  const { state, report } = migrateFixture();
  const reachedEngs = state.projects.flatMap((p) => p.engagements).filter((e) => e.legacy.reachedOut === true);
  assert.strictEqual(reachedEngs.length, 1);
  const eng = reachedEngs[0];
  assert.deepStrictEqual(eng.legacy, {
    reachedOut: true,
    whoReachedOut: "Both",
    dateReachedOut: "2026-10-07",
    response: "Follow up",
    movingForward: "Yes",
    nextSteps: "We need to send Investment materials asap"
  });
  assert.strictEqual(eng.owner, "Both", "whoReachedOut preserved verbatim including 'Both'");
  assert.strictEqual(eng.stage, "in_discussion");
  assert.strictEqual(eng.priority, "High");
  assert.deepStrictEqual(eng.contactIds, [], "historical outreach not assigned to any contact");
  const entry = report.mapping.find((m) => m.engagementId === eng.id);
  assert.ok(entry.outreachActivityId, "outreach activity recorded in mapping");
  const act = state.activities.find((a) => a.id === entry.outreachActivityId);
  assert.strictEqual(act.date, "2026-10-07");
  assert.strictEqual(act.undated, false);
  assert.strictEqual(act.contactId, null);
  assert.strictEqual(act.teamMember, "Both");
  assert.strictEqual(act.legacy, true);
  assert.strictEqual(act.type, "Outreach");
  assert.strictEqual(state.activities.length, 1, "no activities invented for unreached records");
});

test("real data: unreached institutions become not_contacted with no activities", () => {
  const { state } = migrateFixture();
  const engs = state.projects.flatMap((p) => p.engagements);
  const unreached = engs.filter((e) => !e.legacy.reachedOut);
  assert.strictEqual(unreached.length, 72);
  unreached.forEach((e) => {
    assert.strictEqual(e.stage, "not_contacted");
    assert.strictEqual(e.legacy.response, "");
    assert.strictEqual(e.legacy.movingForward, "");
    assert.strictEqual(e.legacy.dateReachedOut, "");
    assert.deepStrictEqual(e.reviewFlags, [], "clean unreached records carry no review flags");
  });
  assert.strictEqual(state.activities.length, 1);
});

test("real data: tasks preserved without invented owners, dates, priorities", () => {
  const { state } = migrateFixture();
  const legacyTask = state.tasks.find((t) => t.source === "legacy-task");
  assert.ok(legacyTask);
  assert.strictEqual(legacyTask.id, "muylvmroopa9r9", "original task id preserved");
  assert.strictEqual(legacyTask.title, "Get total project cost for Palazzo Rici");
  assert.strictEqual(legacyTask.status, "Completed");
  assert.strictEqual(legacyTask.owner, "");
  assert.strictEqual(legacyTask.dueDate, "");
  assert.strictEqual(legacyTask.priority, "");
  assert.strictEqual(legacyTask.legacy, true);
  assert.strictEqual(legacyTask.engagementId, null);
  const nextTask = state.tasks.filter((t) => t.source === "legacy-nextSteps");
  assert.strictEqual(nextTask.length, 1, "exactly one follow-up task from the single non-empty nextSteps");
  assert.strictEqual(nextTask[0].title, "We need to send Investment materials asap");
  assert.strictEqual(nextTask[0].status, "To do");
  assert.strictEqual(nextTask[0].owner, "");
  assert.strictEqual(nextTask[0].dueDate, "");
  assert.ok(nextTask[0].engagementId, "follow-up linked to its engagement");
  assert.strictEqual(state.tasks.length, 2);
});

test("real data: contacts preserved exactly, nothing invented", () => {
  const { state } = migrateFixture();
  const contacts = state.investors.flatMap((i) => i.contacts);
  assert.strictEqual(contacts.length, 183);
  const named = contacts.filter((c) => c.name !== "");
  assert.strictEqual(named.length, 1, "only the one genuinely named contact keeps a name");
  assert.strictEqual(named[0].name, "Alessio Togni");
  const blankBoth = contacts.filter((c) => c.name === "" && c.title === "");
  assert.strictEqual(blankBoth.length, 2, "contacts with neither name nor title preserved, not dropped");
  blankBoth.forEach((c) => assert.notStrictEqual(c.email.trim(), "", "still have an email"));
  contacts.forEach((c) => {
    assert.strictEqual(c.phone, "");
    assert.strictEqual(c.notes, "");
    assert.strictEqual(c.isPrimary, false);
    assert.ok(Array.isArray(c.reviewFlags));
  });
  const invalidFlagged = contacts.filter((c) => c.reviewFlags.includes("invalid-email-format"));
  assert.strictEqual(invalidFlagged.length, 12, "non-standard email values flagged, values untouched");
  const generalInfo = contacts.find((c) => c.email === "general: info@europacapital.com");
  assert.ok(generalInfo, "annotated email preserved verbatim");
  const dupeFlagged = contacts.filter((c) => c.reviewFlags.some((f) => f.startsWith("possible-duplicate-email")));
  assert.strictEqual(dupeFlagged.length, 0, "garbled duplicate values are not valid emails so not treated as person duplicates");
});

test("real data: no inconsistent outreach and no undated activities", () => {
  const { state, report } = migrateFixture();
  const inconsistent = state.projects.flatMap((p) => p.engagements)
    .filter((e) => e.reviewFlags.some((f) => f.startsWith("inconsistent-outreach")));
  assert.strictEqual(inconsistent.length, 0, "real data contains no date-without-reachedOut records");
  assert.strictEqual(report.flags.filter((f) => f.type === "inconsistent-outreach").length, 0);
  const undated = state.activities.filter((a) => a.undated);
  assert.strictEqual(undated.length, 0);
});

test("real data: legacy backup retained byte-equivalent to source", () => {
  const fixture = readFixture();
  const { state } = migrateFixture();
  assert.strictEqual(typeof state.legacyBackup, "object");
  assert.deepStrictEqual(state.legacyBackup, fixture);
  assert.deepStrictEqual(state.migrationReport.sourceCounts, {
    projects: 2, institutions: 73, contacts: 183, tasks: 1
  });
});

test("real data: activeProjectId preserved", () => {
  const fixture = readFixture();
  const { state } = migrateFixture();
  assert.strictEqual(state.activeProjectId, fixture.activeProjectId);
  assert.ok(state.projects.some((p) => p.id === state.activeProjectId));
});

test("migration is repeatable: same input produces identical output", () => {
  const a = migrateFixture({ prefix: "runA" });
  const b = migrateFixture({ prefix: "runB" });
  const norm = (out) => {
    const s = JSON.parse(JSON.stringify(out.state));
    const idMap = new Map();
    let n = 0;
    const collect = (arr) => (arr || []).forEach((x) => { if (x.id) idMap.set(x.id, "id" + (++n)); });
    collect(s.investors);
    collect(s.projects);
    collect(s.tasks);
    s.projects.forEach((p) => collect(p.engagements));
    collect(s.activities);
    s.investors.forEach((i) => collect(i.contacts));
    const subst = (obj) => {
      if (Array.isArray(obj)) return obj.map(subst);
      if (obj && typeof obj === "object") {
        const r = {};
        Object.keys(obj).forEach((k) => { r[k] = subst(obj[k]); });
        return r;
      }
      if (typeof obj === "string" && idMap.has(obj)) return idMap.get(obj);
      return obj;
    };
    const normalized = subst(s);
    delete normalized.migrationReport.migratedAt;
    return JSON.stringify(normalized);
  };
  assert.strictEqual(norm(a), norm(b));
});

test("migrate on migrated v2 state is a no-op and validates", () => {
  const first = migrateFixture();
  const jsonRoundTrip = JSON.parse(JSON.stringify(first.state));
  const second = M.migrate(jsonRoundTrip);
  assert.strictEqual(second.alreadyMigrated, true);
  assert.strictEqual(second.state, jsonRoundTrip, "same object returned, no re-migration");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(second.state)), jsonRoundTrip);
  const third = M.migrate(jsonRoundTrip);
  assert.strictEqual(third.alreadyMigrated, true);
  assert.strictEqual(third.state.tasks.length, first.state.tasks.length, "no task duplication across reloads");
  assert.strictEqual(third.state.activities.length, first.state.activities.length);
  assert.strictEqual(third.state.investors.length, first.state.investors.length);
});

test("synthetic: date with reachedOut=false is preserved and flagged, no activity", () => {
  const payload = {
    projects: [{
      id: "p1", name: "P",
      institutions: [{
        id: "i1", companyName: "Bank X", companyType: "Bank", contacts: [{ name: "A", title: "", email: "a@x.com" }],
        reachedOut: false, dateReachedOut: "2026-01-15", whoReachedOut: "Suzana", response: "Yes", movingForward: "Yes", nextSteps: ""
      }],
      tasks: []
    }],
    activeProjectId: "p1"
  };
  const { state } = M.migrate(payload, { idFactory: seqIds("s"), now: "2026-10-08T00:00:00.000Z" });
  const eng = state.projects[0].engagements[0];
  assert.strictEqual(eng.legacy.reachedOut, false);
  assert.strictEqual(eng.legacy.dateReachedOut, "2026-01-15");
  assert.strictEqual(eng.legacy.response, "Yes");
  assert.strictEqual(eng.legacy.whoReachedOut, "Suzana");
  assert.ok(eng.reviewFlags.some((f) => f.startsWith("inconsistent-outreach")));
  assert.strictEqual(state.activities.length, 0, "no outreach asserted from contradictory evidence");
  assert.strictEqual(eng.stage, "not_contacted");
});

test("synthetic: reached without date yields undated legacy activity", () => {
  const payload = {
    projects: [{
      id: "p1", name: "P",
      institutions: [{
        id: "i1", companyName: "Bank Y", contacts: [], reachedOut: true, dateReachedOut: "",
        whoReachedOut: "Bruno", response: "", movingForward: "", nextSteps: ""
      }],
      tasks: []
    }],
    activeProjectId: "p1"
  };
  const { state } = M.migrate(payload, { idFactory: seqIds("u"), now: "2026-10-08T00:00:00.000Z" });
  const act = state.activities[0];
  assert.strictEqual(act.date, null);
  assert.strictEqual(act.undated, true);
  assert.strictEqual(act.teamMember, "Bruno");
  assert.strictEqual(state.projects[0].engagements[0].stage, "awaiting_response");
});

test("synthetic: stage mapping is conservative and flags ambiguity", () => {
  const cases = [
    [{ reachedOut: true, response: "", movingForward: "TBD" }, "awaiting_response", false],
    [{ reachedOut: true, response: "Pending", movingForward: "" }, "awaiting_response", false],
    [{ reachedOut: true, response: "Yes", movingForward: "" }, "in_discussion", false],
    [{ reachedOut: true, response: "Follow up", movingForward: "" }, "in_discussion", false],
    [{ reachedOut: true, response: "No", movingForward: "" }, "awaiting_response", true],
    [{ reachedOut: true, response: "", movingForward: "No" }, "declined", true],
    [{ reachedOut: true, response: "", movingForward: "On hold" }, "on_hold", false],
    [{ reachedOut: true, response: "Whatever", movingForward: "" }, "awaiting_response", true]
  ];
  cases.forEach(([legacy, expectedStage, expectFlag]) => {
    const r = M.deriveStage(Object.assign({ dateReachedOut: "", whoReachedOut: "", nextSteps: "" }, legacy));
    assert.strictEqual(r.stage, expectedStage, JSON.stringify(legacy));
    assert.strictEqual(r.flags.length > 0, expectFlag, "flag expectation for " + JSON.stringify(legacy));
  });
  const neverAdvanced = cases.map(([l]) => M.deriveStage(Object.assign({ dateReachedOut: "", whoReachedOut: "", nextSteps: "" }, l)).stage);
  ["due_diligence", "committed", "funded", "reviewing_materials"].forEach((s) => {
    assert.ok(!neverAdvanced.includes(s), "legacy Yes/Follow up must never imply " + s);
  });
});

test("synthetic: task status mapping is conservative", () => {
  assert.deepStrictEqual(M.mapTaskStatus("Pending"), { status: "To do", flag: null });
  assert.deepStrictEqual(M.mapTaskStatus("Ongoing"), { status: "In progress", flag: null });
  assert.deepStrictEqual(M.mapTaskStatus("Completed"), { status: "Completed", flag: null });
  assert.deepStrictEqual(M.mapTaskStatus(""), { status: "To do", flag: null });
  const odd = M.mapTaskStatus("Weird");
  assert.strictEqual(odd.status, "To do");
  assert.match(odd.flag, /unmapped/);
});

test("synthetic: same institution in two projects yields one investor, two engagements, full mapping", () => {
  const payload = {
    projects: [
      {
        id: "pA", name: "Alpha",
        institutions: [{
          id: "ia", companyName: "Dup Bank", companyType: "Bank",
          contacts: [{ name: "One", title: "", email: "one@dup.com" }, { name: "", title: "Analyst", email: "two@dup.com" }],
          reachedOut: true, dateReachedOut: "2026-02-01", whoReachedOut: "Both", response: "", movingForward: "", nextSteps: ""
        }],
        tasks: [{ id: "tA", title: "Legacy A", status: "Pending" }]
      },
      {
        id: "pB", name: "Beta",
        institutions: [{
          id: "ib", companyName: "dup  bank", companyType: "",
          contacts: [{ name: "", title: "Partner", email: "three@dup.com" }],
          reachedOut: false, dateReachedOut: "", whoReachedOut: "", response: "", movingForward: "", nextSteps: "Call them back"
        }],
        tasks: []
      }
    ],
    activeProjectId: "pA"
  };
  const { state, report } = M.migrate(payload, { idFactory: seqIds("d"), now: "2026-10-08T00:00:00.000Z" });
  assert.strictEqual(state.investors.length, 1, "name-normalized dedup");
  assert.strictEqual(state.investors[0].type, "Bank", "type filled from first source with a value");
  assert.strictEqual(state.investors[0].contacts.length, 3, "contacts from both sources retained, none merged");
  assert.strictEqual(state.projects[0].engagements.length, 1);
  assert.strictEqual(state.projects[1].engagements.length, 1);
  assert.strictEqual(report.mapping.length, 2);
  const engA = state.projects[0].engagements[0];
  const engB = state.projects[1].engagements[0];
  assert.strictEqual(engA.investorId, state.investors[0].id);
  assert.strictEqual(engB.investorId, state.investors[0].id);
  assert.notStrictEqual(engA.id, engB.id);
  assert.strictEqual(engA.legacy.nextSteps, "");
  assert.strictEqual(engB.legacy.nextSteps, "Call them back");
  assert.strictEqual(state.tasks.filter((t) => t.source === "legacy-nextSteps").length, 1);
  assert.strictEqual(state.tasks.find((t) => t.id === "tA").status, "To do");
  assert.strictEqual(state.activities.length, 1, "only source A outreach generated");
});

test("synthetic: possible duplicate valid emails are flagged but not merged", () => {
  const payload = {
    projects: [{
      id: "p1", name: "P",
      institutions: [{
        id: "i1", companyName: "Z", contacts: [
          { name: "Jane Doe", title: "", email: "jane@firm.com" },
          { name: "", title: "MD", email: "Jane@Firm.com" }
        ],
        reachedOut: false, dateReachedOut: "", whoReachedOut: "", response: "", movingForward: "", nextSteps: ""
      }],
      tasks: []
    }],
    activeProjectId: "p1"
  };
  const { state, report } = M.migrate(payload, { idFactory: seqIds("dup"), now: "2026-10-08T00:00:00.000Z" });
  const contacts = state.investors[0].contacts;
  assert.strictEqual(contacts.length, 2, "not auto-merged");
  contacts.forEach((c) => assert.ok(c.reviewFlags.some((f) => f.startsWith("possible-duplicate-email"))));
  assert.strictEqual(report.flags.filter((f) => f.type === "possible-duplicate-contacts").length, 1);
});

test("validateV2 rejects structural corruption", () => {
  const base = () => JSON.parse(JSON.stringify(migrateFixture().state));
  assert.strictEqual(M.validateV2(base()), true);
  assert.throws(() => M.validateV2(null), (e) => e.code === "invalid-data");
  const noArr = base(); delete noArr.tasks;
  assert.throws(() => M.validateV2(noArr), (e) => /tasks must be an array/.test(e.message));
  const badStage = base(); badStage.projects[0].engagements[0].stage = "imaginary";
  assert.throws(() => M.validateV2(badStage), (e) => /unknown stage/.test(e.message));
  const dangling = base(); dangling.projects[0].engagements[0].investorId = "ghost";
  assert.throws(() => M.validateV2(dangling), (e) => /unknown investor/.test(e.message));
  const danglingAct = base(); danglingAct.activities[0].engagementId = "ghost";
  assert.throws(() => M.validateV2(danglingAct), (e) => /unknown engagement/.test(e.message));
  const badStatus = base(); badStatus.tasks[0].status = "Stalled";
  assert.throws(() => M.validateV2(badStatus), (e) => /unknown status/.test(e.message));
  const dupInv = base(); dupInv.investors.push(JSON.parse(JSON.stringify(dupInv.investors[0])));
  assert.throws(() => M.validateV2(dupInv), (e) => /duplicate investor id/.test(e.message));
  const tooBig = base(); tooBig.pad = "x".repeat(M.MAX_STATE_CHARS + 10);
  assert.throws(() => M.validateV2(tooBig), (e) => /too large/.test(e.message));
});

test("validateV2 rejects wrong schemaVersion", () => {
  const s = JSON.parse(JSON.stringify(migrateFixture().state));
  s.schemaVersion = 1;
  assert.throws(() => M.validateV2(s), (e) => /schemaVersion must be 2/.test(e.message));
});
