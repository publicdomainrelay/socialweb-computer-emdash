#!/usr/bin/env bash
set -euo pipefail

: "${ATPROTO_HANDLE:?Set ATPROTO_HANDLE}"
: "${ATPROTO_PASSWORD:?Set ATPROTO_PASSWORD}"
COLLECTION=com.fedfork.exec.oauth.clientMetadata
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

goat account login -u "$ATPROTO_HANDLE" -p "$ATPROTO_PASSWORD" >/dev/null
for file in "$ROOT"/records/*.json; do
	rkey="$(basename "$file" .json)"
	goat lex validate -c "$ROOT/lexicons" "$file" >/dev/null
	goat record update -n -r "$rkey" "$file" 2>/dev/null || goat record create -n -r "$rkey" "$file"
done
goat record ls --collection "$COLLECTION" "$ATPROTO_HANDLE"
