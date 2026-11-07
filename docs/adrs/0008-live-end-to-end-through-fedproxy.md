# 0008. Live end-to-end tests through fedproxy

Status: accepted

## Context

The loopback client (ADR 0004) never makes the authorization server fetch the CIMD. Only a public HTTPS origin tests the real served client metadata, the `redirect_uri` round trip, and how bsky.social validates every declared scope string. [fedproxy](https://github.com/johnandersen777/fedproxy) exposes a local port at `https://<service>--<handle>.fedproxy.com`. It authorizes the tunnel with a `com.fedproxy.sshPublicKey` record in the user's own repo.

## Decision

- `scripts/fedproxy.sh` registers an SSH key record for service `emdash` if none exists, then opens `ssh -R emdash:80:127.0.0.1:4321`.
- The site runs `astro dev` with `EMDASH_SITE_URL` set to the fedproxy origin. Astro `server.allowedHosts` permits `.fedproxy.com`.
- `scripts/e2e.ts` acts as a browser user. It signs in to the site through the Atmosphere login with `?returnTo=/integrations` and loads `/integrations`. It connects each listed integration through the plugin routes, then calls `verify`, which runs `com.atproto.server.getSession` with the stored session. Consent at the authorization server goes through the `@atproto/oauth-provider` API: `sign-in`, then `consent` with the ephemeral token.
- The OAuth callback redirects with a relative `Location`. EmDash rejects public raw redirects that leave the request origin. Behind a TLS-terminating tunnel the request origin is `http://`, while `siteUrl` is `https://`.

## Consequences

- A run writes no records. It only grants scopes and calls `getSession`, so no market participant reacts.
- The consent automation depends on undocumented oauth-provider UI endpoints and may break when the provider changes.
