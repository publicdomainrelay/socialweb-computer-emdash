# socialweb-computer-emdash

Users sign in to an EmDash site with Atmosphere using only the `atproto` scope. On `/integrations` they can grant the site more OAuth sessions. Each integration is defined by a `com.publicdomainrelay.temp.oauth.clientMetadata` record in their own PDS.

## Run

```bash
./scripts/emdash-fork.sh
pnpm install
pnpm build
pnpm dev
```

```bash
xdg-open http://127.0.0.1:4321/integrations
```

## Atmosphere login on any EmDash site

```bash
pnpm add @publicdomainrelay/auth-atproto-subscriber
```

```js
import { atprotoSubscriber } from "@publicdomainrelay/auth-atproto-subscriber";

emdash({ authProviders: [atprotoSubscriber({ allowAnyAccount: true })] });
```

```astro
---
import AtmosphereSignIn from "@publicdomainrelay/auth-atproto-subscriber/AtmosphereSignIn.astro";
import AtmosphereSignOut from "@publicdomainrelay/auth-atproto-subscriber/AtmosphereSignOut.astro";
---
{Astro.locals.user ? <AtmosphereSignOut returnTo="/" /> : <AtmosphereSignIn returnTo="/integrations" />}
```

## Publish integration records

```bash
go install github.com/bluesky-social/goat@latest
export ATPROTO_HANDLE=alice.bsky.social ATPROTO_PASSWORD='app-password'
./scripts/publish-records.sh
```

```bash
goat lex validate -c lexicons records/statusphere.json
goat record get "at://$ATPROTO_HANDLE/com.publicdomainrelay.temp.oauth.clientMetadata/statusphere"
```

## WebAssembly integrations

```bash
./wasm/statusphere/build.sh
pnpm exec node wasm/statusphere/test.mjs
ATPROTO_PDS=https://bsky.social ./scripts/publish-wasm.sh
```

```bash
goat record get "at://$ATPROTO_HANDLE/com.publicdomainrelay.temp.wasm.module/statusphere"
```

## Run a module with atproto service auth

```bash
SITE="${SITE_URL:-https://emdash--${ATPROTO_HANDLE//./-}.fedproxy.com}"
SITE_DID="did:web:${SITE#https://}"
DOC=$(goat resolve "$ATPROTO_HANDLE")
PDS=$(jq -r '.service[] | select(.id == "#atproto_pds") | .serviceEndpoint' <<<"$DOC")
MODULE="at://$(jq -r .id <<<"$DOC")/com.publicdomainrelay.temp.wasm.module/statusphere"
ACCESS_JWT=$(curl -fsS -X POST -H 'content-type: application/json' \
  -d "{\"identifier\":\"$ATPROTO_HANDLE\",\"password\":\"$ATPROTO_PASSWORD\"}" \
  $PDS/xrpc/com.atproto.server.createSession | jq -r .accessJwt)
```

Through your PDS:

```bash
curl -fsS -X POST $PDS/xrpc/com.publicdomainrelay.temp.wasm.run \
  -H "Authorization: Bearer $ACCESS_JWT" \
  -H "atproto-proxy: $SITE_DID#emdash_integrations" \
  -H 'content-type: application/json' \
  -d "{\"module\":\"$MODULE\",\"entry\":\"set_status\",\"input\":{\"status\":\"🦋\"}}" | jq
```

With a token from `getServiceAuth`:

```bash
TOKEN=$(curl -fsS -H "Authorization: Bearer $ACCESS_JWT" \
  "$PDS/xrpc/com.atproto.server.getServiceAuth?aud=$SITE_DID&lxm=com.publicdomainrelay.temp.wasm.run" | jq -r .token)
curl -fsS -X POST "$SITE/xrpc/com.publicdomainrelay.temp.wasm.run" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"module\":\"$MODULE\",\"entry\":\"clear_status\"}" | jq .result
```

## WebAssembly on celld

[celld/README.md](celld/README.md)

```bash
./scripts/celld.sh
```

```bash
curl -s --get http://127.0.0.1:8080/run \
  --data-urlencode did=did:plc:lpfuqerea3deuoyrn7ojser4 \
  --data-urlencode rkey=statusphere \
  --data-urlencode entry=set_status \
  --data-urlencode status=🦋 | jq .
```

```bash
./scripts/celld.sh down
```

## Public origin through fedproxy

```bash
./scripts/fedproxy.sh &
rm -f site/data.db*
EMDASH_SITE_URL="https://emdash--${ATPROTO_HANDLE//./-}.fedproxy.com" pnpm dev
```

```bash
curl -s "https://emdash--${ATPROTO_HANDLE//./-}.fedproxy.com/.well-known/atproto-client-metadata.json" | jq .scope
```

## Test

```bash
pnpm test
```

```bash
SITE_URL="https://emdash--${ATPROTO_HANDLE//./-}.fedproxy.com" pnpm exec node scripts/e2e.ts
```

## Client metadata served per record

```bash
DID=$(curl -s "https://$ATPROTO_HANDLE/.well-known/atproto-did")
curl -s "http://127.0.0.1:4321/integrations/$DID/statusphere/oauth-client-metadata.json" | jq .
```

## Add an integration

```json
{
	"$type": "com.publicdomainrelay.temp.oauth.clientMetadata",
	"name": "Example",
	"clientMetadata": {
		"client_id": "https://example.com/oauth-client-metadata.json",
		"client_uri": "https://example.com",
		"redirect_uris": ["https://example.com/oauth/callback"],
		"scope": "atproto repo:com.example.post repo:com.example.like"
	},
	"scopeGroups": [
		{ "key": "posts", "label": "Write posts", "scopes": ["repo:com.example.post"] },
		{ "key": "likes", "label": "Like posts", "scopes": ["repo:com.example.like"] }
	],
	"createdAt": "2026-11-06T00:00:00.000Z"
}
```

```bash
goat record create -n -r example example.json
```

## What is ours

```text
ours        everything tracked here, plus the emdash/ fork branch commits
not ours    pnpm-lock.yaml  wasm/statusphere/Cargo.lock    generated
not ours    @publicdomainrelay/auth-atproto-subscriber      npm, github.com/publicdomainrelay/auth-atproto-subscriber
```

```bash
git ls-files | grep -v -E '\.(md|wasm|lock)$|pnpm-lock\.yaml|^emdash$' | xargs cat | wc -l
```

## Layout

```text
site/                                  landing page, /integrations, /xrpc run endpoint, did:web document
plugins/atproto-integrations-emdash/   sandboxed OAuth client per record, encrypted per-user sessions
lexicons/                              clientMetadata and wasm.module lexicons
wasm/statusphere/                      Rust Statusphere module (emdash-wasm-json-v1)
celld/                                 celld Worker that runs wasm.module records in Dynamic Workers
emdash/                                publicdomainrelay/emdash fork with wasm:execute
records/                               socialweb-computer and statusphere examples
scripts/                               publish records, fedproxy tunnel, live e2e
docs/adrs/                             decisions
```
