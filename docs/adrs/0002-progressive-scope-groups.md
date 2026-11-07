# 0002. Progressive scope groups

Status: accepted

## Context

Per atproto [progressive scope requests](https://atproto.com/guides/oauth-patterns#progressive-scope-requests), the CIMD `scope` declares the maximum set of scopes. Each authorization request may ask for a subset. Integrations often need a few scopes now and more later.

## Decision

Each plugin defines an ordered list of `ScopeGroup { id, label, scopes[] }`.

- The CIMD `scope` is `atproto` plus the union of every group's scopes.
- The Connect page asks for `atproto` plus the selected groups only.
- To upgrade, the plugin starts a new authorization with the granted groups plus the newly selected ones. On callback it replaces the session.
- Granted groups come from the `scope` that the token response returns. The user may refine scopes at the authorization server, so the plugin trusts the response and ignores what it asked for.
- Features call `agent.requireGroup(id)` before they act. A missing group raises `MissingScopeError`, which the UI turns into an upgrade prompt.

Scope strings are compared exactly, so every string a plugin may request appears verbatim in its CIMD.

## Consequences

- First consent stays small.
- Changing group membership changes the CIMD. That is a trust-contract change for operators and needs a new plugin version.
