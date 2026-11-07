# 0012. Identity-only Atmosphere login for site users

Status: superseded by 0014

## Context

Site users sign in with their Atmosphere account. `/integrations` is shown only to a signed-in user whose EmDash account is linked to a DID. `@emdash-cms/auth-atproto` 0.2.50 asks for `atproto transition:generic`, allows only listed handles or DIDs to sign up, and always redirects to `/_emdash/admin`. Its client metadata route also builds URLs from the raw request, so behind a TLS-terminating proxy it publishes `http://` URLs.

## Decision

`patches/@emdash-cms__auth-atproto@0.2.50.patch`, applied by pnpm:

- requests `atproto` only;
- treats `allowedHandles: ["*"]` as any verified handle, and new users get the default Subscriber role;
- accepts `?returnTo=/local/path` on login and redirects there after the callback;
- builds the client metadata from `getPublicOrigin`, the same origin `login.ts` uses.

The site configures `atproto({ allowedHandles: ["*"] })`. `/integrations` finds the user's DID through `oauth_accounts` (provider `atproto`). The header shows the signed-in name and a Sign out button. It posts to `/_emdash/api/auth/logout` with `X-EmDash-Request: 1`, which destroys the EmDash session, and then reloads `/integrations`, which is gated again. Signing out of the site leaves integration sessions in place for the backend to use.

## Consequences

- The site login session can identify the user but cannot touch their repo. Write access lives only in integration sessions.
- These four changes are candidates for an upstream PR. Drop the patch once they land.
