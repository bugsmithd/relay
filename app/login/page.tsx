export const dynamic = "force-dynamic";
export const revalidate = 0;

import { sendMagicLinkAction } from "./actions";

type LoginSearchParams = { redirect_to?: string; sent?: string; error?: string };

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<LoginSearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const sent = sp.sent === "1";
  const error = sp.error;
  return (
    <main>
      <h1>Sign in to Relay</h1>
      {error ? <p role="alert">Sign-in error: {error}</p> : null}
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
