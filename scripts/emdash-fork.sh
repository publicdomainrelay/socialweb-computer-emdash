#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/vendor/emdash-fork"
PACKAGES=(core plugin-types workerd cloudflare plugin-cli plugin-test)

[ -f "$ROOT/emdash/package.json" ] || git -C "$ROOT" submodule update --init emdash
cd "$ROOT/emdash"
pnpm install --frozen-lockfile
pnpm build
rm -rf "$OUT"
mkdir -p "$OUT"
for package in "${PACKAGES[@]}"; do
	(cd "packages/$package" && pnpm pack --pack-destination "$OUT" >/dev/null)
done
ls "$OUT"
