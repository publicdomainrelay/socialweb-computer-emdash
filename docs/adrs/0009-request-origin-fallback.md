# 0009. Request origin fallback for the site URL

Status: accepted

## Context

`ctx.site.url` is read when the EmDash runtime starts. On a fresh site it stays empty until setup records an origin and the runtime restarts. After that the recorded origin persists in the database, even if `EMDASH_SITE_URL` changes later. Building a `client_id` or `redirect_uri` from an empty origin throws `Invalid URL string`.

## Decision

The `connect` route uses `ctx.site.url` and falls back to the request origin when it is empty. The origin chosen at connect time is stored with the integration, so the served client metadata and the callback always use the same `client_id` and `redirect_uri`.

## Consequences

- `pnpm dev` followed by a connect works on a brand-new database, with no restart.
- Moving between loopback and a fedproxy origin needs a fresh `site/data.db` or **Change domain** in EmDash settings.
- Hooks have no request, so before setup they still see an empty origin. They act only on an existing session, which requires a completed Connect.
