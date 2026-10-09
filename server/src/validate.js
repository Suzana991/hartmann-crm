const SCHEMA_VERSION = 3;
const MAX_STATE_CHARS = 600000;
const STAGES = new Set([
  "not_contacted", "awaiting_response", "in_discussion", "reviewing_materials",
  "due_diligence", "committed", "funded", "declined", "on_hold"
]);
const DELIVERY_STAGES = new Set([
  "onboarding", "engagement_agreement", "due_diligence", "materials_preparation",
  "investor_outreach", "negotiation_structuring", "closing", "post_closing"
]);
const PROJECT_STATES = new Set(["active", "on_hold", "archived"]);
const AGREEMENT_STATUSES = new Set(["not_started", "drafting", "sent", "signed", "declined"]);
const ACTIVITY_KINDS = new Set(["outreach", "reply", "materials", "note", "appointment"]);
const OUTREACH_TYPES = new Set(["Email", "Call", "Meeting", "Message", "Other outreach"]);
const TASK_KINDS = new Set(["task", "appointment"]);
const TASK_STATUSES = new Set(["To do", "In progress", "Waiting", "Completed"]);

export class PayloadError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function checkSchemaGate(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new PayloadError("invalid-payload", 400, "data must be a CRM object");
  }
  const v = data.schemaVersion;
  if (typeof v !== "number") {
    throw new PayloadError("schema-migration-required", 400, "schemaVersion missing: migrate legacy data with the client before saving");
  }
  if (v > SCHEMA_VERSION) {
    throw new PayloadError("unsupported-schema-version", 426, "This data was created by a newer version of the CRM (schema v" + v + "). This server supports up to v" + SCHEMA_VERSION + ". Update the application before saving.");
  }
  if (v < SCHEMA_VERSION) {
    throw new PayloadError("schema-migration-required", 400, "schemaVersion " + v + " is not storable: the client must migrate to v" + SCHEMA_VERSION + " before saving");
  }
}

export function validateState(data) {
  checkSchemaGate(data);
  let size;
  try { size = JSON.stringify(data).length; } catch (e) { throw new PayloadError("invalid-payload", 400, "data is not serializable"); }
  if (size > MAX_STATE_CHARS) throw new PayloadError("payload-too-large", 413, "payload too large (" + size + " chars)");
  if (!Array.isArray(data.investors) || !Array.isArray(data.projects) || !Array.isArray(data.activities) || !Array.isArray(data.tasks)) {
    throw new PayloadError("invalid-state", 400, "investors, projects, activities and tasks must be arrays");
  }
  const investorIds = new Set();
  const contactIds = new Set();
  for (const inv of data.investors) {
    if (!inv || typeof inv !== "object" || typeof inv.id !== "string" || !inv.id) throw new PayloadError("invalid-state", 400, "investor missing id");
    if (investorIds.has(inv.id)) throw new PayloadError("invalid-state", 400, "duplicate investor id");
    investorIds.add(inv.id);
    if (typeof inv.name !== "string") throw new PayloadError("invalid-state", 400, "investor name must be a string");
    if (!Array.isArray(inv.contacts)) throw new PayloadError("invalid-state", 400, "investor contacts must be an array");
    for (const c of inv.contacts) {
      if (!c || typeof c !== "object" || typeof c.id !== "string" || !c.id) throw new PayloadError("invalid-state", 400, "contact missing id");
      if (contactIds.has(c.id)) throw new PayloadError("invalid-state", 400, "duplicate contact id");
      contactIds.add(c.id);
    }
  }
  const engagementIds = new Set();
  const projectIds = new Set();
  for (const p of data.projects) {
    if (!p || typeof p !== "object" || typeof p.id !== "string" || !p.id) throw new PayloadError("invalid-state", 400, "project missing id");
    if (projectIds.has(p.id)) throw new PayloadError("invalid-state", 400, "duplicate project id");
    projectIds.add(p.id);
    if (!PROJECT_STATES.has(p.state)) throw new PayloadError("invalid-state", 400, "project has unknown state '" + p.state + "'");
    if (p.deliveryStage !== null && !DELIVERY_STAGES.has(p.deliveryStage)) throw new PayloadError("invalid-state", 400, "project has unknown delivery stage '" + p.deliveryStage + "'");
    if (typeof p.lead !== "string" || !["", "Suzana", "Bruno"].includes(p.lead)) throw new PayloadError("invalid-state", 400, "project lead must be '', 'Suzana' or 'Bruno'");
    if (!Array.isArray(p.milestones)) throw new PayloadError("invalid-state", 400, "project milestones must be an array");
    if (!p.stageNotes || typeof p.stageNotes !== "object") throw new PayloadError("invalid-state", 400, "project stageNotes must be an object");
    if (!Array.isArray(p.stageHistory)) throw new PayloadError("invalid-state", 400, "project stageHistory must be an array");
    if (!p.agreement || typeof p.agreement !== "object") throw new PayloadError("invalid-state", 400, "project agreement must be an object");
    if (!AGREEMENT_STATUSES.has(p.agreement.status)) throw new PayloadError("invalid-state", 400, "agreement has unknown status '" + p.agreement.status + "'");
    if (!Array.isArray(p.engagements)) throw new PayloadError("invalid-state", 400, "project engagements must be an array");
    for (const e of p.engagements) {
      if (!e || typeof e !== "object" || typeof e.id !== "string" || !e.id) throw new PayloadError("invalid-state", 400, "engagement missing id");
      if (engagementIds.has(e.id)) throw new PayloadError("invalid-state", 400, "duplicate engagement id");
      engagementIds.add(e.id);
      if (!investorIds.has(e.investorId)) throw new PayloadError("invalid-state", 400, "engagement references unknown investor");
      if (!STAGES.has(e.stage)) throw new PayloadError("invalid-state", 400, "engagement has unknown stage");
      if (!Array.isArray(e.contactIds)) throw new PayloadError("invalid-state", 400, "engagement contactIds must be an array");
      for (const cid of e.contactIds) {
        if (!contactIds.has(cid)) throw new PayloadError("invalid-state", 400, "engagement references unknown contact");
      }
    }
  }
  for (const a of data.activities) {
    if (!a || typeof a !== "object" || typeof a.id !== "string" || !a.id) throw new PayloadError("invalid-state", 400, "activity missing id");
    if (!engagementIds.has(a.engagementId)) throw new PayloadError("invalid-state", 400, "activity references unknown engagement");
    if (a.contactId !== null && a.contactId !== undefined && !contactIds.has(a.contactId)) throw new PayloadError("invalid-state", 400, "activity references unknown contact");
    if (!ACTIVITY_KINDS.has(a.kind)) throw new PayloadError("invalid-state", 400, "activity has unknown kind '" + a.kind + "'");
    if (a.kind === "outreach" && a.outreachType && !OUTREACH_TYPES.has(a.outreachType)) throw new PayloadError("invalid-state", 400, "activity has unknown outreach type '" + a.outreachType + "'");
  }
  const taskIds = new Set();
  for (const t of data.tasks) {
    if (!t || typeof t !== "object" || typeof t.id !== "string" || !t.id) throw new PayloadError("invalid-state", 400, "task missing id");
    if (taskIds.has(t.id)) throw new PayloadError("invalid-state", 400, "duplicate task id");
    taskIds.add(t.id);
    if (typeof t.title !== "string") throw new PayloadError("invalid-state", 400, "task title must be a string");
    if (t.projectId && !projectIds.has(t.projectId)) throw new PayloadError("invalid-state", 400, "task references unknown project");
    if (t.engagementId && !engagementIds.has(t.engagementId)) throw new PayloadError("invalid-state", 400, "task references unknown engagement");
    if (!TASK_STATUSES.has(t.status)) throw new PayloadError("invalid-state", 400, "task has unknown status");
    if (t.stage !== undefined && t.stage !== "" && !DELIVERY_STAGES.has(t.stage)) throw new PayloadError("invalid-state", 400, "task has unknown delivery stage '" + t.stage + "'");
    if (t.kind !== undefined && !TASK_KINDS.has(t.kind)) throw new PayloadError("invalid-state", 400, "task has unknown kind '" + t.kind + "'");
  }
  if (data.taskTemplates !== undefined && !Array.isArray(data.taskTemplates)) throw new PayloadError("invalid-state", 400, "taskTemplates must be an array");
  if (data.taskTemplates) {
    for (const tpl of data.taskTemplates) {
      if (!tpl || typeof tpl !== "object" || typeof tpl.title !== "string" || !tpl.title) throw new PayloadError("invalid-state", 400, "task template needs a title");
      if (!DELIVERY_STAGES.has(tpl.stage)) throw new PayloadError("invalid-state", 400, "task template has unknown stage");
    }
  }
  if (data.activeProjectId && !projectIds.has(data.activeProjectId)) throw new PayloadError("invalid-state", 400, "activeProjectId references unknown project");
  return true;
}
