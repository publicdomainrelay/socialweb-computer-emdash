# 0007. Sandbox bundle file cap

Status: accepted

## Context

The EmDash registry caps each file in a plugin tarball at 128 KB, decompressed. The whole plugin builds into one `plugin.mjs`. Everything the plugin imports is bundled into that file, because sandboxed plugins cannot load packages at runtime. EmDash route names must also match `^[a-zA-Z0-9][a-zA-Z0-9_\-/]*$`, so a route cannot end in `.json`.

## Decision

- Use vetted libraries through their public exports for anything security-sensitive:
  - `@atcute/crypto` for atproto Multikey parsing and service-auth signatures;
  - `@scure/base` for base58, base32 and base64url;
  - `@atcute/oauth-node-client` and `@atcute/identity-resolver` for OAuth and identity;
  - WebCrypto for AES-GCM.
  Never re-implement or re-declare their internals to save bytes.
- They go in `devDependencies`, because the plugin build bundles `devDependencies` and leaves `dependencies` external.
- Route input is checked by small hand-written parsers (`parseRef`, `parseRecord`, `parseModuleRecord`). zod would not fit alongside the crypto libraries under the cap.
- The CIMD route is `oauth/client-metadata`. A `client_id` only has to be an HTTPS URL that serves the JSON, so no `.json` suffix is needed.
- Test helpers live in `tests/`, outside the runtime bundle.

## Consequences

- `plugin.mjs` is about 93 KB. Watch the size when adding dependencies. If the cap is reached, split the plugin rather than replace a library with our own code.
