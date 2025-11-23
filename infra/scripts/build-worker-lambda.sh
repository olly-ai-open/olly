#!/usr/bin/env bash
set -euo pipefail

# Build a deployable zip for the JobWorker Lambda.
# Assumes pnpm and esbuild are available in PATH.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="$ROOT_DIR/apps/worker"
OUT_ROOT="$ROOT_DIR/dist-lambda"
OUT_DIR="$OUT_ROOT/worker"
ZIP_PATH="$OUT_ROOT/worker.zip"

echo "==> Install deps"
cd "$APP_DIR"
pnpm install

rm -rf "$OUT_DIR" "$ZIP_PATH"
mkdir -p "$OUT_DIR"

echo "==> Bundling worker handler with esbuild"
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
echo "  aws lambda update-function-code --region us-west-2 --function-name JobWorker --zip-file fileb://$ZIP_PATH"
