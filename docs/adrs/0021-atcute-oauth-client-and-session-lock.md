# 0021. atcute OAuth client and a storage lock for sessions

Status: accepted. Supersedes 0003.

## Context

ADR 0003 wrote our own OAuth client because no library ran inside the sandbox. That was about 500 lines of security-sensitive code: PAR, PKCE, DPoP and nonce retries, token refresh and identity resolution.

Several WebAssembly runs can use the same session at once, whether as parallel browser runs, service-auth calls, or several isolates. atproto refresh tokens are single-use. If two runs refresh the same session together, one fails with `invalid_grant`, and the library then deletes the session.

## Decision

- `@atcute/oauth-node-client` and `@atcute/identity-resolver` replace our OAuth and identity code. Each integration record gets a public `OAuthClient` whose metadata comes from `clientConfig`.
- All network access goes through `sandboxFetch`. It turns the library's requests into `ctx.http.fetch` calls with plain headers and a string body, drops `cache` hints, and buffers each response.
- Our `Store` adapters keep the library's state and session data AES-GCM sealed in the `pending` and `sessions` collections. The session store accepts only the record's own DID.
- Server metadata is cached in memory for 10 minutes.
- `requestLock` is a lease in the `locks` collection, scoped to one user and integration. It is claimed with an insert-if-absent write, expires after 30 seconds, and is released with a compare-and-delete. A waiting run re-reads the session after the lock is free, so only one run refreshes.
- The fork's plugin build resolves the `workerd`, `worker` and `browser` export conditions, so dependencies bundle their worker builds. The Miniflare dev runner now uses the production compatibility date.

## Consequences

- PAR, PKCE, DPoP, refresh and revocation are the library's code, not ours.
- A session reconnected before this change uses the old sealed format and must be connected again.
- `tests/run.test.ts` starts two runs on an expiring session at the same time, and asserts one refresh and that both runs succeed. It fails without the lock.
- Locks add a storage round trip only when the library refreshes or reads a session through the lock.
