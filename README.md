# socialweb-computer-emdash

An EmDash site with two sandboxed plugins. Each plugin is its own atproto OAuth client and requests scopes progressively.

## Run

```bash
pnpm install
pnpm build
pnpm dev
```

```bash
xdg-open "http://127.0.0.1:4321/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin/plugins/statusphere/connect"
```

## Test

```bash
pnpm test
```

## Client metadata

```bash
curl -s http://127.0.0.1:4321/_emdash/api/plugins/statusphere/oauth/client-metadata | jq .
curl -s http://127.0.0.1:4321/_emdash/api/plugins/socialweb-computer-requester/oauth/client-metadata | jq -r .scope | tr ' ' '\n'
```

## Live against a real PDS

```bash
export ATPROTO_HANDLE=alice.bsky.social ATPROTO_PASSWORD='app-password'
pnpm dev
pnpm exec node scripts/e2e.ts
```

## Public client metadata through fedproxy

```bash
rm -f site/data.db*
./scripts/fedproxy.sh &
EMDASH_SITE_URL="https://emdash--${ATPROTO_HANDLE//./-}.fedproxy.com" pnpm dev
pnpm exec node scripts/e2e.ts
```

## Add an integration

```jsonc
{
	"capabilities": ["network:request:unrestricted", "content:read"],
	"admin": {
		"pages": [{ "path": "/connect", "label": "Account", "icon": "link" }],
		"settingsSchema": {
			"session": { "type": "secret", "label": "OAuth session" },
			"pending": { "type": "secret", "label": "Pending OAuth request" }
		}
	}
}
```

```ts
import { connectedAgent, type Integration, integrationRoutes } from "atproto-oauth-sandbox";
import type { SandboxedPlugin } from "emdash/plugin";

const integration: Integration = {
	name: "Example",
	groups: [
		{ id: "posts", label: "Write posts", scopes: ["repo:com.example.post?action=create"] },
		{ id: "likes", label: "Like posts", scopes: ["repo:com.example.like"] },
	],
};

export default {
	routes: integrationRoutes(integration),
	hooks: {
		"content:afterPublish": async (_event, ctx) => {
			const agent = await connectedAgent(ctx, integration);
			agent?.requireGroup("posts");
			await agent?.createRecord("com.example.post", { text: "published" });
		},
	},
} satisfies SandboxedPlugin;
```

## Layout

```text
site/                                         EmDash on Node, SQLite, workerd sandbox, Atmosphere login
packages/atproto-oauth/                       PAR, PKCE, DPoP and scope groups over ctx.http
plugins/statusphere-emdash/                   repo:xyz.statusphere.status, then rpc:app.bsky.actor.getProfile
plugins/socialweb-computer-requester-emdash/  the qr.fedfork.com scope set, split into 10 groups
scripts/                                      fedproxy tunnel and live e2e
docs/adrs/                                    decisions
```
