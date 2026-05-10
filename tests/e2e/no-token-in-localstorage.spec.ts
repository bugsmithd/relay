import { test, expect } from "./lib/seed-fixture.ts";
import { signInProgrammatically } from "./lib/auth-helper.ts";

const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

test("no JWT-shaped value in localStorage after sign-in + workspace load", async ({
  context,
  page,
  baseURL,
  seed,
}) => {
  await signInProgrammatically(context, baseURL!, seed.member.email, seed.member.password);
  await page.goto(`${baseURL}/w/${seed.workspaceA.slug}`);

  const offenders = await page.evaluate((re) => {
    const out: { key: string; value: string }[] = [];
    const pat = new RegExp(re);
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      const v = window.localStorage.getItem(k);
      if (v && pat.test(v)) out.push({ key: k, value: v.slice(0, 20) + "..." });
    }
    return out;
  }, JWT_RE.source);

  expect(offenders, `JWT-shaped values in localStorage: ${JSON.stringify(offenders)}`).toEqual([]);
});
