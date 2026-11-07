# 0001. One OAuth client per sandboxed plugin

Status: accepted

## Context

The site signs editors in with `@emdash-cms/auth-atproto`, which asks only for the `atproto` scope. Integrations such as Statusphere or the socialweb.computer requester need write access to lexicons the site does not own. In the Bluesky thread `at://did:plc:5svqtrhheairglgiiyvutzik/app.bsky.feed.post/3mzntqv77r22h`, the replies pointed out that each integration runs in its own trust context. Each one should therefore publish its own client metadata document (CIMD) with its own scopes. A permission set can only cover NSIDs under its own authority, so cross-namespace integrations cannot share one set.

EmDash sandboxed plugins already run in isolated workerd services. Each one has its own plugin-scoped settings, KV and storage.

## Decision

Each sandboxed plugin is a separate atproto OAuth client:

- `client_id` is `/_emdash/api/plugins/<slug>/oauth-client-metadata.json`, served by a public raw route of that plugin.
- `redirect_uri` is `/_emdash/api/plugins/<slug>/oauth/callback`, also on the plugin.
- Tokens, DPoP keys and pending requests stay in that plugin's settings, which no other plugin or the site login can read.

The site login session and the integration sessions are independent. An editor signs in to EmDash with one account, and each integration can connect any account.

## Consequences

- A compromised plugin can only use the tokens it was granted.
- The user sees a distinct client on the consent screen for each integration.
- Adding an integration means adding a plugin, not editing a shared scope list on the host.
