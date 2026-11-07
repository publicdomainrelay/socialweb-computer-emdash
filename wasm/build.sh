#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
cargo build --release --locked --target wasm32-unknown-unknown
for module in statusphere vibescrobble; do
	cp "target/wasm32-unknown-unknown/release/$module.wasm" "$module/$module.wasm"
done
