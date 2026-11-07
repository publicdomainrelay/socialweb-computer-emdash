# 0005. Encrypted session storage in plugin settings

Status: superseded by 0011

## Context

A sandboxed plugin has no environment variables or bindings. It can persist data in `ctx.kv`, in `ctx.storage` or in `ctx.settings`. Settings declared as `type: "secret"` in `admin.settingsSchema` are encrypted with AES-GCM under `EMDASH_ENCRYPTION_KEY`. The ciphertext is bound to the plugin ID and the setting key.

## Decision

- `session` (a secret setting) holds the DID, PDS, endpoints, granted scope, access and refresh tokens, and the private DPoP JWK, as one JSON string.
- `pending` (a secret setting) holds the single in-flight authorization: state, PKCE verifier and DPoP key. It expires after 10 minutes and is deleted on callback.
- `ctx.kv` key `state:notice` carries the one-shot callback result to the next Connect page load.

Each plugin connects one account for the whole site. Hooks such as `content:afterPublish` have no acting user, and the integration acts as the site.

## Consequences

- Database dumps do not expose tokens without the encryption key.
- A new Connect or Upgrade replaces any earlier in-flight request.
- Two concurrent refreshes may race on refresh-token rotation. CMS admin traffic is low, so this is accepted.
