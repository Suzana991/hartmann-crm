const subtle = globalThis.crypto.subtle;

async function sha256hex(value) {
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function parseTokenList(secret) {
  if (!secret) return [];
  return String(secret).split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}

export async function authenticate(request, authTokensSecret) {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer[ \t]+(.*)$/i.exec(header);
  const presented = match ? match[1].trim() : "";
  if (!presented) return { ok: false, reason: "missing-bearer" };
  const tokens = parseTokenList(authTokensSecret);
  if (tokens.length === 0) return { ok: false, reason: "not-configured" };
  const presentedHash = await sha256hex(presented);
  for (const token of tokens) {
    if ((await sha256hex(token)) === presentedHash) return { ok: true, token: token };
  }
  return { ok: false, reason: "invalid-token" };
}
