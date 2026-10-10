const MAX_CHANGELOG = 200;

function uid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    try { return globalThis.crypto.randomUUID(); } catch (e) { }
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function makeEntry(user, summary, at, extra) {
  let ts = new Date().toISOString();
  if (at) {
    const parsed = new Date(at);
    if (!isNaN(parsed)) ts = parsed.toISOString();
  }
  const entry = { id: uid(), ts: ts, user: user || "Team member", summary: summary };
  if (extra && typeof extra === "object") {
    if (extra.projectId) entry.projectId = String(extra.projectId);
    if (extra.projectName) entry.projectName = String(extra.projectName);
    if (extra.investorId) entry.investorId = String(extra.investorId);
  }
  return entry;
}

function byId(list) {
  const m = new Map();
  for (const item of list || []) {
    if (item && item.id) m.set(item.id, item);
  }
  return m;
}

function whereSame(a, b, fields) {
  for (const f of fields) {
    const av = a[f] === undefined || a[f] === null ? "" : a[f];
    const bv = b[f] === undefined || b[f] === null ? "" : b[f];
    if (String(av) !== String(bv)) return false;
  }
  return true;
}

function brief(ids, nameOf, cap) {
  return ids.slice(0, cap).map(nameOf).join(", ");
}

function pushCount(items, noun, n, detail) {
  if (n <= 0) return;
  items.push(n + " " + noun + (n === 1 ? "" : "s") + (detail ? " (" + detail + ")" : ""));
}

function investorDiff(oldData, nextData, items) {
  const oldMap = byId(oldData.investors);
  const newMap = byId(nextData.investors);
  function investorName(id) {
    const i = newMap.get(id) || oldMap.get(id);
    return i ? i.name : id;
  }
  const added = [];
  const removed = [];
  const updated = [];
  const archived = [];
  const reenabled = [];
  for (const inv of nextData.investors || []) {
    const prev = oldMap.get(inv.id);
    if (!prev) { added.push(inv.id); continue; }
    if (!whereSame(prev, inv, ["name", "type", "website", "location", "preferences", "notes"])) updated.push(inv.id);
    if (prev.archived && !inv.archived) reenabled.push(inv.id);
    else if (!prev.archived && inv.archived) archived.push(inv.id);
  }
  for (const inv of oldData.investors || []) {
    if (!newMap.has(inv.id)) removed.push(inv.id);
  }

  pushCount(items, "added investor", added.length, brief(added, investorName, 3));
  pushCount(items, "removed investor", removed.length, brief(removed, investorName, 3));
  pushCount(items, "updated investor", updated.length, brief(updated, investorName, 3));
  if (archived.length === 1) items.push("Archived investor " + investorName(archived[0]));
  else if (archived.length > 1) pushCount(items, "archived investor", archived.length, "");
  if (reenabled.length === 1) items.push("Re-activated investor " + investorName(reenabled[0]));
  else if (reenabled.length > 1) pushCount(items, "re-activated investor", reenabled.length, "");

  const oldContacts = new Map();
  const newContacts = new Map();
  for (const inv of oldData.investors || []) {
    for (const c of inv.contacts || []) oldContacts.set(c.id, { investorId: inv.id, contact: c });
  }
  for (const inv of nextData.investors || []) {
    for (const c of inv.contacts || []) newContacts.set(c.id, { investorId: inv.id, contact: c });
  }
  let addedC = 0;
  let removedC = 0;
  let updatedC = 0;
  const examples = [];
  for (const row of newContacts.values()) {
    const prev = oldContacts.get(row.contact.id);
    if (!prev) {
      addedC++;
      if (examples.length < 2) {
        const inv = newMap.get(row.investorId);
        examples.push(inv ? inv.name : row.investorId);
      }
    } else if (!whereSame(prev.contact, row.contact, ["name", "email", "phone", "position", "linkedin", "isPrimary"])) {
      updatedC++;
    }
  }
  for (const row of oldContacts.values()) {
    if (!newContacts.has(row.contact.id)) removedC++;
  }
  if (addedC === 1) items.push("New contact on investor " + examples[0]);
  else if (addedC > 1) items.push(addedC + " new contacts" + (examples.length ? " (e.g. " + examples.join(", ") + ")" : ""));
  pushCount(items, "removed contact", removedC, "");
  pushCount(items, "updated contact", updatedC, "");
}

function projectDiff(oldData, nextData, items) {
  const oldMap = byId(oldData.projects);
  const newMap = byId(nextData.projects);
  function projectName(id) {
    const p = newMap.get(id) || oldMap.get(id);
    return p ? p.name : id;
  }
  const added = [];
  const removed = [];
  const renamed = [];
  const archived = [];
  const reenabled = [];
  const stageMoves = [];
  const agreementMoves = [];
  const revokedSteps = [];
  for (const p of nextData.projects || []) {
    const prev = oldMap.get(p.id);
    if (!prev) { added.push(p.id); continue; }
    if (prev.name !== p.name) renamed.push(prev.name + " → " + p.name);
    if (prev.archived && !p.archived) reenabled.push(p.id);
    else if (!prev.archived && p.archived) archived.push(p.id);
    if ((prev.deliveryStage || "") !== (p.deliveryStage || "")) {
      stageMoves.push(p.name + (p.deliveryStage ? " moved to delivery stage" : " left delivery stage"));
    }
    const kept = new Set((p.stageHistory || []).map(function (h) { return h.id; }));
    const revN = (prev.stageHistory || []).filter(function (h) { return !kept.has(h.id); }).length;
    if (revN > 0) revokedSteps.push("Revoked " + revN + " delivery step" + (revN === 1 ? "" : "s") + " on " + p.name);
    const prevAg = prev.agreement && prev.agreement.status;
    const nextAg = p.agreement && p.agreement.status;
    if ((prevAg || "not_started") !== (nextAg || "not_started")) {
      agreementMoves.push('Agreement on "' + p.name + '" → ' + (nextAg || "not_started").replace(/_/g, " "));
    }
  }
  for (const p of oldData.projects || []) {
    if (!newMap.has(p.id)) removed.push(p.id);
  }

  pushCount(items, "added project", added.length, brief(added, projectName, 3));
  pushCount(items, "removed project", removed.length, brief(removed, projectName, 3));
  for (const r of renamed) items.push("Renamed project " + r);
  if (archived.length === 1) items.push("Archived project " + projectName(archived[0]));
  else if (archived.length > 1) pushCount(items, "archived project", archived.length, "");
  if (reenabled.length === 1) items.push("Re-activated project " + projectName(reenabled[0]));
  else if (reenabled.length > 1) pushCount(items, "re-activated project", reenabled.length, "");
  for (const s of stageMoves.slice(0, 3)) items.push(s);
  if (stageMoves.length > 3) items.push("and " + (stageMoves.length - 3) + " more delivery-stage change" + (stageMoves.length - 3 === 1 ? "" : "s"));
  for (const a of agreementMoves.slice(0, 2)) items.push(a);
  for (const r of revokedSteps.slice(0, 3)) items.push(r);
  if (revokedSteps.length > 3) items.push("and " + (revokedSteps.length - 3) + " more project" + (revokedSteps.length - 3 === 1 ? "" : "s") + " with revoked delivery steps");

  const oldEng = new Map();
  const newEng = new Map();
  for (const p of oldData.projects || []) {
    for (const e of p.engagements || []) oldEng.set(e.id, { e: e, project: p });
  }
  for (const p of nextData.projects || []) {
    for (const e of p.engagements || []) newEng.set(e.id, { e: e, project: p });
  }
  const stageChanges = [];
  let addedE = 0;
  let removedE = 0;
  let ownerMoves = 0;
  let updatedE = 0;
  for (const row of newEng.values()) {
    const prev = oldEng.get(row.e.id);
    if (!prev) { addedE++; continue; }
    if ((prev.e.stage || "") !== (row.e.stage || "")) {
      stageChanges.push(row.project.name + ": " + (prev.e.stage || "none") + " → " + (row.e.stage || "none"));
    }
    if ((prev.e.owner || "") !== (row.e.owner || "")) ownerMoves++;
    if (!whereSame(prev.e, row.e, ["priority", "owner", "notes"])) updatedE++;
  }
  for (const row of oldEng.values()) {
    if (!newEng.has(row.e.id)) removedE++;
  }
  pushCount(items, "added engagement", addedE, "");
  pushCount(items, "removed engagement", removedE, "");
  for (const s of stageChanges.slice(0, 3)) items.push(s);
  if (stageChanges.length > 3) items.push("and " + (stageChanges.length - 3) + " more stage change" + (stageChanges.length - 3 === 1 ? "" : "s"));
  pushCount(items, "engagement re-assigned", ownerMoves, "");
  pushCount(items, "updated engagement", updatedE, "");
}

function taskDiff(oldData, nextData, items) {
  const oldMap = byId(oldData.tasks);
  const newMap = byId(nextData.tasks);
  function titleOf(id) {
    const t = newMap.get(id) || oldMap.get(id);
    return t ? (t.title || id) : id;
  }
  const added = [];
  const removed = [];
  const completed = [];
  const reopened = [];
  let statusMoves = 0;
  for (const t of nextData.tasks || []) {
    const prev = oldMap.get(t.id);
    if (!prev) { added.push(t.id); continue; }
    if ((prev.status || "") !== (t.status || "")) {
      if (t.status === "Completed" && prev.status !== "Completed") completed.push(t.id);
      else if (t.status !== "Completed" && prev.status === "Completed") reopened.push(t.id);
      else statusMoves++;
    }
  }
  for (const t of oldData.tasks || []) {
    if (!newMap.has(t.id)) removed.push(t.id);
  }
  pushCount(items, "added task", added.length, brief(added, titleOf, 3));
  pushCount(items, "completed task", completed.length, brief(completed, titleOf, 3));
  pushCount(items, "removed task", removed.length, brief(removed, titleOf, 3));
  pushCount(items, "reopened task", reopened.length, brief(reopened, titleOf, 3));
  pushCount(items, "task status change", statusMoves, "");
}

function activityDiff(oldData, nextData, items) {
  const oldIds = new Set((oldData.activities || []).map((a) => a.id).filter(Boolean));
  let added = 0;
  for (const a of nextData.activities || []) {
    if (!a.id || !oldIds.has(a.id)) added++;
  }
  pushCount(items, "added activity", added, "");
}

function countsLine(data) {
  const investors = (data.investors || []).length;
  const projects = (data.projects || []).length;
  let engagements = 0;
  for (const p of data.projects || []) engagements += (p.engagements || []).length;
  return investors + " investors · " + projects + " projects · " + engagements + " engagements · " + (data.tasks || []).length + " tasks";
}

function primaryChangeTarget(oldData, nextData) {
  const target = { projectId: "", projectName: "", investorId: "" };
  if (!oldData) return target;
  const oldP = byId(oldData.projects);
  const newP = byId(nextData.projects);
  for (const p of nextData.projects || []) {
    const prev = oldP.get(p.id);
    if (!prev || JSON.stringify(prev) !== JSON.stringify(p)) {
      target.projectId = p.id;
      target.projectName = p.name || "";
      break;
    }
  }
  if (!target.projectId) {
    for (const p of oldData.projects || []) {
      if (!newP.has(p.id)) { target.projectName = p.name || ""; break; }
    }
  }
  const oldI = byId(oldData.investors);
  const newI = byId(nextData.investors);
  for (const inv of nextData.investors || []) {
    const prev = oldI.get(inv.id);
    if (!prev || JSON.stringify(prev) !== JSON.stringify(inv)) {
      target.investorId = inv.id;
      break;
    }
  }
  return target;
}

function describeChange(oldData, nextData) {
  const summary = summarizeChange(oldData, nextData);
  if (!summary) return null;
  const target = primaryChangeTarget(oldData, nextData);
  return {
    summary: summary,
    projectId: target.projectId,
    projectName: target.projectName,
    investorId: target.investorId
  };
}

function summarizeChange(oldData, nextData) {
  if (!oldData) return "Initialised the dataset";
  const oldV = Number(oldData.schemaVersion || 0);
  const newV = Number(nextData.schemaVersion || 0);
  if (oldV !== newV) {
    return "Migrated the dataset to schema v" + newV + " · " + countsLine(nextData);
  }
  const items = [];
  investorDiff(oldData, nextData, items);
  projectDiff(oldData, nextData, items);
  taskDiff(oldData, nextData, items);
  activityDiff(oldData, nextData, items);
  if (items.length === 0) return "";
  const head = items.slice(0, 5).join(" · ");
  const more = items.length - 5;
  return more > 0 ? head + " · and " + more + " more change" + (more === 1 ? "" : "s") : head;
}

export { MAX_CHANGELOG, makeEntry, summarizeChange, describeChange };