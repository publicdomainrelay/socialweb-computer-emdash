# Contributing

This repo is an EmDash site, the sandboxed `atproto-integrations` plugin, Rust WebAssembly modules, and the lexicons and records that tie them together. The live site at https://exec.fedfork.com explains how it all works. Start with [How it works](https://exec.fedfork.com/how-it-works).

## Set up

You need:
- Node 24.12 or later;
- pnpm 11.9.0. Corepack picks it up from `packageManager`;
- Rust stable with `rustup target add wasm32-unknown-unknown`, for modules;
- `goat`, `jq` and `curl`, for records and the CLI examples;
- an atproto test account with an app password. Never use your main password.

```bash
git clone https://github.com/publicdomainrelay/socialweb-computer-emdash
cd socialweb-computer-emdash
pnpm install
pnpm build
pnpm dev
```

- Open http://127.0.0.1:4321/integrations. OAuth works on `127.0.0.1` with loopback client IDs.
- `pnpm install` takes the EmDash fork's packages from a GitHub release. You do not need the `emdash` submodule unless you change the fork.

## Where things live

| Path | What |
| --- | --- |
| `site/` | Astro and EmDash site: guide pages, `/integrations`, `did:web`, the `wasm.run` XRPC endpoint |
| `site/src/diagrams.ts` | Every Mermaid diagram on the site, drawn by [Pele](https://pele.run) |
| `plugins/atproto-integrations-emdash/` | The sandboxed plugin: OAuth, sealed sessions, module rounds, service auth |
| `wasm/` | Cargo workspace: `abi`, `statusphere`, `vibescrobble`, plus `harness.mjs` for tests |
| `lexicons/` | `com.publicdomainrelay.temp.*` lexicons |
| `records/` | Integration records, and module records in `records/wasm/` |
| `scripts/` | Publishing, e2e, fedproxy, celld, fork packaging |
| `emdash/` | The EmDash fork, as a submodule. See [docs/emdash-fork.md](docs/emdash-fork.md) |
| `docs/adrs/` | Architecture decision records |

## Check your change

Run what your change touches. Run all of it before a release.

```bash
pnpm test
pnpm --filter atproto-integrations-emdash typecheck
(cd site && pnpm build)
(cd site && pnpm build:cloudflare)
```

`pnpm test` runs the plugin's sandbox tests and every `wasm/*/test.mjs`. Rebuild modules first with `./wasm/build.sh` when you change Rust.

### Live end-to-end run

`scripts/e2e.ts` drives a real site as your test account. It covers:
- sign-in and connecting each integration;
- module rounds and parallel runs;
- service auth and a replayed token;
- the PDS proxy;
- a scrobble, which it then deletes.

```bash
export ATPROTO_HANDLE=you.bsky.social ATPROTO_PASSWORD='app-password'
./scripts/publish-records.sh
./scripts/publish-wasm.sh statusphere
./scripts/publish-wasm.sh vibescrobble
SITE_URL=http://127.0.0.1:4321 pnpm exec node scripts/e2e.ts
```

Service auth needs a public origin. For that part, run the dev server behind `./scripts/fedproxy.sh` or any HTTPS tunnel, and set `EMDASH_SITE_URL`.

### Look at the pages

For changes to the site, check each page you touched in three views: light, dark, and a 390 px wide window. Headless Chromium does this without a browser window:

```bash
chromium-browser --headless=new --window-size=1280,2400 --screenshot=light.png http://127.0.0.1:4321/deploy
chromium-browser --headless=new --force-dark-mode --blink-settings=preferredColorScheme=0 --window-size=1280,2400 --screenshot=dark.png http://127.0.0.1:4321/deploy
chromium-browser --headless=new --window-size=390,2400 --screenshot=mobile.png http://127.0.0.1:4321/deploy
```

## Common changes

### A diagram

1. Add or edit it in `site/src/diagrams.ts`.
2. Give nodes the shared color classes (`you`, `pds`, `site`, `sandbox`, `wasm`, `store`, `cloud`, `deny`) so they match the legend.
3. Render it with `<Diagram code={…} label="…" />`. The label is the text screen readers get, so describe the diagram in it.
4. Pele throws on syntax it cannot parse, and pages render on request. Load each page you changed, so a broken diagram shows up as a failed page now rather than in production.

### A guide page

1. Add the page under `site/src/pages/` with the `Guide` layout.
2. Add it to `site/src/guides.ts` so it shows in the header, the overview and the pager.

### A WebAssembly module

1. Add a crate under `wasm/` that uses `abi::entries!`, and list it in `wasm/Cargo.toml`.
2. Add a `module.json` and a `test.mjs`.
3. Add the crate's name to the loop in `wasm/build.sh`.
4. Publish with `./scripts/publish-wasm.sh <name>`.

The [Write a module](https://exec.fedfork.com/modules) guide walks through a complete example.

### An integration record

1. Add `records/<rkey>.json`.
2. Validate it with `goat lex validate -c lexicons records/<rkey>.json`.
3. Publish with `./scripts/publish-records.sh`.
4. Republish any module that points at it, because a module record pins its integration's CID.

### The EmDash fork

Follow [docs/emdash-fork.md](docs/emdash-fork.md): change and test in `emdash/`, push the fork branch, run `./scripts/release-emdash-fork.sh`, then commit the overrides, lockfile and submodule pointer together.

## Conventions

- **No code comments.** Names and structure carry the meaning. Put rationale in an ADR.
- **One ADR per significant decision.** Add `docs/adrs/NNNN-short-concept.md` with the next number and these sections: Status, Context, Decision, Consequences. When a decision replaces an older one, mark the older one superseded.
- **Use vetted libraries through their public exports.** For example, `@atcute/*` for OAuth, identity and crypto, and `@scure/base` for encodings.
  - Never hand-roll crypto or re-declare a library's constants.
  - Prefer clear code over a smaller bundle. The one hard limit is EmDash's 128 KB per-file cap on plugin bundles.
- **Lexicons are temporary.** NSIDs under `com.publicdomainrelay.temp.*` may change.
- **Commit messages** use a type and scope, such as `feat(site): …` or `fix(deploy): …`. The body says why.
- **Keep the README runnable.** Explanations belong on the site's guide pages.

## Deploying

- **Your own copy:** use the Deploy to Cloudflare button, or `pnpm run deploy`. See [Deploy your own](https://exec.fedfork.com/deploy).
- **exec.fedfork.com itself:** maintainers deploy it with `pnpm run deploy:fedfork`. Plain `pnpm run deploy` on that account would rebind the production Worker to new, empty resources.
- **After any deploy,** run `scripts/e2e.ts` against the deployed site.
- **Throwaway Workers:** when you test a deploy on a temporary Worker, delete its D1 database, R2 bucket and KV namespace afterwards as well.

## Releases

- **Tags:** release candidates are annotated tags `v0.0.0-rcN`.
- **Fork packages:** these are released separately, as `emdash-fork-<commit>`.
- **Before you tag:**
  1. tests pass;
  2. both site builds work;
  3. the production deploy is updated;
  4. e2e passes against it;
  5. the README and ADRs match the code.

## Secrets

- **Never commit credentials,** and never print them in logs or issues.
- **Local secrets** go in files outside the repo, or in `.dev.vars`, which git ignores. `.dev.vars.example` lists what is needed.
- **Use scoped credentials:**
  - a Cloudflare API token, not the Global API Key;
  - an app password for your test account.
