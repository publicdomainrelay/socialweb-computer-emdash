# 0017. WebAssembly modules on celld with a rustfs bucket

Status: accepted

## Context

ADR 0015 runs `com.publicdomainrelay.temp.wasm.module` records with ABI `emdash-wasm-json-v1`. ADR 0016 runs them on Cloudflare in a Dynamic Worker with a `{ wasm }` module and `globalOutbound: null`. We want the same runner on our own machines. [celld](https://github.com/denoland/celld) runs Wrangler projects, including Worker Loader bindings, and keeps its state in an S3-compatible bucket. [rustfs](https://github.com/rustfs/rustfs) is an S3-compatible object store that runs as one binary.

## Decision

- `celld/` is a Worker with one `worker_loaders` binding, `LOADER`. `GET /run?did=&rkey=&entry=&<field>=` resolves the DID's PDS, reads the module record, checks that the entry is a declared action, downloads the blob, and reads the SHA-256 digest from the blob CID (CIDv1, raw codec, sha2-256).
- The Worker gets `prepareWasmRun`, `generateWasmAbiRuntimeSource` and `WASM_LIMITS` from `dist/plugins/wasm.mjs` in the packed `emdash` tarball. That file has no imports, so esbuild bundles it without the rest of EmDash. The runner module, the Dynamic Worker id `emdash-wasm-<sha256>`, `globalOutbound: null` and `limits.cpuMs` match `packages/cloudflare/src/sandbox/bridge-wasm.ts` in the fork. The module input is the action's fields plus `did` and `now`.
- The Worker returns the module's JSON output, which is the list of planned XRPC calls. It holds no OAuth sessions and performs no calls. The site plugin still does both.
- `scripts/celld.sh` installs celld v0.6.3 from its GitHub release and checks the build attestation with `gh` when `gh` is installed. It installs rustfs 1.0.4 from its release zip and checks it against `SHA256SUMS`, and installs esbuild 0.28.2 with npm. Everything goes under `.celld/`. The script generates rustfs credentials into `.celld/credentials.env`, starts rustfs on loopback, creates the bucket, runs `celld deploy`, starts one celld node and calls `/run`. The rustfs install script needs root and systemd, so we do not use it.
- rustfs serves path-style requests only. celld uses path style when it has `--endpoint`, and `celld diagnose` passes the conditional-write probe against rustfs 1.0.4.

## Consequences

- The Statusphere module returns the same output on celld as `wasm/statusphere/test.mjs` gets in Node.js, for the valid input, the offset timestamp, the empty status and the invalid timestamp.
- celld reports a CPU limit as `Worker exceeded CPU limit of N ms`. The fork's Cloudflare runner looks for `exceeded CPU time limit`, so on celld it would report `WASM_TRAP` instead of `WASM_TIMEOUT`. Our Worker matches both messages.
- celld has no default CPU limit for a Dynamic Worker. Without `cpuMs`, a module that loops keeps a core busy after the caller's wall-time timeout gives up. With `cpuMs`, celld stops both JavaScript and WebAssembly loops at the limit.
- With `globalOutbound: null`, `fetch()` and `connect()` throw, including to loopback, and `globalThis` has no host functions. Without it, the loaded Worker inherits the loader's network access.
- celld allows `WebAssembly.Module` compilation at runtime in both the host and the loaded isolate. EmDash's own sandbox isolates refuse it. The design does not depend on that refusal.
- A Dynamic Worker shares the celld process with its loader. celld v0.6.3 is a beta and is not safe for hostile multi-tenant use, so a public deployment needs a container or VM boundary around the node.
- One bucket or prefix holds one application. celld self-fences when its bucket goes away, so `scripts/celld.sh down` stops celld before rustfs.
- celld does not list rustfs as a qualified store. A single local node is fine for development, but a fleet should use a qualified store.
