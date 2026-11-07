# 0007. Small sandbox bundles without zod

Status: accepted

## Context

The registry caps each file in a plugin tarball at 128 KB, decompressed. With zod bundled, the Statusphere `backend.js` was 103 KB before the plugin had any features. EmDash route names must also match `^[a-zA-Z0-9][a-zA-Z0-9_\-/]*$`, so a route cannot end in `.json`.

## Decision

- Admin interactions are validated by the small helpers in `atproto-oauth-sandbox/src/interaction.ts` (`parseInteraction`, `text`, `optionalText`, `textList`) instead of zod.
- The CIMD route is `oauth/client-metadata`. A `client_id` only has to be an HTTPS URL that serves the JSON, so no `.json` suffix is needed.
- `atproto-oauth-sandbox/testing` holds the shared sandbox-test helpers. Tests import it and the runtime bundle does not.

## Consequences

- The Statusphere bundle is about 17 KB, which leaves room for richer integrations.
- Validation is hand-written, so every plugin input goes through these helpers.
