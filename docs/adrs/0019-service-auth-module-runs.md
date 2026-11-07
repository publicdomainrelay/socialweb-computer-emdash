# 0019. atproto service auth for module runs

Status: accepted

## Context

Module runs needed the site's browser session. atproto already lets one account authenticate to a service through its PDS, with a short-lived JWT signed by the account's `#atproto` key. EmDash withholds the `Authorization` header from sandboxed plugin routes.

## Decision

- The site is `did:web:<host>`. `/.well-known/did.json` names a service `#emdash_integrations` at the site origin.
- `com.publicdomainrelay.temp.wasm.run` (in `lexicons/`) is served at `/xrpc/com.publicdomainrelay.temp.wasm.run`. It takes `{ module, entry, input }` and returns the rounds and result.
- The site route reads the `Bearer` token and passes it in the body to the plugin's public `service/run` route. The plugin, not the site, is the trust boundary. It:
  1. requires `ES256K` or `ES256`, and a plain `did:plc` or `did:web` issuer;
  2. requires `aud` to be the site DID, with or without `#emdash_integrations`, and `lxm` to be the run method;
  3. requires `exp` to be in the future and at most an hour ahead;
  4. verifies the signature against the issuer's `#atproto` Multikey with `@atcute/crypto`, which rejects malleable (high-S) signatures and requires the key type to match `alg`;
  5. claims the `jti` with an insert-if-absent write, so a token works once.
- The issuer must own the session the module uses. The plugin finds the EmDash user who connected that session and runs the module with it.
- Callers get a token from `com.atproto.server.getServiceAuth`, or let their PDS mint one with `atproto-proxy: did:web:<host>#emdash_integrations`. OAuth clients need `rpc:com.publicdomainrelay.temp.wasm.run?aud=did:web:<host>%23emdash_integrations`.

## Consequences

- Anything that can act as the user at their PDS can run their modules on this site, without a browser session. That includes apps, bots and other services.
- The site's DID is tied to its hostname, so moving the site changes its DID.
- Errors follow XRPC: `AuthenticationRequired` as 401 and `InvalidRequest` as 400.
