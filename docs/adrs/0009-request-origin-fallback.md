# 0009. Request origin fallback for the site URL

Status: accepted

## Context

`ctx.site.url` is read when the EmDash runtime starts. On a fresh site it stays empty until setup records an origin and the runtime restarts. After that the recorded origin persists in the database, even if `EMDASH_SITE_URL` changes later. Building a `client_id` or `redirect_uri` from an empty origin throws `Invalid URL string`.

## Decision

`integrationRoutes()` builds the `oauth/client-metadata`, `oauth/callback` and `admin` routes. When `ctx.site.url` is empty, these routes fall back to the request origin. Plugins pass only their page handlers, and the Connect page handler always runs first.

## Consequences

- `pnpm dev` followed by Connect works on a brand-new database, with no restart.
- Moving between loopback and a fedproxy origin needs a fresh `site/data.db` or **Change domain** in EmDash settings.
- Hooks have no request, so before setup they still see an empty origin. They act only on an existing session, which requires a completed Connect.
