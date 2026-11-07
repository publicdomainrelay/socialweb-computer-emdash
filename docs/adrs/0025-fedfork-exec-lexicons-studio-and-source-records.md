# 0025. com.fedfork.exec lexicons, the studio, and module source records

Status: accepted; studio session superseded by 0026. Renames the lexicons from 0010, 0015 and 0019.

## Context

- **Lexicon names.** Our lexicons lived under `com.publicdomainrelay.temp.*`, which other publicdomainrelay projects also use. This work now runs at exec.fedfork.com.
- **Writing records needed a terminal.** Integration and module records could only be written with `goat` or our scripts. A user who signed in to the site with the `atproto` scope could read their integrations but could not write any.
- **Builds could not be checked.** A module record pointed at a WebAssembly blob and nothing else. No one could tell what source produced the blob, or rebuild it to check. Rust builds also embedded the builder's home directory through registry paths in panic messages, so two machines got different bytes from the same source.
- **Prior art.** knotless keeps git repositories entirely in atproto records: a repo record, ref records, and immutable pack records that hold their data inline or over blobs.

## Decision

- **Rename.** `com.publicdomainrelay.temp.oauth.clientMetadata`, `wasm.module` and `wasm.run` become `com.fedfork.exec.oauth.clientMetadata`, `com.fedfork.exec.wasm.module` and `com.fedfork.exec.wasm.run`.
  - Records on the test account were republished under the new names.
  - The `requester`, `compute` and `market` scopes in the socialweb-computer integration belong to other projects and keep their names.
- **Source records, after knotless.**
  - `com.fedfork.exec.source.file` holds one file, inline as `text` or as a blob, and is keyed by the sha256 of its contents. A file shared by many builds is stored once. A record is created only when its key is missing, and is never rewritten.
  - `com.fedfork.exec.source.manifest` is an immutable snapshot. It holds each path with a strong reference to its file, the build tool, compiler version, command and artifact, the output's sha256 and size, and the origin repository and commit. Its key is `<module>.<milliseconds>`.
  - `com.fedfork.exec.wasm.module` gains `source`, a strong reference to the manifest.
  - We did not store sources as git packs. A module's source is a handful of small files, and plain records can be read and checked without git.
- **Reproducible Rust builds.** `wasm/build.sh` sets `RUSTFLAGS` to remap `$CARGO_HOME` to `/cargo` and the workspace to `/wasm`. Cargo's `trim-paths` would do the same, but it is not stable in Cargo 1.97. The manifest's command is `./build.sh`.
- **Publishing and verifying.**
  - `scripts/publish-wasm.sh` publishes the files, the manifest and the module together.
  - `scripts/verify-source.sh` rebuilds a module from its PDS records and compares the result with the manifest and the published blob.
  - Verification runs the build in Podman or Docker, never on the host, because the build command comes from someone's record.
- **The studio session.**
  - The plugin defines a built-in OAuth client for the signed-in user's own DID, stored under the reserved record key `_studio`. Its scopes are `repo:` on the four `com.fedfork.exec` record collections plus `blob:application/wasm`.
  - It reuses the existing client, sealing, callback and refresh lock.
  - `_studio` is refused as an integration record key, hidden from the integrations list, refused by the normal connect route, and refused as a module's `session`.
  - We kept the login at `atproto` rather than widening the login provider's scope. Every signed-in user would otherwise hand the site write access, even users who never use the studio.
- **AssemblyScript in the browser.**
  - The module editor compiles AssemblyScript with `asc` 0.28.20, pinned exactly, using the stub runtime and `--use abort=`, so modules import nothing.
  - The compiler and Binaryen, about 13.5 MB, load only on the editor and source pages.
  - Editor modules include an `abi.ts` with JSON and ABI helpers.
  - The manifest records the equivalent `npx asc` command. We checked that it produces the same bytes as the browser.

## Consequences

- **Verified rebuild.** Vibescrobble rebuilt from the test account's PDS records alone, in a clean `rust:1.97.0` container, is byte-identical to the manifest's output and the published blob: `facaba4110ec5a77738955d45d3a2ed79e795f2ceedce5cb5643973045bc3e0a`.
- **Toolchain pinning.** Rebuilding needs the same compiler version. Upgrading Rust or AssemblyScript changes the bytes, so a republished module gets a new manifest.
- **Old records stay.** Older records under `com.publicdomainrelay.temp.*` still exist in the test account but are no longer read. Sessions connected before the rename are keyed by the same DID and record key, so they keep working.
- **Studio access.** The studio can write any of the user's `com.fedfork.exec` records. It cannot write any other collection, and no module can run with its session.
- **Lexicon resolution.** NSIDs under `com.fedfork.exec` resolve through `exec.fedfork.com`. Publishing the lexicons for resolution is still to do.
