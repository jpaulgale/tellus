#!/usr/bin/env bash
# Copies the worker's secrets from the environment (Amp project secrets in an orb) into
# .dev.vars, which is where `wrangler dev` reads them. Keys already in .dev.vars are kept.
set -euo pipefail
cd "$(dirname "$0")/.."
touch .dev.vars
for key in TYPESAFE_API_KEY GEMINI_API_KEY MAPBOX_TOKEN SEND_WEBHOOK_URL; do
  [ -n "${!key:-}" ] || continue
  grep -q "^$key=" .dev.vars && continue
  printf '%s=%s\n' "$key" "${!key}" >> .dev.vars
done
