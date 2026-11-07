# 0011. Per-user encrypted sessions

Status: accepted

## Context

EmDash encrypts only plugin settings declared as `type: "secret"`, and their keys are fixed in the manifest. Plugin KV and storage are plaintext, and EmDash's own `auth-atproto` keeps its sessions in plaintext storage. Integration sessions belong to individual EmDash users. `routeCtx.user` is EmDash's trusted way to key per-user plugin data.

## Decision

- Plugin storage `sessions`, keyed `<userId>/<did>/<rkey>` and indexed by `userId`, holds one session per user per integration.
- Plugin storage `pending`, keyed by OAuth `state`, binds the public callback to the user who started it. Entries expire after 10 minutes.
- Tokens, PKCE verifiers and private DPoP keys are AES-GCM sealed. The authenticated data is `<pluginId>:<storage key>`, which pins each blob to its row. The data key is the `sessionKey` secret setting: generated on first use with `compareAndSet`, and encrypted at rest by EmDash with `EMDASH_ENCRYPTION_KEY`.
- User routes require `auth:manage_own_credentials`, which Subscribers and above hold, and act only on `routeCtx.user`.

## Consequences

- A database dump without `EMDASH_ENCRYPTION_KEY` reveals no tokens.
- Losing `EMDASH_ENCRYPTION_KEY` loses every integration session, and users must connect again.
- Rotating `EMDASH_ENCRYPTION_KEY` re-encrypts only the data key, which is re-saved like any other plugin secret.
