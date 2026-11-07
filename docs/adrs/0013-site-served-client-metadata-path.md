# 0013. Site-served client metadata path

Status: accepted

## Context

A single plugin needs one `client_id` per integration. `@atproto/oauth-provider` rejects any `client_id` that contains a query string. Plugin routes are fixed names, with no path parameters and no `.` in the name. Anonymous requests to public pages get a reduced `locals.emdash` that exposes only `handlePublicPluginApiRoute`.

## Decision

- The Astro site serves `src/pages/integrations/[did]/[rkey]/oauth-client-metadata.json.ts`. It calls the plugin's public `client-metadata` route through `handlePublicPluginApiRoute` and returns the raw JSON.
- `/integrations` calls the private plugin routes from server code through `handlePluginApiRoute` with the session user. In the browser it calls them with `X-EmDash-Request: 1`, so EmDash's CSRF check uses the configured `siteUrl`.

## Consequences

- The plugin keeps every OAuth and templating decision. The site only provides the URL shape and the UI.
- Dropping the plugin into another EmDash site also needs these two site files.
