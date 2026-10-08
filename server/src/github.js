export function buildFileUrl(cfg, opts = {}) {
  const base = "https://api.github.com/repos/" + encodeURIComponent(cfg.owner) + "/" +
    encodeURIComponent(cfg.repo) + "/contents/" + encodeURIComponent(cfg.path);
  if (opts.withRef === false) return base;
  return base + "?ref=" + encodeURIComponent(cfg.branch);
}

function ghHeaders(cfg) {
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": "Bearer " + cfg.token,
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

function toBase64(text) {
  if (typeof Buffer !== "undefined") return Buffer.from(text, "utf8").toString("base64");
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(b64) {
  const clean = String(b64).replace(/\s/g, "");
  if (typeof Buffer !== "undefined") return Buffer.from(clean, "base64").toString("utf8");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export class StorageError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function getFile(cfg, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(buildFileUrl(cfg), { headers: ghHeaders(cfg) });
  } catch (e) {
    throw new StorageError("storage unreachable", 502);
  }
  if (res.status === 404) return { missing: true };
  if (!res.ok) throw new StorageError("storage read failed (HTTP " + res.status + ")", 502);
  const body = await res.json();
  if (typeof body.content !== "string" || typeof body.sha !== "string") {
    throw new StorageError("storage returned malformed file object", 502);
  }
  return { missing: false, sha: body.sha, text: fromBase64(body.content) };
}

export async function putFile(cfg, fetchImpl, opts) {
  const payload = {
    message: opts.message,
    content: toBase64(opts.text),
    branch: cfg.branch
  };
  if (opts.sha) payload.sha = opts.sha;
  let res;
  try {
    res = await fetchImpl(buildFileUrl(cfg, { withRef: false }), {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, ghHeaders(cfg)),
      body: JSON.stringify(payload)
    });
  } catch (e) {
    throw new StorageError("storage unreachable", 502);
  }
  if (res.status === 409 || res.status === 422) {
    const body = await res.json().catch(() => ({}));
    throw new StorageError("storage write rejected: " + (body.message || res.status), 409);
  }
  if (!res.ok) throw new StorageError("storage write failed (HTTP " + res.status + ")", 502);
  const body = await res.json();
  if (!body.content || typeof body.content.sha !== "string") throw new StorageError("storage returned malformed write result", 502);
  return { sha: body.content.sha };
}

export { toBase64, fromBase64 };
