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
  const ACTIVITY_TYPES = ["Email", "Call", "Meeting", "Materials sent", "Reply received", "Outreach", "Note"];
  const TASK_STATUSES = ["To do", "In progress", "Completed"];
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

  return {
    STAGES: STAGES,
    PRIORITIES: PRIORITIES,
    TEAM: TEAM,
    ACTIVITY_TYPES: ACTIVITY_TYPES,
    TASK_STATUSES: TASK_STATUSES,
    INVESTOR_TYPES: INVESTOR_TYPES,
    esc: esc,
    uid: uid,
    todayISO: todayISO,
    fmtDate: fmtDate,
    stageInfo: stageInfo,
    stageChip: stageChip,
    priorityChip: priorityChip,
    contactDisplay: contactDisplay,
    contactDisplayHtml: contactDisplayHtml,
    toast: toast,
    downloadBlob: downloadBlob,
    parseCsv: parseCsv,
    csvCell: csvCell,
    normalizeKey: normalizeKey
  };
})();
