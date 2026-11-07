# 0016. EmDash fork for sandboxed WebAssembly

Status: accepted

## Context

EmDash's Cloudflare and Node runners load only JavaScript modules into plugin isolates, and both isolates refuse `WebAssembly.compile` ("Wasm code generation disallowed by embedder"). Nobody has raised WebAssembly in the upstream issues, pull requests or Discussions.

## Decision

- Fork to https://github.com/publicdomainrelay/emdash, branch `wasm-blob-sandbox`, checked out as the `emdash` submodule. The design is `emdash/proposals/sandboxed-wasm-modules.md`.
- The fork adds a `wasm:execute` capability and `ctx.wasm.run({ module, entry, input, sha256 })`. The host runs modules outside the plugin isolate: in a `node:worker_threads` worker on Node.js, and in a Dynamic Worker with a `{ wasm }` module on Cloudflare. Modules get no imports, no network and no storage, under fixed size, memory and wall-time limits.
- `scripts/emdash-fork.sh` builds the fork and packs `emdash`, `plugin-types`, `plugin-cli`, `plugin-test`, `sandbox-workerd` and `cloudflare` into `vendor/emdash-fork`. pnpm `overrides` in `pnpm-workspace.yaml` install those tarballs in place of the npm releases.
- We do not open pull requests or comment upstream.

## Consequences

- A fresh clone must run `scripts/emdash-fork.sh` before `pnpm install`.
- Every repack changes tarball integrity hashes in `pnpm-lock.yaml`.
- Upgrading EmDash means rebasing the fork branch.
