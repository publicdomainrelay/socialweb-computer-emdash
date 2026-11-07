# 0010. Integrations defined by clientMetadata records

Status: accepted

## Context

Each integration was a separately built and installed plugin. We want one plugin that acts as any number of atproto OAuth clients. Users decide which integrations exist by publishing data, not by having code installed.

## Decision

- Lexicon `com.publicdomainrelay.temp.oauth.clientMetadata` (`lexicons/`), record key `any`. It holds `name`, `description`, `clientMetadata` (a CIMD template) and optional `scopeGroups`.
- `records/` holds the two example records published to alice: `socialweb-computer` (the qr.fedfork.com CIMD verbatim) and `statusphere`. `scripts/publish-records.sh` validates them against the lexicon and publishes them with goat.
- The single sandboxed plugin `atproto-integrations` lists a signed-in user's records from their PDS. For each record it serves client metadata that rebases the template onto the site:
  - `client_id` becomes `<origin>/integrations/<did>/<rkey>/oauth-client-metadata.json`;
  - `redirect_uris` becomes the plugin callback;
  - `client_uri`, `logo_uri`, `tos_uri` and `policy_uri` keep their path, with the template origin replaced by the site origin;
  - the client is always public and DPoP-bound (`token_endpoint_auth_method: none`), whatever the template says.
- The plugin serves metadata only for records a signed-in user has started connecting. It stores a copy of the record when the user connects.
- A token is accepted only when its `sub` equals the DID that published the record. A record can therefore never obtain tokens for anyone else's account, which removes the phishing value of a site-hosted CIMD.

## Consequences

- Adding an integration means publishing a record, with no deploy.
- Record authors control the scope set. The site still decides which DIDs can sign in (ADR 0012).
