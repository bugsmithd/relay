// Phase 4 — route-handler deny-shape proof + positive 200/201 proof for
// /api/messages.
//
// Spawns `pnpm exec next start` (production build) on an ephemeral port with
// PID-ancestry guard. `next start` forces NODE_ENV=production, which closes
// /dev/test-signin (backdoor disabled when NODE_ENV === "production"; see
// app/dev/test-signin/route.ts). To mint a session the route handler accepts,
// the spec uses @supabase/ssr's createServerClient with a captured-cookie
// store: signInWithPassword writes session cookies into the store, and the
// spec replays them in the Cookie request header.
//
// Cookie name uses the __Host- prefix (production env -> lib/supabase/server.ts
// COOKIE_PREFIX). The server reads cookies via next/headers cookies(), which
// does not enforce __Host- semantics on inbound requests (those are browser
// rules on Set-Cookie); reading is permissive over plain HTTP localhost.

import { test, after, before } from "node:test";
import { strict as assert } from "node:assert";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer, connect as netConnect } from "node:net";
import { createServerClient } from "@supabase/ssr";
import { setupHarness, type Harness } from "../lib/supabase-test-harness.ts";

const HOST = "127.0.0.1";

const EXPECTED_HEADERS: Record<string, string> = {
  "cache-control": "no-store, private",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; connect-src 'self' https://*.supabase.co; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

const DENY_BODY = "{}";

let child: ChildProcess | null = null;
let PORT = 0;
let H: Harness;
let memberCookie = "";

async function pickFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, HOST, () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close();
        return reject(new Error("could not bind ephemeral port"));
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

function lsofListenerPid(port: number): number | null {
  const r = spawnSync(
    "lsof",
    ["-nP", "-iTCP:" + String(port), "-sTCP:LISTEN", "-t"],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return null;
  const tokens = (r.stdout ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const pid = Number(tokens[0]);
  return Number.isFinite(pid) ? pid : null;
}

function processAncestors(pid: number, maxDepth = 10): number[] {
  const chain: number[] = [pid];
  let cur = pid;
  for (let i = 0; i < maxDepth; i++) {
    const r = spawnSync("ps", ["-o", "ppid=", "-p", String(cur)], {
      encoding: "utf8",
    });
    if (r.status !== 0) break;
    const ppid = Number((r.stdout ?? "").trim());
    if (!Number.isFinite(ppid) || ppid <= 1) break;
    chain.push(ppid);
    cur = ppid;
  }
  return chain;
}

async function waitFor(url: string, ms = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const r = await fetch(url, { method: "GET" });
      if (r.status >= 200 && r.status < 600) return;
    } catch {
      // listener not yet up
    }
    await sleep(250);
  }
  throw new Error(`server at ${url} did not start within ${ms}ms`);
}

// Captures the cookies @supabase/ssr writes during signInWithPassword and
// returns a replayable Cookie header value. __Host-relay-session is the
// production-mode cookie name; the same prefix is read server-side by
// createSupabaseServerClient (lib/supabase/server.ts:5-6).
async function captureSessionCookies(
  email: string,
  password: string,
): Promise<string> {
  const url = process.env.SUPABASE_URL!;
  const anonKey = process.env.SUPABASE_ANON_KEY!;
  const captured = new Map<string, string>();
  const client = createServerClient(url, anonKey, {
    cookieOptions: {
      name: "__Host-relay-session",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll() {
        return [...captured.entries()].map(([name, value]) => ({
          name,
          value,
        }));
      },
      setAll(toSet) {
        for (const { name, value } of toSet) {
          if (value === "") captured.delete(name);
          else captured.set(name, value);
        }
      },
    },
  });
  const r = await client.auth.signInWithPassword({ email, password });
  if (r.error) throw r.error;
  return [...captured.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
}

function assertSixHeaders(r: Response, label: string) {
  for (const [name, expected] of Object.entries(EXPECTED_HEADERS)) {
    assert.equal(
      r.headers.get(name),
      expected,
      `${label}: header ${name} expected ${JSON.stringify(expected)}, got ${JSON.stringify(r.headers.get(name))}`,
    );
  }
}

function assertDeny(res: Response, body: string, label: string) {
  assert.equal(res.status, 404, `${label}: status`);
  assert.equal(body, DENY_BODY, `${label}: body bytes (expected exactly "{}")`);
  assert.equal(
    res.headers.get("content-type"),
    "application/json",
    `${label}: content-type`,
  );
  assertSixHeaders(res, label);
}

before(async () => {
  H = await setupHarness();
  memberCookie = await captureSessionCookies(H.member.email, H.member.password);
  PORT = await pickFreePort();
  // Pin SITE_ORIGIN to the ephemeral port the spec actually binds. The route
  // handler's host-mismatch check (canonicalRedirectIfHostMismatch) compares
  // the inbound Host header against new URL(SITE_ORIGIN).host; without this
  // override every POST collapses to D-14 deny because .env.local's
  // SITE_ORIGIN points at the canonical dev port.
  child = spawn(
    "pnpm",
    ["exec", "next", "start", "-H", HOST, "-p", String(PORT)],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "production",
        SITE_ORIGIN: `http://${HOST}:${PORT}`,
      },
    },
  );
  let stderrBuf = "";
  child.stderr?.on("data", (d) => {
    stderrBuf += d.toString();
  });
  child.stdout?.on("data", () => {});
  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(
        `next start exited ${code} during boot. stderr tail: ${stderrBuf.slice(-500)}`,
      );
    }
  });
  await waitFor(`http://${HOST}:${PORT}/`);

  const listenerPid = lsofListenerPid(PORT);
  if (listenerPid === null) {
    throw new Error(
      `could not identify listener PID for port ${PORT}. Aborting to avoid false-pass.`,
    );
  }
  const childPid = child.pid;
  if (childPid === undefined) throw new Error("spawned child has no pid");
  const ancestors = processAncestors(listenerPid);
  if (!ancestors.includes(childPid)) {
    throw new Error(
      `stale-server guard tripped: listener pid ${listenerPid} ` +
        `(ancestors=[${ancestors.join(",")}]) is not a descendant of ` +
        `spawned child pid ${childPid}. Refusing to assert against a foreign server.`,
    );
  }
});

after(async () => {
  if (child && !child.killed) {
    child.kill("SIGTERM");
    await new Promise<void>((res) => {
      const t = setTimeout(() => {
        child?.kill("SIGKILL");
        res();
      }, 3000);
      child?.once("exit", () => {
        clearTimeout(t);
        res();
      });
    });
  }
  if (H) await H.cleanup();
});

type FetchOpts = {
  method: string;
  path: string;
  cookie?: string;
  contentType?: string | null; // null suppresses; undefined defaults
  body?: BodyInit | null;
  overrideOrigin?: string | null; // null suppresses Origin header
};

async function probe(opts: FetchOpts): Promise<{ res: Response; text: string }> {
  const headers: Record<string, string> = {};
  if (opts.overrideOrigin !== null) {
    headers["origin"] = opts.overrideOrigin ?? `http://${HOST}:${PORT}`;
  }
  // fetch auto-derives the Host header from the URL and refuses to honor a
  // forged "host" override. Host-mismatch adversarial probes go through
  // rawPost (which writes the raw HTTP/1.1 request line and headers).
  if (opts.contentType !== null && opts.method !== "GET" && opts.method !== "HEAD") {
    headers["content-type"] = opts.contentType ?? "application/json";
  }
  if (opts.cookie) headers["cookie"] = opts.cookie;
  const res = await fetch(`http://${HOST}:${PORT}${opts.path}`, {
    method: opts.method,
    headers,
    body: opts.body ?? undefined,
    redirect: "manual",
  });
  const text = await res.text();
  return { res, text };
}

// Raw HTTP/1.1 POST via net.Socket so the spec controls every header byte
// (lying Content-Length, missing Content-Length + chunked oversize). fetch
// auto-computes Content-Length and Transfer-Encoding which prevents these
// adversarial variants from being expressed.
type RawResp = { status: number; headers: Record<string, string>; body: string };

async function rawPost(opts: {
  path: string;
  headers: string[];
  body: Buffer;
  cookie?: string;
  hostOverride?: string; // defaults to `${HOST}:${PORT}`
  originOverride?: string; // defaults to `http://${HOST}:${PORT}`; pass null to omit
  omitOrigin?: boolean;
}): Promise<RawResp> {
  return new Promise<RawResp>((resolve, reject) => {
    const sock = netConnect(PORT, HOST);
    let buf = Buffer.alloc(0);
    sock.on("error", reject);
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
    });
    sock.on("end", () => {
      const sep = buf.indexOf("\r\n\r\n");
      if (sep === -1) return reject(new Error("malformed response (no header terminator)"));
      const headerStr = buf.subarray(0, sep).toString("utf8");
      const bodyBuf = buf.subarray(sep + 4);
      const lines = headerStr.split("\r\n");
      const statusLine = lines[0];
      const status = Number(statusLine.split(" ")[1]);
      const headers: Record<string, string> = {};
      for (const line of lines.slice(1)) {
        const idx = line.indexOf(":");
        if (idx === -1) continue;
        const k = line.slice(0, idx).trim().toLowerCase();
        const v = line.slice(idx + 1).trim();
        headers[k] = v;
      }
      // De-chunk transfer-encoding: chunked responses (Next emits chunked
      // for many handler outputs).
      let body: string;
      if (headers["transfer-encoding"]?.toLowerCase().includes("chunked")) {
        body = dechunk(bodyBuf).toString("utf8");
      } else {
        body = bodyBuf.toString("utf8");
      }
      resolve({ status, headers, body });
    });
    sock.on("connect", () => {
      const hostHeader = opts.hostOverride ?? `${HOST}:${PORT}`;
      const lines = [
        `POST ${opts.path} HTTP/1.1`,
        `Host: ${hostHeader}`,
      ];
      if (!opts.omitOrigin) {
        const origin = opts.originOverride ?? `http://${HOST}:${PORT}`;
        lines.push(`Origin: ${origin}`);
      }
      lines.push("Connection: close", ...opts.headers);
      if (opts.cookie) lines.push(`Cookie: ${opts.cookie}`);
      sock.write(lines.join("\r\n") + "\r\n\r\n");
      sock.write(opts.body);
    });
  });
}

function dechunk(buf: Buffer): Buffer {
  const out: Buffer[] = [];
  let i = 0;
  while (i < buf.length) {
    const crlf = buf.indexOf("\r\n", i);
    if (crlf === -1) break;
    const sizeStr = buf.subarray(i, crlf).toString("ascii");
    const size = parseInt(sizeStr.split(";")[0], 16);
    if (!Number.isFinite(size) || size <= 0) break;
    out.push(buf.subarray(crlf + 2, crlf + 2 + size));
    i = crlf + 2 + size + 2; // skip chunk + trailing CRLF
  }
  return Buffer.concat(out);
}

function assertRawDeny(r: RawResp, label: string) {
  assert.equal(r.status, 404, `${label}: status`);
  assert.equal(r.body, DENY_BODY, `${label}: body bytes`);
  assert.equal(r.headers["content-type"], "application/json", `${label}: content-type`);
  for (const [name, expected] of Object.entries(EXPECTED_HEADERS)) {
    assert.equal(
      r.headers[name],
      expected,
      `${label}: header ${name} expected ${JSON.stringify(expected)}, got ${JSON.stringify(r.headers[name])}`,
    );
  }
}

async function countMessagesInChannel(channelId: string): Promise<number> {
  const r = await H.admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", channelId);
  if (r.error) throw r.error;
  return r.count ?? 0;
}

// ---------------------------------------------------------------------------
// D-17 unsupported method handlers
// ---------------------------------------------------------------------------

for (const method of ["PUT", "DELETE", "PATCH", "OPTIONS"] as const) {
  test(`D-17 ${method} -> byte-identical 404 + {} + Day-1B headers`, async () => {
    const { res, text } = await probe({
      method,
      path: "/api/messages",
      contentType: null,
    });
    assertDeny(res, text, `D-17 ${method}`);
  });
}

test("D-17 HEAD -> 404 + Day-1B headers + NO body, no Content-Length: 2", async () => {
  const r = await fetch(`http://${HOST}:${PORT}/api/messages`, {
    method: "HEAD",
    redirect: "manual",
  });
  // HEAD MUST NOT carry a body per RFC 9110. We do NOT assert body bytes.
  // We DO assert that any body the runtime might surface is zero bytes — the
  // Response.body for HEAD is normally null/empty in node fetch.
  const buf = await r.arrayBuffer();
  assert.equal(r.status, 404, "D-17 HEAD: status");
  assert.equal(buf.byteLength, 0, "D-17 HEAD: body MUST be zero bytes");
  // The HEAD shape forbids these:
  assert.equal(r.headers.get("content-length"), null, "HEAD: no Content-Length: 2");
  assert.equal(r.headers.get("allow"), null, "HEAD: no Allow");
  assert.equal(r.headers.get("www-authenticate"), null, "HEAD: no WWW-Authenticate");
  assert.equal(
    r.headers.get("content-type"),
    null,
    "HEAD: no Content-Type: application/json (body is absent, not JSON-shaped)",
  );
  assertSixHeaders(r, "D-17 HEAD");
});

// ---------------------------------------------------------------------------
// D-0 no-auth: GET and POST
// ---------------------------------------------------------------------------

test("D-0 GET no-auth -> byte-identical 404 + {} + Day-1B headers", async () => {
  const { res, text } = await probe({
    method: "GET",
    path: `/api/messages?workspace_slug=${H.workspaceA.slug}&channel_id=${H.channelA1.id}`,
  });
  assertDeny(res, text, "D-0 GET");
});

test("D-0 POST no-auth -> byte-identical 404 + {} + Day-1B headers", async () => {
  const before = await countMessagesInChannel(H.channelA1.id);
  const { res, text } = await probe({
    method: "POST",
    path: "/api/messages",
    body: JSON.stringify({
      workspace_slug: H.workspaceA.slug,
      channel_id: H.channelA1.id,
      body: "should not insert",
    }),
  });
  assertDeny(res, text, "D-0 POST");
  const after = await countMessagesInChannel(H.channelA1.id);
  assert.equal(after, before, "D-0 POST: zero rows inserted");
});

// ---------------------------------------------------------------------------
// D-14 Origin/Host enforcement on POST
// ---------------------------------------------------------------------------

test("D-14 cross-origin POST -> byte-identical 404 + {} (NOT a redirect)", async () => {
  const before = await countMessagesInChannel(H.channelA1.id);
  const { res, text } = await probe({
    method: "POST",
    path: "/api/messages",
    cookie: memberCookie,
    overrideOrigin: "https://attacker.example",
    body: JSON.stringify({
      workspace_slug: H.workspaceA.slug,
      channel_id: H.channelA1.id,
      body: "cross-origin attempt",
    }),
  });
  assertDeny(res, text, "D-14 cross-origin POST");
  // Distinct contract from the Server Action: route handler does NOT redirect.
  assert.ok(
    res.status === 404,
    `D-14: route handler must NOT redirect (got ${res.status})`,
  );
  const after = await countMessagesInChannel(H.channelA1.id);
  assert.equal(after, before, "D-14: zero rows inserted");
});

test("D-14 missing Origin header POST -> byte-identical 404 + {}", async () => {
  const { res, text } = await probe({
    method: "POST",
    path: "/api/messages",
    cookie: memberCookie,
    overrideOrigin: null,
    body: JSON.stringify({
      workspace_slug: H.workspaceA.slug,
      channel_id: H.channelA1.id,
      body: "no origin",
    }),
  });
  assertDeny(res, text, "D-14 no-origin POST");
});

// Host-mismatch with same-origin-shape headers. The attacker writes a forged
// Host that matches the forged Origin so isSameOrigin alone would pass; the
// canonicalRedirectIfHostMismatch check (Host != SITE_ORIGIN.host) is the
// load-bearing defense here. Removing canonicalRedirectIfHostMismatch from
// route.ts makes this test go RED.
test("D-14 forged Host + matching Origin -> byte-identical 404 + {}", async () => {
  // Wire form: Host header forged to attacker.example AND Origin set to the
  // same forged host so isSameOrigin alone would pass. The defense that
  // fires is canonicalRedirectIfHostMismatch comparing Host against
  // SITE_ORIGIN.host. Removing canonicalRedirectIfHostMismatch from route.ts
  // would make this test RED — see the source-grep in
  // tests/auth/api-messages-deny-shape.spec.ts:D-15c source assertion for
  // the structural defense pattern.
  const payload = Buffer.from(
    JSON.stringify({
      workspace_slug: H.workspaceA.slug,
      channel_id: H.channelA1.id,
      body: "forged-host-attempt",
    }),
    "utf8",
  );
  const before = await countMessagesInChannel(H.channelA1.id);
  const r = await rawPost({
    path: "/api/messages",
    headers: [
      "Content-Type: application/json",
      `Content-Length: ${payload.byteLength}`,
    ],
    body: payload,
    cookie: memberCookie,
    hostOverride: "attacker.example",
    originOverride: "http://attacker.example",
  });
  assertRawDeny(r, "D-14 forged-host");
  const after = await countMessagesInChannel(H.channelA1.id);
  assert.equal(after, before, "D-14 forged-host: zero rows inserted");
});

// ---------------------------------------------------------------------------
// D-16 Content-Type enforcement on POST (must be BEFORE body read)
// ---------------------------------------------------------------------------

test("D-16 POST text/plain -> byte-identical 404 + {}", async () => {
  const { res, text } = await probe({
    method: "POST",
    path: "/api/messages",
    cookie: memberCookie,
    contentType: "text/plain",
    body: JSON.stringify({
      workspace_slug: H.workspaceA.slug,
      channel_id: H.channelA1.id,
      body: "x",
    }),
  });
  assertDeny(res, text, "D-16 text/plain POST");
});

test("D-16 POST no Content-Type -> byte-identical 404 + {}", async () => {
  const { res, text } = await probe({
    method: "POST",
    path: "/api/messages",
    cookie: memberCookie,
    contentType: null,
    body: JSON.stringify({
      workspace_slug: H.workspaceA.slug,
      channel_id: H.channelA1.id,
      body: "x",
    }),
  });
  assertDeny(res, text, "D-16 no-content-type POST");
});

test("D-16 POST application/json; charset=utf-8 -> NOT a D-16 deny (charset suffix OK)", async () => {
  // Body shape is otherwise valid; this is a positive POST. Verifies that
  // the content-type check does NOT reject the canonical charset suffix.
  const before = await countMessagesInChannel(H.channelA1.id);
  const { res, text } = await probe({
    method: "POST",
    path: "/api/messages",
    cookie: memberCookie,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify({
      workspace_slug: H.workspaceA.slug,
      channel_id: H.channelA1.id,
      body: "charset-suffix-ok",
    }),
  });
  assert.equal(res.status, 201, `expected 201 with charset suffix, got ${res.status}: ${text}`);
  const after = await countMessagesInChannel(H.channelA1.id);
  assert.equal(after, before + 1, "charset suffix should not block the insert");
});

// ---------------------------------------------------------------------------
// D-15 oversize body (three variants).
//
// Load-bearing property: route.ts:readBodyWithCap counts actual bytes streamed
// (NOT Content-Length) and aborts above MAX_BODY_BYTES. Each variant below
// sends SYNTACTICALLY VALID JSON whose total bytes exceed MAX_BODY_BYTES
// AND whose shape would otherwise pass channel-guard + insert. If a future
// edit removes the byte counter, the handler will read the full body,
// parse the valid JSON, pass the guard, and INSERT a row — making the
// zero-rows post-condition assertion FAIL. The byte-identical 404 + {}
// status/body/header assertion is the primary contract; zero-rows is the
// regression alarm.
// ---------------------------------------------------------------------------

// Build a syntactically valid JSON payload whose total bytes exceed
// MAX_BODY_BYTES (4096) and whose shape (workspace_slug + channel_id + body
// + client_nonce) would be accepted by the route handler's destructure +
// channel guard if the byte cap were missing.
function makeOversizeValidJson(): string {
  return JSON.stringify({
    workspace_slug: H.workspaceA.slug,
    channel_id: H.channelA1.id,
    body: "x".repeat(5000),
    client_nonce: "n",
  });
}

test("D-15a honest Content-Length oversize (valid JSON) -> byte-identical 404 + {}", async () => {
  const payload = makeOversizeValidJson();
  assert.ok(payload.length > 4096, `payload must exceed cap; got ${payload.length}`);
  const before = await countMessagesInChannel(H.channelA1.id);
  const { res, text } = await probe({
    method: "POST",
    path: "/api/messages",
    cookie: memberCookie,
    body: payload,
  });
  assertDeny(res, text, "D-15a honest oversize");
  const after = await countMessagesInChannel(H.channelA1.id);
  assert.equal(after, before, "D-15a: zero rows inserted");
});

test("D-15b chunked, no Content-Length, valid JSON oversize -> byte-identical 404 + {}", async () => {
  const payload = makeOversizeValidJson();
  assert.ok(payload.length > 4096, `payload must exceed cap; got ${payload.length}`);
  // Split into smaller chunks to prove the byte counter accumulates across
  // multiple stream reads.
  const chunkSize = 1500;
  let body = "";
  for (let i = 0; i < payload.length; i += chunkSize) {
    const piece = payload.slice(i, i + chunkSize);
    body += `${piece.length.toString(16)}\r\n${piece}\r\n`;
  }
  body += "0\r\n\r\n";
  const before = await countMessagesInChannel(H.channelA1.id);
  const r = await rawPost({
    path: "/api/messages",
    headers: [
      "Content-Type: application/json",
      "Transfer-Encoding: chunked",
    ],
    body: Buffer.from(body, "utf8"),
    cookie: memberCookie,
  });
  assertRawDeny(r, "D-15b chunked-no-CL oversize");
  const after = await countMessagesInChannel(H.channelA1.id);
  assert.equal(after, before, "D-15b: zero rows inserted");
});

// D-15c — lying Content-Length oversize. Two-pronged proof:
//
// (a) Runtime probe: TE: chunked + CL: <bogus undercount>. Per RFC 9112 §6.3,
//     if both are present, recipients MUST either close the connection
//     (request smuggling defense) OR remove CL and read via TE. Modern Node
//     HTTP servers default to the close/reject path. So this concrete wire
//     form is REJECTED at the parser layer, BEFORE the handler runs — Node
//     emits a deny status (4xx) without reaching the route handler. We
//     assert the deny + zero-rows outcome to prove the attack vector
//     produces no insert regardless of whether the handler ran.
//
// (b) Source assertion: HTTP/1.1 framing semantics make "lying CL where
//     stream actually exceeds CL" structurally impossible — the server
//     reads exactly CL bytes from the wire and discards the surplus, so
//     no possible wire-level shape can deliver MORE bytes than CL declares
//     to the handler. The defense the slice contract actually wants
//     ("handler does NOT trust Content-Length for size decisions") is
//     enforced by readBodyWithCap operating on the actual byte stream and
//     ignoring req.headers.get("content-length"). The source assertion
//     below greps route.ts to enforce that load-bearing property.
test("D-15c lying-Content-Length: wire-level deny + zero rows", async () => {
  const payload = makeOversizeValidJson();
  assert.ok(payload.length > 4096, `payload must exceed cap; got ${payload.length}`);
  const chunkSize = 1500;
  let body = "";
  for (let i = 0; i < payload.length; i += chunkSize) {
    const piece = payload.slice(i, i + chunkSize);
    body += `${piece.length.toString(16)}\r\n${piece}\r\n`;
  }
  body += "0\r\n\r\n";
  const before = await countMessagesInChannel(H.channelA1.id);
  const r = await rawPost({
    path: "/api/messages",
    headers: [
      "Content-Type: application/json",
      "Transfer-Encoding: chunked",
      "Content-Length: 5", // lying undercount; per RFC 9112 §6.3 must be ignored or rejected
    ],
    body: Buffer.from(body, "utf8"),
    cookie: memberCookie,
  });
  assert.ok(
    r.status >= 400 && r.status < 500,
    `D-15c wire-level: expected deny (4xx), got ${r.status}`,
  );
  const after = await countMessagesInChannel(H.channelA1.id);
  assert.equal(after, before, "D-15c wire-level: zero rows inserted");
});

test("D-15c lying-Content-Length: source assertion (no CL-trust in route.ts)", async () => {
  // Structural proof: the handler does not branch on Content-Length for size
  // decisions. readBodyWithCap is the single byte-counter; Content-Length is
  // never read for body cap. If a future edit makes the handler consult
  // Content-Length, this assertion goes RED.
  const fs = await import("node:fs/promises");
  const src = await fs.readFile(
    new URL("../../app/api/messages/route.ts", import.meta.url),
    "utf8",
  );
  // Permitted: setting the Content-Type response header (constant string).
  // Forbidden: reading the request's content-length header for any branch.
  const forbidden = /req\.headers\.get\(\s*["']content-length["']\s*\)/i;
  assert.ok(
    !forbidden.test(src),
    "route.ts MUST NOT read request Content-Length for size decisions",
  );
  // Must use a hard byte counter inside readBodyWithCap (proves the cap path
  // does not trust framing-declared length).
  assert.ok(
    /readBodyWithCap/.test(src),
    "route.ts MUST call readBodyWithCap to count actual stream bytes",
  );
  assert.ok(
    /total\s*\+\s*=\s*value\.byteLength/.test(src),
    "readBodyWithCap MUST count actual byte lengths from the stream",
  );
});

// ---------------------------------------------------------------------------
// D-10 invalid JSON
// ---------------------------------------------------------------------------

test("D-10 invalid JSON POST -> byte-identical 404 + {}", async () => {
  const { res, text } = await probe({
    method: "POST",
    path: "/api/messages",
    cookie: memberCookie,
    body: "{not-json",
  });
  assertDeny(res, text, "D-10 invalid JSON");
});

// ---------------------------------------------------------------------------
// D-11 / D-12 / D-13 missing / wrong shape
// ---------------------------------------------------------------------------

test("D-11 POST missing workspace_slug -> byte-identical 404 + {}", async () => {
  const { res, text } = await probe({
    method: "POST",
    path: "/api/messages",
    cookie: memberCookie,
    body: JSON.stringify({ channel_id: H.channelA1.id, body: "x" }),
  });
  assertDeny(res, text, "D-11 missing slug");
});

test("D-12 POST missing channel_id -> byte-identical 404 + {}", async () => {
  const { res, text } = await probe({
    method: "POST",
    path: "/api/messages",
    cookie: memberCookie,
    body: JSON.stringify({ workspace_slug: H.workspaceA.slug, body: "x" }),
  });
  assertDeny(res, text, "D-12 POST missing channel_id");
});

test("D-12 GET missing channel_id -> byte-identical 404 + {}", async () => {
  const { res, text } = await probe({
    method: "GET",
    path: `/api/messages?workspace_slug=${H.workspaceA.slug}`,
    cookie: memberCookie,
  });
  assertDeny(res, text, "D-12 GET missing channel_id");
});

test("D-13 POST empty body string -> byte-identical 404 + {}", async () => {
  const { res, text } = await probe({
    method: "POST",
    path: "/api/messages",
    cookie: memberCookie,
    body: JSON.stringify({
      workspace_slug: H.workspaceA.slug,
      channel_id: H.channelA1.id,
      body: "",
    }),
  });
  assertDeny(res, text, "D-13 empty body");
});

test("D-13 POST non-string body -> byte-identical 404 + {}", async () => {
  const { res, text } = await probe({
    method: "POST",
    path: "/api/messages",
    cookie: memberCookie,
    body: JSON.stringify({
      workspace_slug: H.workspaceA.slug,
      channel_id: H.channelA1.id,
      body: 123,
    }),
  });
  assertDeny(res, text, "D-13 non-string body");
});

// ---------------------------------------------------------------------------
// D-1 / D-2 shape rejection
// ---------------------------------------------------------------------------

test("D-1 GET invalid UUID channel_id -> byte-identical 404 + {}", async () => {
  const { res, text } = await probe({
    method: "GET",
    path: `/api/messages?workspace_slug=${H.workspaceA.slug}&channel_id=not-a-uuid`,
    cookie: memberCookie,
  });
  assertDeny(res, text, "D-1 GET");
});

test("D-1 POST invalid UUID channel_id -> byte-identical 404 + {}", async () => {
  const { res, text } = await probe({
    method: "POST",
    path: "/api/messages",
    cookie: memberCookie,
    body: JSON.stringify({
      workspace_slug: H.workspaceA.slug,
      channel_id: "not-a-uuid",
      body: "x",
    }),
  });
  assertDeny(res, text, "D-1 POST");
});

test("D-2 GET invalid slug -> byte-identical 404 + {}", async () => {
  const slug = encodeURIComponent("Invalid Slug");
  const { res, text } = await probe({
    method: "GET",
    path: `/api/messages?workspace_slug=${slug}&channel_id=${H.channelA1.id}`,
    cookie: memberCookie,
  });
  assertDeny(res, text, "D-2 GET");
});

// ---------------------------------------------------------------------------
// D-3 / D-4 / D-5 / D-6 / D-7 DB-layer denials (authenticated)
// ---------------------------------------------------------------------------

test("D-3 GET unknown workspace -> byte-identical 404 + {}", async () => {
  const { res, text } = await probe({
    method: "GET",
    path: `/api/messages?workspace_slug=ghost-workspace-${H.runId}&channel_id=${H.channelA1.id}`,
    cookie: memberCookie,
  });
  assertDeny(res, text, "D-3 GET unknown workspace");
});

test("D-4 GET foreign workspace (user in A, channel in B) -> byte-identical 404 + {}", async () => {
  // Member IS in workspaceA. channelB1 lives in workspaceB. The user-scoped
  // workspaces lookup for workspaceA.slug succeeds, but the channel lookup
  // pinned to workspace_id=workspaceA.id will not find channelB1.
  const { res, text } = await probe({
    method: "GET",
    path: `/api/messages?workspace_slug=${H.workspaceA.slug}&channel_id=${H.channelB1.id}`,
    cookie: memberCookie,
  });
  assertDeny(res, text, "D-4 GET cross-workspace");
});

test("D-5 GET unknown channel UUID -> byte-identical 404 + {}", async () => {
  // Valid UUID shape, no row.
  const ghost = "00000000-0000-0000-0000-000000000000";
  const { res, text } = await probe({
    method: "GET",
    path: `/api/messages?workspace_slug=${H.workspaceA.slug}&channel_id=${ghost}`,
    cookie: memberCookie,
  });
  assertDeny(res, text, "D-5 GET unknown channel");
});

test("D-6 GET workspace-only member (not in channel) -> byte-identical 404 + {}", async () => {
  // workspaceOnlyMember is in workspaceA's workspace_members but is NOT a
  // channel_members row of channelA1. Indistinguishable from D-5/D-4/D-7.
  const wsOnlyCookie = await captureSessionCookies(
    H.workspaceOnlyMember.email,
    H.workspaceOnlyMember.password,
  );
  const { res, text } = await probe({
    method: "GET",
    path: `/api/messages?workspace_slug=${H.workspaceA.slug}&channel_id=${H.channelA1.id}`,
    cookie: wsOnlyCookie,
  });
  assertDeny(res, text, "D-6 GET workspace-only");
});

test("D-7 GET channel in workspace user is not member of -> byte-identical 404 + {}", async () => {
  // nonMember is not in workspaceA. workspaceA-scoped lookup returns null
  // (RLS filters the workspace row) → D-3 collapse path. Indistinguishable
  // from D-3.
  const nonMemberCookie = await captureSessionCookies(
    H.nonMember.email,
    H.nonMember.password,
  );
  const { res, text } = await probe({
    method: "GET",
    path: `/api/messages?workspace_slug=${H.workspaceA.slug}&channel_id=${H.channelA1.id}`,
    cookie: nonMemberCookie,
  });
  assertDeny(res, text, "D-7 GET non-member of workspace");
});

// --- D-3..D-7 POST variants -----------------------------------------------
//
// Each POST variant uses a valid JSON body that would otherwise be accepted
// by destructure + shape validation; the deny fires inside
// withRouteLocalChannelGuard. Each variant asserts byte-identical 404 + {}
// + Day-1B headers AND zero rows inserted in any channel the body targets.

test("D-3 POST unknown workspace -> byte-identical 404 + {}", async () => {
  const before = await countMessagesInChannel(H.channelA1.id);
  const { res, text } = await probe({
    method: "POST",
    path: "/api/messages",
    cookie: memberCookie,
    body: JSON.stringify({
      workspace_slug: `ghost-workspace-${H.runId}`,
      channel_id: H.channelA1.id,
      body: "must-not-insert",
    }),
  });
  assertDeny(res, text, "D-3 POST unknown workspace");
  const after = await countMessagesInChannel(H.channelA1.id);
  assert.equal(after, before, "D-3 POST: zero rows inserted");
});

test("D-4 POST foreign workspace (user in A, channel in B) -> byte-identical 404 + {}", async () => {
  // Member IS in workspaceA AND IS in channelB1's channel_members, BUT
  // channelB1 lives in workspaceB. workspace_id correlation in the channel
  // lookup pins workspace_id=workspaceA.id, so channelB1 is filtered out.
  const beforeA = await countMessagesInChannel(H.channelA1.id);
  const beforeB = await countMessagesInChannel(H.channelB1.id);
  const { res, text } = await probe({
    method: "POST",
    path: "/api/messages",
    cookie: memberCookie,
    body: JSON.stringify({
      workspace_slug: H.workspaceA.slug,
      channel_id: H.channelB1.id,
      body: "cross-workspace-attempt",
    }),
  });
  assertDeny(res, text, "D-4 POST cross-workspace");
  const afterA = await countMessagesInChannel(H.channelA1.id);
  const afterB = await countMessagesInChannel(H.channelB1.id);
  assert.equal(afterA, beforeA, "D-4 POST: zero rows in workspaceA channel");
  assert.equal(afterB, beforeB, "D-4 POST: zero rows in workspaceB channel");
});

test("D-5 POST unknown channel UUID -> byte-identical 404 + {}", async () => {
  const ghost = "00000000-0000-0000-0000-000000000000";
  const { res, text } = await probe({
    method: "POST",
    path: "/api/messages",
    cookie: memberCookie,
    body: JSON.stringify({
      workspace_slug: H.workspaceA.slug,
      channel_id: ghost,
      body: "ghost-channel-attempt",
    }),
  });
  assertDeny(res, text, "D-5 POST unknown channel");
  const ghostCount = await H.admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", ghost);
  assert.equal(ghostCount.count ?? 0, 0, "D-5 POST: zero rows in ghost channel");
});

test("D-6 POST workspace-only member (not in channel) -> byte-identical 404 + {}", async () => {
  const wsOnlyCookie = await captureSessionCookies(
    H.workspaceOnlyMember.email,
    H.workspaceOnlyMember.password,
  );
  const before = await countMessagesInChannel(H.channelA1.id);
  const beforeByUser = await H.admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", H.workspaceOnlyMember.userId);
  const { res, text } = await probe({
    method: "POST",
    path: "/api/messages",
    cookie: wsOnlyCookie,
    body: JSON.stringify({
      workspace_slug: H.workspaceA.slug,
      channel_id: H.channelA1.id,
      body: "workspace-only-attempt",
    }),
  });
  assertDeny(res, text, "D-6 POST workspace-only");
  const after = await countMessagesInChannel(H.channelA1.id);
  const afterByUser = await H.admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", H.workspaceOnlyMember.userId);
  assert.equal(after, before, "D-6 POST: zero rows in target channel");
  assert.equal(
    afterByUser.count ?? 0,
    beforeByUser.count ?? 0,
    "D-6 POST: zero rows attributed to workspaceOnlyMember anywhere",
  );
});

test("D-7 POST channel in workspace user is not member of -> byte-identical 404 + {}", async () => {
  const nonMemberCookie = await captureSessionCookies(
    H.nonMember.email,
    H.nonMember.password,
  );
  const before = await countMessagesInChannel(H.channelA1.id);
  const beforeByUser = await H.admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", H.nonMember.userId);
  const { res, text } = await probe({
    method: "POST",
    path: "/api/messages",
    cookie: nonMemberCookie,
    body: JSON.stringify({
      workspace_slug: H.workspaceA.slug,
      channel_id: H.channelA1.id,
      body: "non-member-attempt",
    }),
  });
  assertDeny(res, text, "D-7 POST non-member of workspace");
  const after = await countMessagesInChannel(H.channelA1.id);
  const afterByUser = await H.admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", H.nonMember.userId);
  assert.equal(after, before, "D-7 POST: zero rows in target channel");
  assert.equal(
    afterByUser.count ?? 0,
    beforeByUser.count ?? 0,
    "D-7 POST: zero rows attributed to nonMember anywhere",
  );
});

// ---------------------------------------------------------------------------
// Positive 200 / 201 + adversarial forged user_id
// ---------------------------------------------------------------------------

test("positive GET 200 -> JSON body with messages and Day-1B headers", async () => {
  const { res, text } = await probe({
    method: "GET",
    path: `/api/messages?workspace_slug=${H.workspaceA.slug}&channel_id=${H.channelA1.id}`,
    cookie: memberCookie,
  });
  assert.equal(res.status, 200, `GET positive: status (body: ${text})`);
  assert.equal(res.headers.get("content-type")?.split(";")[0], "application/json");
  assertSixHeaders(res, "positive GET");
  const parsed = JSON.parse(text) as { messages: Array<{ id: string; body: string }> };
  assert.ok(Array.isArray(parsed.messages), "GET body must contain messages: []");
  // The seed message inserted by the harness should be visible to member.
  const seedRow = parsed.messages.find((m) => m.id === H.seedMessage.id);
  assert.ok(seedRow, "seed message must be readable by channel member");
});

test("positive POST 201 -> message row with server-derived user_id + client_nonce roundtrip", async () => {
  const nonce = `n-${Math.random().toString(36).slice(2)}`;
  const body = `hello-${Math.random().toString(36).slice(2)}`;
  const before = await countMessagesInChannel(H.channelA1.id);
  const { res, text } = await probe({
    method: "POST",
    path: "/api/messages",
    cookie: memberCookie,
    body: JSON.stringify({
      workspace_slug: H.workspaceA.slug,
      channel_id: H.channelA1.id,
      body,
      client_nonce: nonce,
    }),
  });
  assert.equal(res.status, 201, `POST positive: status (body: ${text})`);
  assertSixHeaders(res, "positive POST");
  const parsed = JSON.parse(text) as {
    message: { user_id: string; body: string; client_nonce: string | null };
  };
  assert.equal(parsed.message.user_id, H.member.userId, "user_id must be session user");
  assert.equal(parsed.message.body, body, "body must round-trip");
  assert.equal(parsed.message.client_nonce, nonce, "client_nonce must round-trip");
  const after = await countMessagesInChannel(H.channelA1.id);
  assert.equal(after, before + 1, "POST: exactly one row inserted");
});

test("adversarial forged user_id is ignored or denied -> NEVER accepted", async () => {
  const forged = "11111111-1111-1111-1111-111111111111";
  const body = `forge-${Math.random().toString(36).slice(2)}`;
  const { res, text } = await probe({
    method: "POST",
    path: "/api/messages",
    cookie: memberCookie,
    body: JSON.stringify({
      workspace_slug: H.workspaceA.slug,
      channel_id: H.channelA1.id,
      body,
      user_id: forged,
    }),
  });
  // Acceptable outcomes: 201 with server-derived user_id, OR byte-identical deny.
  // NEVER acceptable: 201 with the forged user_id.
  if (res.status === 201) {
    const parsed = JSON.parse(text) as { message: { user_id: string } };
    assert.notEqual(
      parsed.message.user_id,
      forged,
      "forged user_id MUST NOT be honored",
    );
    assert.equal(
      parsed.message.user_id,
      H.member.userId,
      "user_id must be session user, not forged value",
    );
  } else {
    assertDeny(res, text, "adversarial forged user_id (deny path)");
  }
});
