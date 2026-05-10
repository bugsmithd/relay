# Relay Day 1A Makefile.
# Day 1B/2 targets land later. Do not add stop-condition targets that don't exist.

SHELL := /usr/bin/env bash
NODE ?= node
PNPM ?= pnpm
SEMGREP ?= semgrep

.PHONY: help fast-check repo-law tools-version-check ajv-schemas

help:
	@echo "Targets: fast-check repo-law tools-version-check ajv-schemas"

# fast-check = lightweight gate: typecheck + ajv schema validation.
# Heavier checks (build, semgrep, governance) live in dedicated targets.
fast-check: ajv-schemas
	$(PNPM) typecheck

repo-law:
	# Positive: fixture rule (no paths.exclude) MUST fire on the test fixture.
	# semgrep exit 1 = findings; exit 0 here is a failure.
	@out=$$($(SEMGREP) scan --quiet --no-git-ignore --error \
	  --config semgrep/repo-law/fixtures/service-role-boundary.yml \
	  semgrep/repo-law/fixtures/service-role-boundary.test.ts 2>&1); \
	  status=$$?; \
	  echo "$$out"; \
	  if [ $$status -eq 0 ]; then \
	    echo "repo-law: positive fixture did not fire" >&2; exit 1; \
	  fi
	# Negative: repo scan must NOT fire (real rule has paths.exclude).
	$(SEMGREP) scan --error --quiet --no-git-ignore \
	  --config semgrep/repo-law/service-role-boundary.yml \
	  --exclude semgrep/repo-law/fixtures \
	  --exclude node_modules \
	  --exclude .next \
	  --exclude evidence \
	  .

tools-version-check:
	$(NODE) scripts/check-tools-versions.mjs

ajv-schemas:
	$(PNPM) exec ajv validate --spec=draft2020 \
	  -s evidence/trust-boundary-paths.schema.json \
	  -d evidence/trust-boundary-paths.json \
	  --strict=true --all-errors
	# Validate any manifest.json under evidence/runs/* if present.
	@for m in $$(ls evidence/runs/*/manifest.json 2>/dev/null); do \
	  echo "ajv: $$m"; \
	  $(PNPM) exec ajv validate --spec=draft2020 -c ajv-formats \
	    -s evidence/manifest.schema.json -d $$m \
	    --strict=true --all-errors || exit 1; \
	done
