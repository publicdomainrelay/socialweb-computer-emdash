#!/usr/bin/env bash
set -euo pipefail

: "${ATPROTO_HANDLE:?Set ATPROTO_HANDLE}"
: "${ATPROTO_PASSWORD:?Set ATPROTO_PASSWORD}"
PDS="${ATPROTO_PDS:-https://bsky.social}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WASM="$ROOT/wasm/statusphere/statusphere.wasm"
RECORD="$ROOT/records/wasm/statusphere.json"
COLLECTION=com.publicdomainrelay.temp.wasm.module
RKEY=statusphere

"$ROOT/wasm/statusphere/build.sh"

session="$(jq -n --arg id "$ATPROTO_HANDLE" --arg pw "$ATPROTO_PASSWORD" '{identifier: $id, password: $pw}' |
	curl -fsS -X POST -H 'Content-Type: application/json' --data @- "$PDS/xrpc/com.atproto.server.createSession")"
token="$(jq -r .accessJwt <<<"$session")"
did="$(jq -r .did <<<"$session")"
PDS="$(jq -r '.didDoc.service[] | select(.id == "#atproto_pds") | .serviceEndpoint' <<<"$session")"

blob="$(curl -fsS -X POST -H "Authorization: Bearer $token" -H 'Content-Type: application/wasm' \
	--data-binary @"$WASM" "$PDS/xrpc/com.atproto.repo.uploadBlob" | jq .blob)"
session_cid="$(curl -fsS "$PDS/xrpc/com.atproto.repo.getRecord?repo=$did&collection=com.publicdomainrelay.temp.oauth.clientMetadata&rkey=statusphere" | jq -r .cid)"
created_at="$(jq -r '.createdAt // empty' "$RECORD" 2>/dev/null || true)"
created_at="${created_at:-$(date -u +%Y-%m-%dT%H:%M:%S.000Z)}"

jq -n --tab --argjson blob "$blob" --arg did "$did" --arg cid "$session_cid" --arg createdAt "$created_at" '{
	"$type": "com.publicdomainrelay.temp.wasm.module",
	name: "Statusphere",
	description: "Set your xyz.statusphere.status emoji status.",
	module: $blob,
	abi: "emdash-wasm-json-v1",
	session: {
		uri: "at://\($did)/com.publicdomainrelay.temp.oauth.clientMetadata/statusphere",
		cid: $cid
	},
	actions: [{entry: "set_status", label: "Set status"}],
	createdAt: $createdAt
}' >"$RECORD.tmp"
mv "$RECORD.tmp" "$RECORD"
goat lex validate -c "$ROOT/lexicons" "$RECORD" >/dev/null

jq -n --arg did "$did" --arg collection "$COLLECTION" --arg rkey "$RKEY" --slurpfile record "$RECORD" \
	'{repo: $did, collection: $collection, rkey: $rkey, record: $record[0]}' |
	curl -fsS -X POST -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
		--data @- "$PDS/xrpc/com.atproto.repo.putRecord"
echo
