#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
cd "$DIR"
export RUSTFLAGS="--cfg getrandom_backend=\"unsupported\" --remap-path-prefix=$CARGO_HOME=/cargo --remap-path-prefix=$DIR=/wasm"
cargo build --release --locked --target wasm32-unknown-unknown
for module in statusphere vibescrobble; do
	cp "target/wasm32-unknown-unknown/release/$module.wasm" "$module/$module.wasm"
done
