# 0023. Vibescrobble module and a shared ABI crate

Status: accepted.

## Context

atirc turns emoji-led channel lines into `com.vibescrobble.scrobble` records, written with `validate: false`, of the shape `{text, emoji, createdAt, task, agentType?}`. vibescrobble.com indexes them. We want the same records from a WebAssembly module, run with the user's own session.

A second module would have copied the statusphere crate's ABI glue: `alloc`, the packed pointer and length, JSON in and out, and call results.

## Decision

- `wasm/` is a Cargo workspace. The `abi` crate holds the shared pieces:
  - `Did`, which rejects anything that does not start with `did:`;
  - `CallResult` and `first_output`;
  - `respond`;
  - the `entries!` macro, which exports `alloc` and one function per entry.
- `wasm/vibescrobble` has two entries, `scrobble` and `scrobble_done`. `scrobble` checks that the text starts with an emoji, using the same rule as atirc's `leading_emoji`. It truncates the text to 256 graphemes or 2560 bytes and makes one `createRecord` call.
- `records/vibescrobble.json` is the integration. Its scope is `atproto repo:com.vibescrobble.scrobble?action=create`.
- The module record allows only `com.atproto.repo.createRecord`.
- Each module keeps a `module.json` spec. `scripts/publish-wasm.sh <module>` fills in the blob, the session CID and `createdAt`, then publishes the record.
- `wasm/build.sh` builds every module. `wasm/harness.mjs` is the shared test driver.

## Consequences

- A new module is one crate, one `module.json` and one `test.mjs`.
- The rebuilt statusphere binary has a new blob CID. Its module record was published again.
- `scripts/e2e.ts` posts a scrobble, reads it back from the PDS, and deletes it, so runs leave nothing on vibescrobble.com.
- No `com.vibescrobble.scrobble` lexicon is published, so the record shape follows atirc.
