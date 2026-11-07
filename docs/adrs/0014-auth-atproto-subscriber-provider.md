# 0014. auth-atproto-subscriber login provider package

Status: accepted

## Context

ADR 0012 changed `@emdash-cms/auth-atproto` with a pnpm patch. Patches break on upgrades and can't be reused by other sites. A login provider can't be a sandboxed or native EmDash plugin. It has to set the Astro session, create users and link accounts in `oauth_accounts`, ship React for the admin login form and the setup step, and serve `/.well-known/atproto-client-metadata.json`. EmDash only accepts providers through `emdash({ authProviders })`. The `@atproto/oauth-client-browser` pattern doesn't fit either: the server can't verify a DPoP-bound token held in the browser without extra `rpc:` scopes.

## Decision

`packages/auth-atproto-subscriber` is a standalone `AuthProviderDescriptor` package derived from `@emdash-cms/auth-atproto` 0.2.50 (MIT, license kept). It is a drop-in replacement: same provider id `atproto`, same routes, and the same `oauth_accounts` provider name, so existing linked users keep working. Do not install both packages.

- Only the `atproto` scope is requested.
- Nothing is kept after login. OAuth state lives in `auth:atproto/states` during the flow. The token session lives in memory and is revoked with `signOut()` as soon as the callback has the DID.
- The handle and display name come from bidirectionally verified identity resolution and the public profile record, not from the token.
- `allowAnyAccount` admits any Atmosphere account as `defaultRole` (Subscriber). `allowedDIDs` and `allowedHandles` work as upstream, and `"*"` is accepted as a handle pattern.
- `?returnTo=` is accepted only for local paths, using the rules of EmDash's `isSafeRedirect`. Errors redirect back to it with `?error=`, otherwise to the admin login page.
- The client metadata uses `getPublicOrigin`, so `siteUrl` is honoured behind TLS-terminating proxies.
- `AtmosphereSignIn.astro` and `AtmosphereSignOut.astro` give any public page the login and logout controls. Sign out posts to `/_emdash/api/auth/logout` with `X-EmDash-Request: 1`.

## Consequences

- Install is `pnpm add auth-atproto-subscriber` plus `authProviders: [atprotoSubscriber({ allowAnyAccount: true })]`.
- Rows in `auth:atproto/sessions` written by the old provider are no longer read. They can be deleted.
- The changes still make sense upstream as options (`scope`, open signup, `returnTo`) plus the origin bug fix.
