# 0002. Progressive scope groups

Status: accepted

## Context

Per atproto [progressive scope requests](https://atproto.com/guides/oauth-patterns#progressive-scope-requests), the CIMD `scope` declares the maximum set of scopes. Each authorization request may ask for a subset. Integrations often need a few scopes now and more later.

## Decision

Each integration record may carry an ordered list of `scopeGroups: [{ key, label, scopes[] }]`.

- The served CIMD `scope` is the record's declared `clientMetadata.scope`.
- `/integrations` asks for `atproto` plus the scopes of the selected groups, filtered to the declared scope. With no groups selected, or none defined, it asks for the full declared scope.
- To upgrade, the plugin starts a new authorization with the granted groups plus the newly selected ones. On callback it replaces the session.
- Granted groups come from the `scope` that the token response returns. The user may refine scopes at the authorization server, so the plugin trusts the response and ignores what it asked for.

Scope strings are compared exactly, so every group scope must appear verbatim in the declared scope.

## Consequences

- First consent stays small.
- The record author changes groups or scopes by updating the record. The next connect re-reads it, so no plugin release is needed.
