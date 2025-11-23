#!/usr/bin/env bash
set -euo pipefail

# Build a deployable zip for the JobScheduler Lambda.
# Assumes pnpm and esbuild are available in PATH.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="$ROOT_DIR/apps/scheduler"
OUT_ROOT="$ROOT_DIR/dist-lambda"
OUT_DIR="$OUT_ROOT/scheduler"
ZIP_PATH="$OUT_ROOT/scheduler.zip"

echo "==> Install deps"
cd "$APP_DIR"
pnpm install

rm -rf "$OUT_DIR" "$ZIP_PATH"
mkdir -p "$OUT_DIR"

echo "==> Bundling scheduler handler with esbuild"
cd "$APP_DIR"

pnpm exec esbuild src/index.ts \
  --bundle \
  --platform=node \
  --target=node22 \
  --tsconfig=tsconfig.json \
  --external:@prisma/client \
  --outfile="$OUT_DIR/index.js" \
  --minify=false

echo "==> Creating zip at $ZIP_PATH"
cd "$OUT_DIR"
zip "$ZIP_PATH" index.js

echo "Done. Upload with:"
echo "  aws lambda update-function-code --region us-west-2 --function-name JobScheduler --zip-file fileb://$ZIP_PATH"
