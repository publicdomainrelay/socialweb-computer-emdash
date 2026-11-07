# 0020. Minimal site

Status: accepted

## Context

The site started as EmDash's blog template, which brought posts, tags, categories, search, RSS, bylines and a 1,500-line layout. None of that is part of this project. The login provider was also kept as a copy in `packages/` after it was published to npm.

## Decision

- The site keeps only:
  - a landing page;
  - `/integrations`;
  - the per-record client metadata route;
  - `/xrpc/com.publicdomainrelay.temp.wasm.run`;
  - `/.well-known/did.json`.
- One layout and one stylesheet (`site/src/styles/site.css`) use system fonts and `light-dark()` tokens.
- The seed sets only the site title and the primary menu.
- The site depends on `@publicdomainrelay/auth-atproto-subscriber` from npm. `@publicdomainrelay/*` is excluded from pnpm's `minimumReleaseAge`, because we publish it ourselves.

## Consequences

- Nearly every tracked line is this project's own code.
- A database seeded from the blog template still holds its posts, but nothing renders them.
- Changes to the login provider go to its own repository and a new npm release.
