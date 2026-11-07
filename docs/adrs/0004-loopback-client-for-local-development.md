# 0004. Loopback client for local development

Status: accepted

## Context

An authorization server must fetch the CIMD from a public HTTPS URL. A dev server on `127.0.0.1:4321` is not reachable. The atproto OAuth spec defines a virtual loopback client: `client_id` is `http://localhost` with `redirect_uri` and `scope` query parameters, and the redirect URI uses `127.0.0.1`, ignoring the port.

## Decision

When the site origin is `localhost`, `127.0.0.1` or `[::1]`, the plugin uses `http://localhost?redirect_uri=…&scope=…` as its `client_id`. The declared scope is still the full union of groups, so progressive upgrades work the same way locally. `localhost` site URLs are rewritten to `127.0.0.1`, and Astro binds to `127.0.0.1` (`server.host`), matching the EmDash Atmosphere login guidance.

## Consequences

- `pnpm dev` works against real PDSes such as bsky.social, with no tunnel.
- Loopback clients are public clients with short-lived sessions. Production uses the served CIMD.
