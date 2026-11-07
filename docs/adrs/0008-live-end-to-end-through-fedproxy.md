# 0008. Live end-to-end tests through fedproxy

Status: accepted

## Context

The loopback client (ADR 0004) never makes the authorization server fetch the CIMD. Only a public HTTPS origin tests the real served client metadata, the `redirect_uri` round trip, and how bsky.social validates every declared scope string. [fedproxy](https://github.com/johnandersen777/fedproxy) exposes a local port at `https://<service>--<handle>.fedproxy.com`. It authorizes the tunnel with a `com.fedproxy.sshPublicKey` record in the user's own repo.

## Decision

- `scripts/fedproxy.sh` registers an SSH key record for service `emdash` if none exists, then opens `ssh -R emdash:80:127.0.0.1:4321`.
- The site runs `astro dev` with `EMDASH_SITE_URL` set to the fedproxy origin. Astro `server.allowedHosts` permits `.fedproxy.com`.
- `scripts/e2e.ts` takes an admin token from `/_emdash/api/setup/dev-bypass?token=1`, which works in dev only. It drives each plugin's Block Kit `admin` route and approves at the account's authorization server through the `@atproto/oauth-provider` API: `sign-in`, then `consent` with the ephemeral token. It then follows the callback to the plugin and checks records on the PDS.
- The OAuth callback redirects with a relative `Location`. EmDash rejects public raw redirects that leave the request origin. Behind a TLS-terminating tunnel the request origin is `http://`, while `siteUrl` is `https://`.

## Consequences

- Each run creates and then deletes one `xyz.statusphere.status` record. The requester run only grants scopes and writes no publicdomainrelay records, so no market participant reacts.
- The consent automation depends on undocumented oauth-provider UI endpoints and may break when the provider changes.
