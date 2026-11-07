# 0003. Minimal OAuth client inside the sandbox

Status: accepted

## Context

The sandbox blocks global `fetch()`. Network access goes only through `ctx.http.fetch()`. The bundled `backend.js` must stay under 128 KB and cannot import Node built-ins. On Cloudflare each invocation also allows only 10 subrequests and 50 ms of CPU. The reference `@atproto/oauth-client` packages assume global fetch and DNS, and they exceed the bundle budget.

## Decision

`packages/atproto-oauth` (`atproto-oauth-sandbox`) implements the atproto OAuth profile with WebCrypto and `ctx.http` only:

- handle resolution through `https://<handle>/.well-known/atproto-did`, then DNS-over-HTTPS TXT `_atproto.<handle>`
- DID resolution through `plc.directory` or `did:web`
- protected resource and authorization server metadata, with an issuer check
- PAR, PKCE S256, ES256 DPoP proofs with a per-origin nonce and one retry
- `sub` and `iss` checks against the account resolved before redirect
- refresh on expiry or on `invalid_token`, and best-effort revocation on disconnect

Plugins depend on it as a `devDependency` that exports TypeScript source. The plugin CLI's tsdown build then inlines it into each `backend.js`.

## Consequences

- Each plugin bundle carries its own copy, so each sandbox stays self-contained.
- Authorization start costs about 6 subrequests and the callback about 2, both within the Cloudflare budget.
- The library is small enough to audit, but it is not the reference implementation. Tests in `packages/atproto-oauth/tests` use a fake authorization server that verifies DPoP signatures, `ath`, `htu` and nonces.
