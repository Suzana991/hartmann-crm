import test from "node:test";
import assert from "node:assert/strict";
import { authenticate, parseTokenList } from "../src/auth.js";

function makeRequest(headers) {
  return new Request("http://crm.test/api/data", { headers });
}

test("parseTokenList splits on commas, whitespace and newlines", () => {
  assert.deepEqual(parseTokenList("a, b;c\nd"), ["a", "b", "c", "d"]);
  assert.deepEqual(parseTokenList(""), []);
  assert.deepEqual(parseTokenList(null), []);
  assert.deepEqual(parseTokenList("   "), []);
});

test("missing or malformed authorization header is rejected", async () => {
  const r1 = await authenticate(makeRequest({}), "tok");
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, "missing-bearer");
  const r2 = await authenticate(makeRequest({ authorization: "Basic dXNlcjpwYXNz" }), "tok");
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, "missing-bearer");
  const r3 = await authenticate(makeRequest({ authorization: "Bearer    " }), "tok");
  assert.equal(r3.ok, false);
  assert.equal(r3.reason, "missing-bearer");
});

test("invalid token is rejected", async () => {
  const r = await authenticate(makeRequest({ authorization: "Bearer wrong-token" }), "team-alpha, team-beta");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "invalid-token");
});

test("every configured team token is accepted", async () => {
  const secret = "team-alpha, team-beta\n team-gamma";
  for (const token of ["team-alpha", "team-beta", "team-gamma"]) {
    const r = await authenticate(makeRequest({ authorization: "Bearer " + token }), secret);
    assert.equal(r.ok, true, token);
  }
});

test("empty token configuration rejects everything", async () => {
  const r = await authenticate(makeRequest({ authorization: "Bearer anything" }), "");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not-configured");
  const r2 = await authenticate(makeRequest({ authorization: "Bearer anything" }), null);
  assert.equal(r2.ok, false);
});

test("presentation is trimmed so trailing spaces do not defeat login", async () => {
  const r = await authenticate(makeRequest({ authorization: "Bearer  team-alpha  " }), "team-alpha");
  assert.equal(r.ok, true);
});
