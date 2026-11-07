# 0022. Deploy to Cloudflare Workers

Status: accepted.

## Context

The site ran only on Node, under fedproxy. The fork's Cloudflare runner had been tested in unit tests and in celld, but never on Cloudflare itself.

On the first deploy, `connect` failed with "Too many subrequests by single Worker invocation". The Cloudflare runner gives each sandboxed plugin invocation 10 subrequests and 50 ms of CPU. A site had no way to raise either limit. An OAuth connect alone needs more than 10 requests: DID document, handle, record, protected-resource and authorization-server metadata, PAR, plus storage calls.

## Decision

- One `astro.config.mjs` builds for both targets. `EMDASH_TARGET=cloudflare` selects the Cloudflare adapter, D1, R2 and the Worker Loader sandbox. Without it, the build uses Node, SQLite, local files and the workerd sandbox.
- `site/wrangler.jsonc` deploys the Worker `socialweb-computer-emdash` to the custom domain `exec.fedfork.com`. Its bindings:
  - D1 `DB`, R2 `MEDIA`, Worker Loader `LOADER`;
  - a per-minute cron;
  - `EMDASH_SITE_URL` as a var.
- `EMDASH_ENCRYPTION_KEY` is a Worker secret, generated with `emdash secrets generate`.
- The fork adds a `sandboxLimits` option to `emdash()` (commit `15473214e`). It is passed to the sandbox runner. The site sets `{ cpuMs: 1000, subrequests: 200 }`.
- Deploy credentials live in `~/.cloudflare_source` as `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token is scoped to:
  - Workers scripts, D1, R2 and KV;
  - routes, DNS and certificates on `fedfork.com`.

## Consequences

- `scripts/e2e.ts` passes against `https://exec.fedfork.com`: rounds, parallel runs, service auth, the PDS proxy, scrobbles and progressive scopes.
- WebAssembly runs in its own Worker Loader isolate, with no outbound network.
- The site's DID is `did:web:exec.fedfork.com`. Changing the host changes every OAuth `client_id` and the service-auth audience, so every session would have to be connected again.
- 200 subrequests covers a full run of 25 calls plus identity, blob, refresh and storage requests, with room to spare. A plugin that needs more must raise the limit again.
