# auth-atproto-subscriber

Identity-only Atmosphere login for EmDash. Asks for the `atproto` scope, keeps no token after login, lets any Atmosphere account join as a Subscriber, and returns users to the page they came from.

```bash
pnpm add auth-atproto-subscriber
```

```js
import { atprotoSubscriber } from "auth-atproto-subscriber";

emdash({
	authProviders: [atprotoSubscriber({ allowAnyAccount: true })],
});
```

```astro
---
import AtmosphereSignIn from "auth-atproto-subscriber/AtmosphereSignIn.astro";
import AtmosphereSignOut from "auth-atproto-subscriber/AtmosphereSignOut.astro";
---
{Astro.locals.user ? <AtmosphereSignOut returnTo="/" /> : <AtmosphereSignIn returnTo="/account" />}
```

```js
atprotoSubscriber({
	allowAnyAccount: false,
	allowedDIDs: ["did:plc:abc123"],
	allowedHandles: ["*.example.com"],
	defaultRole: 10,
});
```

```bash
curl -s https://your-site.example/.well-known/atproto-client-metadata.json | jq .scope
```

Drop-in replacement for `@emdash-cms/auth-atproto` (same provider id, routes and account links). Install one or the other.
