#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

branch_name="$(git branch --show-current)"
if [[ "$branch_name" != "joel/pipeline-integration" ]]; then
  echo "Checkpoint skipped: expected joel/pipeline-integration, got $branch_name" >&2
  exit 0
fi

npm run typecheck >/dev/null
node --experimental-strip-types --test lib/notion/index.test.mjs >/dev/null

git add -- README.md app/page.tsx app/api/push/route.ts docs/04-pipeline-setup.md lib/notion/index.ts lib/notion/index.test.mjs scripts/checkpoint.sh
if git diff --cached --quiet; then
  echo 'No Joel pipeline changes to commit.'
  exit 0
fi

git commit -m "Checkpoint Joel pipeline work"
