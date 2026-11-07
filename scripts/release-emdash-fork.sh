#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${REPO:-publicdomainrelay/socialweb-computer-emdash}"
SHA="$(git -C "$ROOT/emdash" rev-parse --short=9 HEAD)"
TAG="emdash-fork-$SHA"
BASE="https://github.com/$REPO/releases/download/$TAG"

if ! gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
	"$ROOT/scripts/emdash-fork.sh"
	gh release create "$TAG" -R "$REPO" --target main --prerelease \
		--title "EmDash fork packages $SHA" \
		--notes "Packed from publicdomainrelay/emdash@$SHA (branch wasm-blob-sandbox) by scripts/release-emdash-fork.sh." \
		"$ROOT"/vendor/emdash-fork/*.tgz
fi

sed -i -E "s#: (file:vendor/emdash-fork|https://github.com/[^ ]+/releases/download/[^/]+)/#: $BASE/#" "$ROOT/pnpm-workspace.yaml"
pnpm -C "$ROOT" install
grep -n "$TAG" "$ROOT/pnpm-workspace.yaml"
