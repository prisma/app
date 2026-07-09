#!/usr/bin/env bash
# Shared destroy guard for e2e-deploy.yml's cleanup steps (always-on, so it
# also runs after a failed deploy). Alchemy state is local to the runner: if
# a .alchemy dir was never written, deploy never started, and running
# `makerkit destroy` would just fail looking for state that doesn't exist.
# Used by both the storefront-auth and hello destroy steps.
#
# Usage: destroy-guard.sh <no-deploy-label> <entry-file> <stack-name>
# <no-deploy-label> is prefixed to "deploy never started" in the skip
# message (e.g. "hello " for hello, "" for storefront-auth).
set -euo pipefail

label="$1"
entry="$2"
stack_name="$3"

if [ ! -d .alchemy ]; then
  echo "No .alchemy state dir — ${label}deploy never started, nothing to destroy."
  exit 0
fi

bun node_modules/.bin/makerkit destroy "$entry" --name "$stack_name"
