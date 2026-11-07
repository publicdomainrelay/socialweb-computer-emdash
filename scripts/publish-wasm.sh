#!/usr/bin/env bash
set -euo pipefail

: "${ATPROTO_HANDLE:?Set ATPROTO_HANDLE}"
: "${ATPROTO_PASSWORD:?Set ATPROTO_PASSWORD}"
MODULE="${1:?Usage: publish-wasm.sh <module>}"
PDS="${ATPROTO_PDS:-https://bsky.social}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WASM="$ROOT/wasm/$MODULE/$MODULE.wasm"
SPEC="$ROOT/wasm/$MODULE/module.json"
RECORD="$ROOT/records/wasm/$MODULE.json"
MODULE_COLLECTION=com.fedfork.exec.wasm.module
CLIENT_COLLECTION=com.fedfork.exec.oauth.clientMetadata
FILE_COLLECTION=com.fedfork.exec.source.file
MANIFEST_COLLECTION=com.fedfork.exec.source.manifest
REPOSITORY=https://github.com/publicdomainrelay/socialweb-computer-emdash

"$ROOT/wasm/build.sh"

session="$(jq -n --arg id "$ATPROTO_HANDLE" --arg pw "$ATPROTO_PASSWORD" '{identifier: $id, password: $pw}' |
	curl -fsS -X POST -H 'Content-Type: application/json' --data @- "$PDS/xrpc/com.atproto.server.createSession")"
token="$(jq -r .accessJwt <<<"$session")"
did="$(jq -r .did <<<"$session")"
PDS="$(jq -r '.didDoc.service[] | select(.id == "#atproto_pds") | .serviceEndpoint' <<<"$session")"
now="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

get_record() {
	curl -fsS "$PDS/xrpc/com.atproto.repo.getRecord?repo=$did&collection=$1&rkey=$2"
}

write_record() {
	local method="$1" collection="$2" rkey="$3" file="$4"
	goat lex validate -c "$ROOT/lexicons" "$file" >/dev/null
	jq -n --arg did "$did" --arg collection "$collection" --arg rkey "$rkey" --slurpfile record "$file" \
		'{repo: $did, collection: $collection, rkey: $rkey, record: $record[0]}' |
		curl -fsS -X POST -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
			--data @- "$PDS/xrpc/com.atproto.repo.$method" | jq -c '{uri, cid}'
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

entries='[]'
while read -r path; do
	file="$ROOT/wasm/$path"
	sha="$(sha256sum "$file" | cut -d' ' -f1)"
	if ref="$(get_record "$FILE_COLLECTION" "$sha" 2>/dev/null | jq -c '{uri, cid}')"; then
		:
	else
		jq -n --arg sha "$sha" --argjson size "$(stat -c %s "$file")" --rawfile text "$file" --arg createdAt "$now" \
			'{"$type": "com.fedfork.exec.source.file", sha256: $sha, size: $size, text: $text, createdAt: $createdAt}' >"$work/file.json"
		ref="$(write_record createRecord "$FILE_COLLECTION" "$sha" "$work/file.json")"
	fi
	entries="$(jq -c --arg path "$path" --argjson ref "$ref" '. + [{path: $path, file: $ref}]' <<<"$entries")"
done < <(git -C "$ROOT/wasm" ls-files | grep -v -E '\.wasm$|(^|/)module\.json$|(^|/)test\.mjs$|^harness\.mjs$|^\.gitignore$')

jq -n --tab --argjson files "$entries" --arg version "$(rustc --version)" --arg artifact "$MODULE/$MODULE.wasm" \
	--arg sha "$(sha256sum "$WASM" | cut -d' ' -f1)" --argjson size "$(stat -c %s "$WASM")" \
	--arg repository "$REPOSITORY" --arg commit "$(git -C "$ROOT" rev-parse HEAD)" --arg createdAt "$now" --slurpfile spec "$SPEC" '{
	"$type": "com.fedfork.exec.source.manifest",
	name: $spec[0].name,
	description: $spec[0].description,
	language: "rust",
	files: $files,
	build: { tool: "cargo", version: $version, command: "./build.sh", artifact: $artifact },
	output: { sha256: $sha, size: $size },
	origin: { repository: $repository, commit: $commit },
	createdAt: $createdAt
}' >"$work/manifest.json"
source_ref="$(write_record createRecord "$MANIFEST_COLLECTION" "$MODULE.$(date +%s%3N)" "$work/manifest.json")"

blob="$(curl -fsS -X POST -H "Authorization: Bearer $token" -H 'Content-Type: application/wasm' \
	--data-binary @"$WASM" "$PDS/xrpc/com.atproto.repo.uploadBlob" | jq .blob)"
session_rkey="$(jq -r .session "$SPEC")"
session_cid="$(get_record "$CLIENT_COLLECTION" "$session_rkey" | jq -r .cid)"
created_at="$(jq -r '.createdAt // empty' "$RECORD" 2>/dev/null || true)"
created_at="${created_at:-$now}"

jq --tab --argjson blob "$blob" --arg did "$did" --arg cid "$session_cid" --argjson source "$source_ref" --arg createdAt "$created_at" '{
	"$type": "com.fedfork.exec.wasm.module",
	name,
	description,
	module: $blob,
	abi: "emdash-wasm-json-v1",
	session: {
		uri: "at://\($did)/com.fedfork.exec.oauth.clientMetadata/\(.session)",
		cid: $cid
	},
	source: $source,
	actions,
	calls,
	createdAt: $createdAt
}' "$SPEC" >"$RECORD.tmp"
mv "$RECORD.tmp" "$RECORD"
write_record putRecord "$MODULE_COLLECTION" "$MODULE" "$RECORD"
