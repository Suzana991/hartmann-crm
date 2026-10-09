window.U = (function () {
  "use strict";

  const STAGES = [
    { id: "not_contacted", label: "Not contacted", color: "#8b90a6" },
    { id: "awaiting_response", label: "Awaiting response", color: "#f4b942" },
    { id: "in_discussion", label: "In discussion", color: "#6c9cff" },
    { id: "reviewing_materials", label: "Reviewing materials", color: "#a78bfa" },
    { id: "due_diligence", label: "Due diligence", color: "#22d3ee" },
    { id: "committed", label: "Committed", color: "#3fb984" },
    { id: "funded", label: "Funded", color: "#10b981" },
    { id: "declined", label: "Declined", color: "#f25c54" },
    { id: "on_hold", label: "On hold", color: "#9ca3af" }
  ];
  const PRIORITIES = ["High", "Medium", "Low"];
  const TEAM = ["Suzana", "Bruno", "Both", "Other"];
  const ACTIVITY_TYPES = ["Email", "Call", "Meeting", "Message", "Other outreach", "Materials sent", "Reply received", "Note"];
  const OUTREACH_TYPES = ["Email", "Call", "Meeting", "Message", "Other outreach"];
  const ACTIVITY_KINDS = ["outreach", "reply", "materials", "note", "appointment"];
  const TASK_STATUSES = ["To do", "In progress", "Waiting", "Completed"];
  const PROJECT_STAGES = [
    { id: "onboarding", label: "Onboarding", color: "#8b90a6" },
    { id: "engagement_agreement", label: "Engagement agreement", color: "#f4b942" },
    { id: "due_diligence", label: "Due diligence", color: "#22d3ee" },
    { id: "materials_preparation", label: "Investment materials preparation", color: "#a78bfa" },
    { id: "investor_outreach", label: "Investor outreach", color: "#6c9cff" },
    { id: "negotiation_structuring", label: "Negotiation and structuring", color: "#7cc4ff" },
    { id: "closing", label: "Closing", color: "#3fb984" },
    { id: "post_closing", label: "Post-closing", color: "#10b981" }
  ];
  const PROJECT_STATES = ["active", "on_hold", "archived"];
  const AGREEMENT_STATUSES = [
    { id: "not_started", label: "Not started", color: "#8b90a6" },
    { id: "drafting", label: "Drafting", color: "#f4b942" },
    { id: "sent", label: "Sent", color: "#6c9cff" },
    { id: "signed", label: "Signed", color: "#3fb984" },
    { id: "declined", label: "Declined", color: "#f25c54" }
  ];
  const TASK_KINDS = ["task", "appointment"];
  const INVESTOR_TYPES = [
    "Alternative fund manager", "Alternative investment manager", "Asset manager", "Bank",
    "Broker Dealer", "Crowdfunding platform", "Debt fund", "Direct Lender", "Family office",
    "Fund / LP", "Hedge fund", "Investment Platform", "Lessor", "Multi-Family Office", "PE",
    "Private Bank", "Private debt investment manager", "Private lender", "Public agency",
    "Public bank", "Public fund", "REIM", "Single Family Office", "Wealth Manager", "Other"
  ];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function esc(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    if (!m) return String(iso);
    return m[3] + " " + MONTHS[Number(m[2]) - 1] + " " + m[1];
  }

  function stageInfo(id) {
    return STAGES.find(function (s) { return s.id === id; }) || STAGES[0];
  }

  function stageChip(stage) {
    const info = stageInfo(stage);
    return '<span class="chip stage-chip" style="--chip-color:' + info.color + '">' + esc(info.label) + "</span>";
  }

  function priorityChip(priority) {
    if (!priority) return '<span class="chip muted-chip">—</span>';
    const cls = priority === "High" ? "chip-danger" : priority === "Medium" ? "chip-warning" : "chip-plain";
    return '<span class="chip ' + cls + '">' + esc(priority) + "</span>";
  }

  function contactDisplay(contact) {
    const name = String(contact.name || "").trim();
    const title = String(contact.title || "").trim();
    const email = String(contact.email || "").trim();
    if (name) return { primary: name, secondary: title };
    if (title) return { primary: title, secondary: email };
    if (email) return { primary: email, secondary: "" };
    return { primary: "Unnamed contact", secondary: "" };
  }

  function contactDisplayHtml(contact) {
    const d = contactDisplay(contact);
    return '<span class="contact-primary">' + esc(d.primary) + "</span>" +
      (d.secondary ? '<span class="contact-secondary">' + esc(d.secondary) + "</span>" : "");
  }

  function toast(message, kind) {
    const wrap = document.getElementById("toasts");
    if (!wrap) return;
    const el = document.createElement("div");
    el.className = "toast " + (kind || "info");
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(function () { el.classList.add("show"); }, 10);
    setTimeout(function () {
      el.classList.remove("show");
      setTimeout(function () { el.remove(); }, 300);
    }, 3800);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ",") { row.push(field); field = ""; }
        else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
        else if (ch === "\r") { }
        else field += ch;
      }
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return c.trim() !== ""; }); });
  }

  function csvCell(value) {
    return '"' + String(value === null || value === undefined ? "" : value).replace(/"/g, '""') + '"';
  }

  function normalizeKey(s) {
    return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function projectStageInfo(id) {
    return PROJECT_STAGES.find(function (s) { return s.id === id; }) || null;
  }

  function projectStageChip(stageId) {
    const info = projectStageInfo(stageId);
    if (!info) return '<span class="chip muted-chip">Stage not set</span>';
    return '<span class="chip stage-chip" style="--chip-color:' + info.color + '">' + esc(info.label) + "</span>";
  }

  function agreementInfo(id) {
    return AGREEMENT_STATUSES.find(function (s) { return s.id === id; }) || AGREEMENT_STATUSES[0];
  }

  function agreementChip(status) {
    const info = agreementInfo(status || "not_started");
    return '<span class="chip stage-chip" style="--chip-color:' + info.color + '">' + esc(info.label) + "</span>";
  }

  function projectStateOf(p) {
    if (!p) return "active";
    if (p.state) return p.state;
    return p.archived ? "archived" : "active";
  }

  function projectStateLabel(p) {
    const s = projectStateOf(p);
    if (s === "archived") return "Archived";
    if (s === "on_hold") return "On hold";
    return "Active";
  }

  function parseISO(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return null;
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }

  function isValidISODate(iso) {
    const p = parseISO(iso);
    if (!p) return false;
    const dt = new Date(p.y, p.m - 1, p.d);
    return dt.getFullYear() === p.y && dt.getMonth() === p.m - 1 && dt.getDate() === p.d;
  }

  function toISO(y, m, d) {
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
  }

  function addDaysISO(iso, n) {
    const p = parseISO(iso);
    if (!p) return iso;
    const dt = new Date(p.y, p.m - 1, p.d + n);
    return toISO(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  }

  function startOfWeekISO(iso) {
    const p = parseISO(iso);
    if (!p) return iso;
    const dt = new Date(p.y, p.m - 1, p.d);
    const offset = (dt.getDay() + 6) % 7;
    dt.setDate(dt.getDate() - offset);
    return toISO(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  }

  function monthGrid(anchorISO) {
    const p = parseISO(anchorISO) || parseISO(todayISO());
    const first = new Date(p.y, p.m - 1, 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(p.y, p.m - 1, 1 - offset);
    const weeks = [];
    let cur = new Date(start);
    for (let w = 0; w < 6; w++) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        week.push(toISO(cur.getFullYear(), cur.getMonth() + 1, cur.getDate()));
        cur.setDate(cur.getDate() + 1);
      }
      weeks.push(week);
      if (cur.getMonth() !== p.m - 1 && w >= 3) break;
    }
    return weeks;
  }

  function isOverdue(task) {
    if (!task || task.status === "Completed") return false;
    if (!task.dueDate || !isValidISODate(task.dueDate)) return false;
    return task.dueDate < todayISO();
  }

  function dueToday(task) {
    return !!task && task.status !== "Completed" && task.dueDate === todayISO();
  }

  function activityKindOf(type) {
    const t = String(type || "");
    if (t === "Email" || t === "Call" || t === "Meeting" || t === "Message" || t === "Other outreach" || t === "Outreach") return "outreach";
    if (t === "Reply received") return "reply";
    if (t === "Materials sent") return "materials";
    return "note";
  }

  function activityKindLabel(a) {
    if (a.kind === "appointment") return "Appointment";
    if (a.kind === "outreach") return a.outreachType || a.type || "Outreach";
    if (a.kind === "reply") return "Reply received";
    if (a.kind === "materials") return "Materials sent";
    return a.type || "Note";
  }

  function taskIsOpen(t) {
    return t.status !== "Completed";
  }

  return {
    STAGES: STAGES,
    PRIORITIES: PRIORITIES,
    TEAM: TEAM,
    ACTIVITY_TYPES: ACTIVITY_TYPES,
    OUTREACH_TYPES: OUTREACH_TYPES,
    ACTIVITY_KINDS: ACTIVITY_KINDS,
    TASK_STATUSES: TASK_STATUSES,
    PROJECT_STAGES: PROJECT_STAGES,
    PROJECT_STATES: PROJECT_STATES,
    AGREEMENT_STATUSES: AGREEMENT_STATUSES,
    TASK_KINDS: TASK_KINDS,
    INVESTOR_TYPES: INVESTOR_TYPES,
    MONTHS: MONTHS,
    esc: esc,
    uid: uid,
    todayISO: todayISO,
    fmtDate: fmtDate,
    stageInfo: stageInfo,
    stageChip: stageChip,
    priorityChip: priorityChip,
    projectStageInfo: projectStageInfo,
    projectStageChip: projectStageChip,
    agreementInfo: agreementInfo,
    agreementChip: agreementChip,
    projectStateOf: projectStateOf,
    projectStateLabel: projectStateLabel,
    parseISO: parseISO,
    isValidISODate: isValidISODate,
    toISO: toISO,
    addDaysISO: addDaysISO,
    startOfWeekISO: startOfWeekISO,
    monthGrid: monthGrid,
    isOverdue: isOverdue,
    dueToday: dueToday,
    activityKindOf: activityKindOf,
    activityKindLabel: activityKindLabel,
    taskIsOpen: taskIsOpen,
    contactDisplay: contactDisplay,
    contactDisplayHtml: contactDisplayHtml,
    toast: toast,
    downloadBlob: downloadBlob,
    parseCsv: parseCsv,
    csvCell: csvCell,
    normalizeKey: normalizeKey
  };
})();
