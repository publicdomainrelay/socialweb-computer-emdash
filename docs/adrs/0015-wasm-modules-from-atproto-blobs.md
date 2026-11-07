# 0015. WebAssembly modules stored as atproto blobs

Status: accepted, amended by 0018 (rounds) and 0019 (service auth)

## Context

An integration session only becomes useful when something calls the right lexicons with it. Hard-coding each integration's API calls in the plugin is the per-integration plugin design that ADR 0010 replaced. The EmDash sandbox refuses runtime WebAssembly compilation, so a plugin cannot simply run code it downloads.

## Decision

- Lexicon `com.publicdomainrelay.temp.wasm.module` (`lexicons/`, key `any`) holds `name`, a `module` blob (`application/wasm`, at most 4 MiB), `abi: "emdash-wasm-json-v1"`, a `session` strong reference to the `clientMetadata` record whose session it uses, and `actions`. Each action has an `entry` export, a `label` and optional string `fields`.
- `wasm/statusphere` is a Rust `cdylib` built on `atproto-record` from https://tangled.org/ngerakines.me/atproto-crates. It exports `alloc` and `set_status`, has no imports, and returns `{"calls":[{"nsid":"com.atproto.repo.createRecord",...}]}`. `scripts/publish-wasm.sh` builds it, uploads the blob and puts the record.
- The `atproto-integrations` plugin declares `wasm:execute`, a capability added in our EmDash fork (ADR 0016). On `run` it:
  1. reads the module record and checks that the entry is a declared action;
  2. requires the user's session for the referenced `clientMetadata` record;
  3. downloads the blob with `com.atproto.sync.getBlob`;
  4. passes the SHA-256 from the blob's CID as `sha256`, so the host refuses swapped bytes;
  5. runs the module with the user's input plus `did` and `now`;
  6. performs at most 10 returned XRPC calls with that session.
- The module never sees a token. It can only ask for calls, and the authorization server already limits the session to the scopes the user granted.

## Consequences

- New integrations ship as data plus a small module, with no site deploy.
- The ABI is pure JSON in and out. Modules that need a clock receive `now` as input.
- Anyone can publish a module record for a session type. The page lists modules only from the signed-in user's own repo.
