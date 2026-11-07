# 0006. Unrestricted network capability for identity resolution

Status: accepted

## Context

OAuth needs requests to the user's handle domain, the DID directory, the user's PDS and its authorization server. All of these are known only at runtime. `network:request` with a fixed `allowedHosts` list would limit an integration to one hosting provider.

## Decision

Both plugins declare `network:request:unrestricted` with an empty `allowedHosts`. The sandbox bridge still allows only HTTP(S), blocks private and internal addresses, rechecks every redirect and strips credentials across origins.

## Consequences

- Operators see the unrestricted capability at install time. The README states why.
- Self-hosted PDSes on private networks cannot connect through the sandbox.
