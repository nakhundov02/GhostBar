#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="$ROOT/assets"
mkdir -p "$ASSETS"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║     GhostBar — Preparing Build           ║"
echo "╚══════════════════════════════════════════╝"
echo ""

ARM_BIN="$ASSETS/mitmdump-arm64"
X86_BIN="$ASSETS/mitmdump-x86_64"

if [ -f "$ARM_BIN" ] && [ -f "$X86_BIN" ]; then
  echo "✅ Found mitmdump-arm64 (Apple Silicon)"
  echo "✅ Found mitmdump-x86_64 (Intel)"
  chmod +x "$ARM_BIN" "$X86_BIN"
  echo "✅ Both binaries ready — DMG will work on ALL Macs"
  echo ""
  exit 0
fi

[ ! -f "$ARM_BIN" ] && echo "❌ Missing: assets/mitmdump-arm64"
[ ! -f "$X86_BIN" ] && echo "❌ Missing: assets/mitmdump-x86_64"
exit 1
