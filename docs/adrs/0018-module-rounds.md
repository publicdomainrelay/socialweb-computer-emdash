# 0018. Modules run over rounds

Status: accepted

## Context

ADR 0015 ran a module once. The module planned every XRPC call up front and never saw a response, so it could not read before it wrote. Giving modules a `fetch` import would need host functions in every runner. Those would be synchronous calls into async I/O, which Workers can only support through JSPI or Asyncify. It would also put network access inside the isolate.

## Decision

- A module's output is `{ calls, next?, state?, result? }`.
- The plugin makes `calls` with the user's session. Each call becomes `{ nsid, ok, output | error }`, so a failed call does not end the run.
- When `next` names another export, the plugin runs it with the original input, a fresh `now`, the returned `state`, and the call `results`. Without `next`, the run ends and `result` is returned.
- Limits: 8 rounds, 10 calls per round, 25 calls per run.
- A `wasm.module` record may list `calls`, the NSIDs it may request. The plugin refuses any other. Without the list, the session's granted scopes are the only limit.
- The Statusphere module uses three rounds for `set_status`: list the latest status, write only if it changed, then report the new URI. `clear_status` lists statuses and deletes them.

## Consequences

- The ABI and every runner stay unchanged. Modules still have no imports, no network and no tokens.
- Every round instantiates the module afresh, so modules carry data between rounds only through `state`.
- A module that needs many small interactive calls still pays a host round trip per round.
