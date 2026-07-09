#!/usr/bin/env bash
# ALCHEMY_PASSWORD encrypts local alchemy state. Every CI run starts on a
# fresh runner with nothing to decrypt, so a random password per run is
# fine. Mask it before it reaches $GITHUB_ENV or the logs. Run from the repo
# root (used by e2e-deploy.yml before any working-directory is set).
set -euo pipefail

password="$(openssl rand -hex 24)"
echo "::add-mask::$password"
echo "ALCHEMY_PASSWORD=$password" >> "$GITHUB_ENV"
