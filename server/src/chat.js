export const CHAT_VERSION = 1;
export const MAX_CHAT_MESSAGES = 500;
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_CLIENT_ID_CHARS = 120;
export const MAX_LABEL_CHARS = 200;

const FALLBACK_AUTHOR = "Team member";

export function emptyChat() {
  return { version: CHAT_VERSION, seq: 0, messages: [], reads: {} };
}

function cleanString(value, max) {
  if (value === undefined || value === null) return "";
  const s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}

function normalizeMessage(m) {
  if (!m || typeof m !== "object") return null;
  const seq = Number(m.seq);
  if (!Number.isFinite(seq) || seq <= 0) return null;
  return {
    id: cleanString(m.id, 80) || ("m" + seq),
    seq: Math.floor(seq),
    author: cleanString(m.author, MAX_LABEL_CHARS) || FALLBACK_AUTHOR,
    text: cleanString(m.text, MAX_MESSAGE_CHARS),
    projectId: cleanString(m.projectId, MAX_LABEL_CHARS),
    projectName: cleanString(m.projectName, MAX_LABEL_CHARS),
    clientId: cleanString(m.clientId, MAX_CLIENT_ID_CHARS),
    ts: cleanString(m.ts, 40)
  };
}

export function parseChat(text) {
  if (!text) return emptyChat();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return emptyChat();
  }
  if (!parsed || typeof parsed !== "object") return emptyChat();
  const store = emptyChat();
  let maxSeq = 0;
  if (Array.isArray(parsed.messages)) {
    for (const raw of parsed.messages) {
      const m = normalizeMessage(raw);
      if (!m) continue;
      if (m.seq > maxSeq) maxSeq = m.seq;
      store.messages.push(m);
    }
  }
  store.seq = Math.max(maxSeq, Number(parsed.seq) || 0);
  if (parsed.reads && typeof parsed.reads === "object") {
    for (const [name, value] of Object.entries(parsed.reads)) {
      const n = Number(value);
      const key = cleanString(name, MAX_LABEL_CHARS);
      if (key && Number.isFinite(n)) store.reads[key] = Math.max(0, Math.floor(n));
    }
  }
  store.messages.sort(function (a, b) { return a.seq - b.seq; });
  return store;
}

export function serializeChat(store) {
  return JSON.stringify({
    version: CHAT_VERSION,
    seq: store.seq,
    messages: store.messages,
    reads: store.reads
  }, null, 2);
}

export function findMessageByClientId(store, author, clientId) {
  if (!clientId) return null;
  for (const m of store.messages) {
    if (m.clientId === clientId && m.author === author) return m;
  }
  return null;
}

export function addMessage(store, opts) {
  const author = cleanString(opts.author, MAX_LABEL_CHARS) || FALLBACK_AUTHOR;
  const clientId = cleanString(opts.clientId, MAX_CLIENT_ID_CHARS);
  const existing = findMessageByClientId(store, author, clientId);
  if (existing) return { message: existing, duplicate: true };

  const text = cleanString(opts.text, MAX_MESSAGE_CHARS).trim();
  if (!text) return { message: null, duplicate: false, error: "empty-message" };

  store.seq = (Number(store.seq) || 0) + 1;
  const message = {
    id: "m" + store.seq,
    seq: store.seq,
    author: author,
    text: text,
    projectId: cleanString(opts.projectId, MAX_LABEL_CHARS),
    projectName: cleanString(opts.projectName, MAX_LABEL_CHARS),
    clientId: clientId,
    ts: cleanString(opts.now, 40) || new Date().toISOString()
  };
  store.messages.push(message);
  if (store.messages.length > MAX_CHAT_MESSAGES) {
    store.messages = store.messages.slice(store.messages.length - MAX_CHAT_MESSAGES);
  }
  store.reads[author] = Math.max(store.reads[author] || 0, message.seq);
  return { message: message, duplicate: false };
}

export function markRead(store, author, seq) {
  const name = cleanString(author, MAX_LABEL_CHARS) || FALLBACK_AUTHOR;
  const target = Math.max(0, Math.min(Math.floor(Number(seq) || 0), Number(store.seq) || 0));
  const next = Math.max(store.reads[name] || 0, target);
  store.reads[name] = next;
  return next;
}

export function publicMessages(store, since) {
  const from = Math.max(0, Math.floor(Number(since) || 0));
  return store.messages
    .filter(function (m) { return m.seq > from; })
    .map(function (m) {
      return {
        id: m.id,
        seq: m.seq,
        author: m.author,
        text: m.text,
        projectId: m.projectId,
        projectName: m.projectName,
        clientId: m.clientId,
        ts: m.ts
      };
    });
}

export function publicChat(store, opts) {
  const since = opts && opts.since !== undefined ? opts.since : 0;
  return {
    version: CHAT_VERSION,
    latest: Number(store.seq) || 0,
    me: (opts && opts.me) || FALLBACK_AUTHOR,
    reads: Object.assign({}, store.reads),
    messages: publicMessages(store, since)
  };
}
