// Mailpit (Inbucket replacement) helper for the local Supabase stack.
// API docs: GET /api/v1/messages, GET /api/v1/message/{id}.
// We poll for the latest message addressed TO `recipient`, then extract the
// magic-link `<a href="...">Log In</a>` URL.

import { setTimeout as delay } from "node:timers/promises";

const MAILPIT_BASE = "http://127.0.0.1:54324";

type MailpitMessageSummary = {
  ID: string;
  Created: string;
  To: { Address: string }[];
  Subject: string;
};

type MailpitMessageDetail = {
  HTML: string;
  Text: string;
};

export async function deleteAllMail(): Promise<void> {
  const r = await fetch(`${MAILPIT_BASE}/api/v1/messages`, { method: "DELETE" });
  if (!r.ok) throw new Error(`mailpit delete-all failed: ${r.status}`);
}

export async function waitForMessageTo(
  recipient: string,
  timeoutMs = 15_000,
): Promise<MailpitMessageDetail> {
  const deadline = Date.now() + timeoutMs;
  const recipientLc = recipient.toLowerCase();
  while (Date.now() < deadline) {
    const r = await fetch(`${MAILPIT_BASE}/api/v1/messages`);
    if (!r.ok) throw new Error(`mailpit list failed: ${r.status}`);
    const body = (await r.json()) as { messages: MailpitMessageSummary[] };
    const hit = body.messages.find((m) =>
      m.To.some((t) => t.Address.toLowerCase() === recipientLc),
    );
    if (hit) {
      const dr = await fetch(`${MAILPIT_BASE}/api/v1/message/${hit.ID}`);
      if (!dr.ok) throw new Error(`mailpit detail failed: ${dr.status}`);
      return (await dr.json()) as MailpitMessageDetail;
    }
    await delay(250);
  }
  throw new Error(`mailpit: no message to ${recipient} within ${timeoutMs}ms`);
}

// Extract the first <a href="..."> with a path of /auth/v1/verify (Supabase's
// magic-link template renders exactly one such anchor).
export function extractMagicLink(detail: MailpitMessageDetail): string {
  const html = detail.HTML ?? "";
  const re = /<a[^>]+href="([^"]*\/auth\/v1\/verify[^"]*)"/i;
  const m = re.exec(html);
  if (!m) {
    // Do NOT echo any portion of the body: even a 200-char head can leak the
    // /auth/v1/verify token, redirect_to, or PKCE code if the regex misses
    // for a different reason than "no anchor present" (e.g. attribute order).
    // Surface only the minimum diagnostic facts.
    const anchors = (html.match(/<a\b/gi) ?? []).length;
    throw new Error(
      `magic-link not found: body bytes=${html.length}, anchor_count=${anchors}`,
    );
  }
  // Mailpit HTML escapes `&` to `&amp;` inside attribute values; un-escape so
  // browsers / fetch can use the URL directly.
  return m[1].replace(/&amp;/g, "&");
}
