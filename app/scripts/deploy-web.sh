#!/usr/bin/env bash
# Builds the web app (listener app + host website) and deploys it to the
# Vercel project "podcast-jpm-host": https://podcast-jpm-host.vercel.app
#
#   ./scripts/deploy-web.sh          # production
#   ./scripts/deploy-web.sh preview  # preview URL only
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf dist
EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-https://podcast-jpm.vercel.app}" npx expo export -p web

# Vercel's CLI never uploads folders named node_modules, and Expo puts some
# assets there (the icon fonts), so they'd be missing and every icon would
# show as an empty box. Move them and point the bundle at the new place.
if [ -d dist/assets/node_modules ]; then
  mv dist/assets/node_modules dist/assets/nm
  grep -rl 'assets/node_modules/' dist | xargs perl -pi -e 's#assets/node_modules/#assets/nm/#g'
fi

# Single-page app: every path serves index.html (real files still win).
cat > dist/vercel.json <<'JSON'
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
JSON

# Deploy by project id rather than `vercel link`, which would write a
# .env.local with a token into the folder being published.
export VERCEL_ORG_ID="${VERCEL_ORG_ID:-team_5vHXy2pZSY24QRwdr7RngXWG}"
export VERCEL_PROJECT_ID="${VERCEL_PROJECT_ID:-prj_b3Y5Q19BaALO2HORGqmrVc3bYqyb}"
if [ "${1:-prod}" = "preview" ]; then
  npx vercel@latest deploy dist --yes
else
  npx vercel@latest deploy dist --prod --yes
fi
