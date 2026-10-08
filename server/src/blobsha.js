import { createHash } from "node:crypto";

export function computeBlobSha(text) {
  const body = "blob " + Buffer.byteLength(text, "utf8") + "\0" + text;
  return createHash("sha1").update(body, "utf8").digest("hex");
}
