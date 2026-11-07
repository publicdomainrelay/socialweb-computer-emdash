# 0026. The studio as a site integration

Status: accepted. Supersedes the studio session in 0025 and amends the rule from 0010 and 0021 that only a record's own DID can authorize it.

## Context

- **The pattern.** The site asks for `atproto` at sign-in and nothing more. Every other capability is a new OAuth session, defined by an `oauth.clientMetadata` record and granted progressively by scope groups.
- **The 0025 studio broke the pattern.** It was an OAuth session with a hard-coded scope, stored under a reserved record key, `_studio`. That put special cases in the listing, the connect route and the module parser. Its scopes could not be granted one group at a time.
- **Why the studio was hard-coded.** Integration records come from the user's own repo, and only that account can authorize them. A user cannot publish the record that would let them publish records.
- **Why records must be restricted.** Client metadata is served from this site's origin. If any record from any account could be authorized by anyone, a stranger could publish a record and send people to a consent screen that names this site.

## Decision

- **Two sources of integrations.**
  - The user's own records, which only that account can authorize, as before.
  - Site integrations: records the operator vouches for.
- **Configuring site integrations.**
  - The operator lists AT-URIs, one per line, in the plugin setting `siteIntegrations`, declared in the plugin's settings schema.
  - An admin sets it in EmDash admin → Plugins → atproto integrations → Settings → Site integrations, or with the plugin route `admin/site-integrations`, which needs `plugins:manage` and keeps only valid `com.fedfork.exec.oauth.clientMetadata` URIs.
  - The plugin reads the list from its own settings: no network request and no cache.
  - Any signed-in account may authorize a site integration, for itself only.
  - A first version had the operator set a Worker variable, which the site served at a JSON route for the plugin to fetch from its own origin. It was dropped: on Cloudflare a Worker cannot fetch its own custom domain, and locally EmDash's sandbox blocks private addresses, so the fetch returned nothing and production offered no studio. Sandboxed plugins are configured through their settings, so the list lives there.
- **Sessions record their account.** A session now stores the account it was authorized for. For own records that is the record's DID; for site integrations it is the user's own DID. The session store and the token refresh both check it.
- **The studio is a site integration.**
  - It is the listed record with key `studio`, defined in `records/studio.json`.
  - It has two groups. `integrations` covers `repo:com.fedfork.exec.oauth.clientMetadata`. `modules` covers `repo:` on `wasm.module`, `source.file` and `source.manifest`, plus `blob:application/wasm`.
  - The plugin no longer defines a scope or reserves a key.
  - Studio publishing writes to the session's own account, not to a DID sent by the page.
- **Modules use own-record sessions only.** A module runs only with a session whose account is its record's own DID. A site integration session, such as the studio, cannot drive a module.
- **Defaults.**
  - A fresh deploy lists nothing, so it offers no site integrations and no studio until an admin sets the setting.
  - On exec.fedfork.com the admin is the operator account, for now the test account `did:plc:lpfuqerea3deuoyrn7ojser4`, and `scripts/e2e.ts` sets the list to that account's studio record.

## Consequences

- **One code path.** The studio uses the same connect flow, sealed storage, refresh lock and callback as every integration. It shows on `/integrations` as offered by this site, and its groups are granted progressively.
- **The examples ask for exactly what they need:** both studio groups.
- **Operators are responsible for what they list.** Whatever is listed in `siteIntegrations` reaches every visitor's consent screen under the site's name.
- **Changing the studio's scopes means republishing its record,** not shipping plugin code.
- **Setup step for new sites.** Until an admin sets `siteIntegrations`, the site offers no site integrations, and the studio reports that it is unavailable. The Deploy button cannot set it, because plugin settings live in the database, not in the Worker's configuration.
- **Older sessions still work.** Sessions created before this change have no stored account, and the plugin falls back to the record's DID, which matches how they were created.
- **Operator account.** The studio record lives on the test account until the project has a dedicated operator account.
