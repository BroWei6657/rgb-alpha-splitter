#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

NDI_ROOT="${NDI_SDK_DIR:-/Library/NDI SDK for Apple}"
if [[ ! -f "$NDI_ROOT/include/Processing.NDI.Lib.h" ]]; then
  echo "NDI SDK not found. Install NDI SDK for Apple or set NDI_SDK_DIR." >&2
  exit 1
fi
if [[ ! -f "$NDI_ROOT/lib/macOS/libndi.dylib" ]]; then
  echo "NDI macOS library not found at $NDI_ROOT/lib/macOS/libndi.dylib" >&2
  exit 1
fi

ELECTRON_VERSION="$(node -p "require('./node_modules/electron/package.json').version")"
ARCH="${npm_config_arch:-$(uname -m)}"
if [[ "$ARCH" == "x86_64" ]]; then ARCH="x64"; fi
if [[ "$ARCH" != "x64" && "$ARCH" != "arm64" ]]; then
  echo "Unsupported macOS architecture: $ARCH" >&2
  exit 1
fi

npx --no-install node-gyp rebuild \
  --target="$ELECTRON_VERSION" \
  --arch="$ARCH" \
  --dist-url=https://electronjs.org/headers \
  --devdir="$ROOT_DIR/.electron-gyp"

cp -f "build/Release/ndi-node.node" "native/ndi-node.node"
echo "Built native/ndi-node.node for macOS $ARCH"
