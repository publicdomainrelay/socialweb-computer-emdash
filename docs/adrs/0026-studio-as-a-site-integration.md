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
  - The operator lists AT-URIs, separated by spaces, in the Worker variable `EMDASH_SITE_INTEGRATIONS`.
  - The site serves the list at `/integrations/site.json`.
  - The plugin fetches it from its own request origin and caches it for five minutes.
  - Any signed-in account may authorize a site integration, for itself only.
- **Sessions record their account.** A session now stores the account it was authorized for. For own records that is the record's DID; for site integrations it is the user's own DID. The session store and the token refresh both check it.
- **The studio is a site integration.**
  - It is the listed record with key `studio`, defined in `records/studio.json`.
  - It has two groups. `integrations` covers `repo:com.fedfork.exec.oauth.clientMetadata`. `modules` covers `repo:` on `wasm.module`, `source.file` and `source.manifest`, plus `blob:application/wasm`.
  - The plugin no longer defines a scope or reserves a key.
  - Studio publishing writes to the session's own account, not to a DID sent by the page.
- **Modules use own-record sessions only.** A module runs only with a session whose account is its record's own DID. A site integration session, such as the studio, cannot drive a module.
- **Defaults.**
  - The top level of `wrangler.jsonc` lists this project's studio record, so a Deploy-button site has a studio right away.
  - `env.fedfork` lists it as well.
  - For now the operator account is the test account, `did:plc:lpfuqerea3deuoyrn7ojser4`.

## Consequences

- **One code path.** The studio uses the same connect flow, sealed storage, refresh lock and callback as every integration. It shows on `/integrations` as offered by this site, and its groups are granted progressively.
- **The examples ask for exactly what they need:** both studio groups.
- **Operators are responsible for what they list.** Whatever is listed in `EMDASH_SITE_INTEGRATIONS` reaches every visitor's consent screen under the site's name.
- **Changing the studio's scopes means republishing its record,** not shipping plugin code.
- **Self-fetch dependency.** The plugin depends on fetching `/integrations/site.json` from its own origin. When that fetch fails, the site offers no site integrations, and the studio reports that it is unavailable.
- **Older sessions still work.** Sessions created before this change have no stored account, and the plugin falls back to the record's DID, which matches how they were created.
- **Operator account.** The studio record lives on the test account until the project has a dedicated operator account.
