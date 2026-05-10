export const dynamic = "force-dynamic";
export const revalidate = 0;

import { sendMagicLinkAction } from "./actions";

type LoginSearchParams = { redirect_to?: string; sent?: string; error?: string };

// Operator-readable error messages keyed by ?error=<code>. The action layer
// only sets short codes (host, origin, otp); rendering the sentence here
// keeps the action layer free of UI copy. Unknown codes render nothing —
// the `error` query param is user-controllable, so we never echo it back.
const ERROR_MESSAGES: Record<string, string> = {
  host: "Sign-in only works on the canonical app origin. We brought you here — please try again.",
  origin: "Cross-origin sign-in attempt was rejected. Reload this page and try again.",
  otp: "We could not send the magic link. Try again in a moment.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<LoginSearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const sent = sp.sent === "1";
  const errorMessage = sp.error ? ERROR_MESSAGES[sp.error] ?? null : null;
  return (
    <main>
      <h1>Sign in to Relay</h1>
      {errorMessage ? <p role="alert">{errorMessage}</p> : null}
      {sent ? (
        <p>Check your email for a magic link.</p>
      ) : (
        <form action={sendMagicLinkAction}>
          <input type="hidden" name="redirect_to" value={sp.redirect_to ?? "/"} />
          <label>
            Email
            <input type="email" name="email" required autoComplete="email" />
          </label>
          <button type="submit">Send magic link</button>
        </form>
      )}
    </main>
  );
}
