export const dynamic = "force-dynamic";
export const revalidate = 0;

import { sendMagicLinkAction } from "./actions";

export default function LoginPage({
  searchParams,
}: {
  searchParams?: { redirect_to?: string; sent?: string };
}) {
  const sent = searchParams?.sent === "1";
  return (
    <main>
      <h1>Sign in to Relay</h1>
      {sent ? (
        <p>Check your email for a magic link.</p>
      ) : (
        <form action={sendMagicLinkAction}>
          <input type="hidden" name="redirect_to" value={searchParams?.redirect_to ?? "/"} />
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
