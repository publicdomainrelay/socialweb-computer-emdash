#!/usr/bin/env bash
set -euo pipefail

: "${ATPROTO_HANDLE:?Set ATPROTO_HANDLE}"
: "${ATPROTO_PASSWORD:?Set ATPROTO_PASSWORD}"
SERVICE="${SERVICE:-emdash}"
PORT="${PORT:-4321}"
KEY="${KEY:-$HOME/.ssh/fedproxy-$SERVICE}"

[ -f "$KEY" ] || ssh-keygen -q -t ed25519 -f "$KEY" -C "$SERVICE" -N ""

DID=$(curl -fsS "https://$ATPROTO_HANDLE/.well-known/atproto-did" || curl -fsS "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=$ATPROTO_HANDLE" | jq -r .did)
PDS=$(curl -fsS "https://plc.directory/$DID" | jq -r '.service[] | select(.id == "#atproto_pds") | .serviceEndpoint')
PUBLIC_KEY=$(cut -d' ' -f1-2 "$KEY.pub")

if ! curl -fsS "$PDS/xrpc/com.atproto.repo.listRecords?repo=$DID&collection=com.fedproxy.sshPublicKey&limit=100" \
	| jq -e --arg k "$PUBLIC_KEY" --arg s "$SERVICE" '.records[] | select((.value.key | startswith($k)) and .value.service == $s)' >/dev/null; then
	JWT=$(curl -fsS -X POST "$PDS/xrpc/com.atproto.server.createSession" -H 'content-type: application/json' \
		-d "$(jq -n --arg i "$ATPROTO_HANDLE" --arg p "$ATPROTO_PASSWORD" '{identifier: $i, password: $p}')" | jq -r .accessJwt)
	curl -fsS -X POST "$PDS/xrpc/com.atproto.repo.createRecord" -H "authorization: Bearer $JWT" -H 'content-type: application/json' \
		-d "$(jq -n --arg r "$DID" --arg k "$(cat "$KEY.pub")" --arg s "$SERVICE" --arg t "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
			'{repo: $r, collection: "com.fedproxy.sshPublicKey", record: {"$type": "com.fedproxy.sshPublicKey", key: $k, name: $s, service: $s, createdAt: $t}}')" >/dev/null
	sleep 5
fi

echo "https://$SERVICE--${ATPROTO_HANDLE//./-}.fedproxy.com"
exec ssh -NnT -p 2222 -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -o PasswordAuthentication=no \
	-o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -i "$KEY" -R "$SERVICE:80:127.0.0.1:$PORT" "$ATPROTO_HANDLE@fedproxy.com"
