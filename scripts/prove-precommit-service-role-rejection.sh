#!/usr/bin/env sh
# Proves that staging a service-role read outside lib/supabase/admin.ts is
# rejected by the pre-commit gate. Stages a synthetic file in a tmp index,
# runs the hook, and asserts non-zero. Cleans up the staged path.
set -eu

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

FIXTURE="tmp/_precommit-fixture/leak.ts"
mkdir -p "$(dirname "$FIXTURE")"
cat >"$FIXTURE" <<'EOF'
// synthetic violation
const x = process.env.SUPABASE_SERVICE_ROLE;
console.log(x);
EOF

cleanup() {
  git reset -q HEAD -- "$FIXTURE" 2>/dev/null || true
  rm -rf tmp/_precommit-fixture
}
trap cleanup EXIT INT TERM

git add -- "$FIXTURE"

set +e
sh scripts/precommit.sh
status=$?
set -e

if [ "$status" -eq 0 ]; then
  echo "FAIL: pre-commit accepted service-role violation" >&2
  exit 1
fi

echo "OK: pre-commit rejected service-role violation (exit=$status)"
exit 0
