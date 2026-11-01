#!/usr/bin/env bash
# Deploy your working copy to the DEV site (worker web, D1 cougars-dev) on
# the Cougars Dev Cloudflare account, with sample content (DEMO_CONTENT) and noindex.
# Production (`web`, Cougars account) only deploys from `release` via
# .github/workflows/deploy.yml (docs/adr/0010-environments-and-deploys.md).
#
#   node scripts/env-pull.mjs -- bash scripts/deploy-dev.sh
set -euo pipefail
cd "$(dirname "$0")/.."

: "${CLOUDFLARE_API_TOKEN:?run through scripts/env-pull.mjs (docs/secrets.md)}"
: "${CLOUDFLARE_ACCOUNT_ID:?run through scripts/env-pull.mjs (docs/secrets.md)}"

subdomain=$(curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).result?.subdomain??""))' || true)
export SITE_URL="https://web.${subdomain:-example}.workers.dev"
export DEMO_CONTENT=true
# A dev build: the DEV corner ribbon, not LOCAL (packages/shared/ribbon.ts)
export SITE_ENV=dev
export PUBLIC_BUILD_VERSION="dev-$(git rev-parse --short HEAD)"

npm run build
node scripts/ci/target.mjs dev
(cd apps/web && node ../../scripts/db-rebuild.mjs --remote -c dist/server/wrangler.json && npx wrangler deploy --message "$PUBLIC_BUILD_VERSION")
echo "Dev: $SITE_URL"
