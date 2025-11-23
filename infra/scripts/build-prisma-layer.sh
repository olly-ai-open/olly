#!/usr/bin/env bash
set -euo pipefail

# Build a Lambda layer containing Prisma client + field encryption.
# This layer will be attached to JobScheduler and JobWorker functions.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
OUT_ROOT="$ROOT_DIR/dist-lambda"
LAYER_DIR="$OUT_ROOT/prisma-layer"
NODEJS_DIR="$LAYER_DIR/nodejs"
ZIP_PATH="$OUT_ROOT/prisma-layer.zip"

rm -rf "$LAYER_DIR" "$ZIP_PATH"
mkdir -p "$NODEJS_DIR/node_modules"

echo "==> Ensuring web dependencies and Prisma client are generated"
cd "$WEB_DIR"
pnpm install
pnpm prisma generate

echo "==> Copying Prisma runtime deps into layer node_modules"

cd "$WEB_DIR"

PRISMA_CLIENT_DIR="$(node -p "require('path').dirname(require.resolve('@prisma/client/package.json'))")"
PRISMA_NODE_MODULES_ROOT="$(node -p "require('path').resolve(require('path').dirname(require.resolve('@prisma/client/package.json')), '../..')")"

echo "  Resolved @prisma/client at: $PRISMA_CLIENT_DIR"
echo "  Resolved node_modules root at: $PRISMA_NODE_MODULES_ROOT"

if [ ! -d "$PRISMA_CLIENT_DIR" ]; then
  echo "ERROR: Resolved @prisma/client directory does not exist: $PRISMA_CLIENT_DIR"
  exit 1
fi

if [ ! -d "$PRISMA_NODE_MODULES_ROOT/.prisma" ]; then
  echo "ERROR: .prisma directory not found at: $PRISMA_NODE_MODULES_ROOT/.prisma"
  exit 1
fi

mkdir -p "$NODEJS_DIR/node_modules/@prisma"
cp -R "$PRISMA_CLIENT_DIR" "$NODEJS_DIR/node_modules/@prisma/client"
cp -R "$PRISMA_NODE_MODULES_ROOT/.prisma" "$NODEJS_DIR/node_modules/.prisma"

# Copy prisma-field-encryption via Node resolution too
PRISMA_FE_DIR="$(node -p "require('path').dirname(require.resolve('prisma-field-encryption/package.json'))")"
echo "  Resolved prisma-field-encryption at: $PRISMA_FE_DIR"

if [ ! -d "$PRISMA_FE_DIR" ]; then
  echo "ERROR: prisma-field-encryption directory does not exist: $PRISMA_FE_DIR"
  exit 1
fi

cp -R "$PRISMA_FE_DIR" "$NODEJS_DIR/node_modules/prisma-field-encryption"

echo "==> Creating layer zip at $ZIP_PATH"
cd "$LAYER_DIR"
zip -r "$ZIP_PATH" nodejs

echo "Done. Publish the layer with:"
echo "  aws lambda publish-layer-version --region us-west-2 --layer-name OllyPrismaDeps --zip-file fileb://$ZIP_PATH --compatible-runtimes nodejs22.x"
echo "Note: capture the resulting LayerVersionArn and feed it into CDK (runtimeLayerArn context or constant)."
