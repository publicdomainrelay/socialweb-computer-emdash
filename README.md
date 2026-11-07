# socialweb-computer-emdash

Users sign in to an EmDash site with Atmosphere using only the `atproto` scope. On `/integrations` they can grant the site more OAuth sessions. Each integration is defined by a `com.publicdomainrelay.temp.oauth.clientMetadata` record in their own PDS.

## Run

```bash
pnpm install
pnpm build
pnpm dev
```

```bash
xdg-open http://127.0.0.1:4321/integrations
```

## Atmosphere login on any EmDash site

```bash
pnpm add auth-atproto-subscriber
```

```js
import { atprotoSubscriber } from "auth-atproto-subscriber";

emdash({ authProviders: [atprotoSubscriber({ allowAnyAccount: true })] });
```

```astro
---
import AtmosphereSignIn from "auth-atproto-subscriber/AtmosphereSignIn.astro";
import AtmosphereSignOut from "auth-atproto-subscriber/AtmosphereSignOut.astro";
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

## Layout

```text
site/                                  EmDash blog theme, Atmosphere login, /integrations
plugins/atproto-integrations-emdash/   sandboxed OAuth client per record, encrypted per-user sessions
lexicons/                              com.publicdomainrelay.temp.oauth.clientMetadata
records/                               socialweb-computer and statusphere examples
packages/auth-atproto-subscriber/      Atmosphere login: atproto scope only, open signup, sign-in and sign-out components
scripts/                               publish records, fedproxy tunnel, live e2e
docs/adrs/                             decisions
```
