# 0007. Small sandbox bundles without zod

Status: accepted

## Context

The registry caps each file in a plugin tarball at 128 KB, decompressed. With zod bundled, the Statusphere `backend.js` was 103 KB before the plugin had any features. EmDash route names must also match `^[a-zA-Z0-9][a-zA-Z0-9_\-/]*$`, so a route cannot end in `.json`.

## Decision

- Route input is validated by small hand-written checks (`parseRef`, `parseRecord`) instead of zod.
- The CIMD route is `oauth/client-metadata`. A `client_id` only has to be an HTTPS URL that serves the JSON, so no `.json` suffix is needed.
- Sandbox-test helpers live in `plugins/atproto-integrations-emdash/tests/network.ts`. Tests import them and the runtime bundle does not.

## Consequences

- The `atproto-integrations` bundle is about 14 KB.
- Validation is hand-written, so every plugin input goes through these helpers.
