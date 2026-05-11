#!/usr/bin/env sh
# Local pre-commit gate. CAN be bypassed via --no-verify; ground truth is
# server-side `make governance-check` (Day 2B). This catches the easy cases.
set -eu

# 1. service-role outside admin.ts
staged_violations="$(
  git diff --cached --name-only --diff-filter=ACMR \
    | grep -E '\.(ts|tsx|js|mjs|cjs)$' \
    | grep -vE '^(lib/supabase/admin\.ts|scripts/lib/seed-guards\.ts|scripts/seed\.ts|scripts/seed-cleanup\.mjs|scripts/check-bundle-leak\.mjs|scripts/test-bundle-leak-fixture\.mjs|tests/|semgrep/repo-law/fixtures/)' \
    | xargs -I{} sh -c 'grep -lE "SUPABASE_SERVICE_ROLE" "{}" 2>/dev/null || true' \
    || true
)"

if [ -n "${staged_violations:-}" ]; then
  echo "pre-commit: SUPABASE_SERVICE_ROLE found outside lib/supabase/admin.ts:" >&2
  echo "${staged_violations}" >&2
  exit 1
fi

# 2. dangerouslySetInnerHTML in staged .ts/.tsx (Day 1B XSS gate).
# Same exclusion shape as semgrep/repo-law/dangerous-html.yml paths.exclude.
staged_xss_violations="$(
  git diff --cached --name-only --diff-filter=ACMR \
    | grep -E '\.(ts|tsx)$' \
    | grep -vE '^(tests/|semgrep/repo-law/fixtures/|evidence/|docs/|\.claude/|\.planning/)' \
    | xargs -I{} sh -c 'grep -lE "dangerouslySetInnerHTML" "{}" 2>/dev/null || true' \
    || true
)"

if [ -n "${staged_xss_violations:-}" ]; then
  echo "pre-commit: dangerouslySetInnerHTML found in staged .ts/.tsx:" >&2
  echo "${staged_xss_violations}" >&2
  exit 1
fi

exit 0
