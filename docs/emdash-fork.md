# The EmDash fork: how we patch it and release it

This site needs EmDash features that upstream does not have yet. We keep them on a fork and ship the fork's packages as tarballs on a GitHub release of this repo. `pnpm install` swaps them in for the upstream packages.

- Fork: [publicdomainrelay/emdash](https://github.com/publicdomainrelay/emdash), branch [`wasm-blob-sandbox`](https://github.com/publicdomainrelay/emdash/tree/wasm-blob-sandbox).
- In this repo, the fork is the `emdash/` submodule.
- Spec: [`proposals/sandboxed-wasm-modules.md`](https://github.com/publicdomainrelay/emdash/blob/wasm-blob-sandbox/proposals/sandboxed-wasm-modules.md).
- Decisions: [ADR 0016](adrs/0016-emdash-fork.md), [ADR 0022](adrs/0022-cloudflare-workers-deploy.md), [ADR 0024](adrs/0024-site-guides-and-deploy-button.md).

## What the fork adds

| Commit | Change |
| --- | --- |
| `fcfc6960b` | `wasm:execute` capability, `ctx.wasm.run`, and a JSON ABI runner in core |
| `024d16fa8` | WebAssembly runner for Node workerd and Miniflare |
| `db1525cdd` | WebAssembly runner in Cloudflare Worker Loader isolates, with `globalOutbound: null` |
| `5a41f0d11` | Lint fix in the ABI runner |
| `7116133f0` | Test that evaluates generated wasm sources with `node:vm` |
| `dacc55fdf` | celld's CPU-limit message maps to `WASM_TIMEOUT` |
| `c0653a169` | Spec update for module rounds and service-auth runs |
| `04769ba75` | plugin-cli bundles the `workerd`, `worker` and `browser` builds of dependencies |
| `c28373a85` | The Miniflare dev runner uses the production compatibility date and `nodejs_compat` |
| `15473214e` | `sandboxLimits` option on `emdash()`. Cloudflare's default of 10 subrequests breaks OAuth connect |

Each fix commit comes with a test that fails without it. Each change to a published package comes with a changeset.

## How the site gets the fork

`pnpm-workspace.yaml` overrides six packages with tarballs from the release `emdash-fork-<commit>`:

| Package | Version |
| --- | --- |
| `emdash` | 1.4.0 |
| `@emdash-cms/cloudflare` | 1.4.0 |
| `@emdash-cms/sandbox-workerd` | 0.9.6 |
| `@emdash-cms/plugin-cli` | 0.13.5 |
| `@emdash-cms/plugin-types` | 0.6.0 |
| `@emdash-cms/plugin-test` | 0.2.11 |

```yaml
overrides:
  emdash: https://github.com/publicdomainrelay/socialweb-computer-emdash/releases/download/emdash-fork-15473214e/emdash-1.4.0.tgz
  "@emdash-cms/cloudflare": https://github.com/publicdomainrelay/socialweb-computer-emdash/releases/download/emdash-fork-15473214e/emdash-cms-cloudflare-1.4.0.tgz
```

- **Overrides, not dependencies.** Overrides replace every copy in the tree, including the ones our dependencies pull in.
- **Pinned contents.** `pnpm-lock.yaml` records each tarball's integrity hash, so a changed asset fails the install.
- **No exotic-subdependency block.** `blockExoticSubdeps` is `false`. pnpm counts a URL override as an exotic subdependency, because packages such as `@emdash-cms/plugin-test` depend on `@emdash-cms/cloudflare`. With the block on, the install fails with `ERR_PNPM_EXOTIC_SUBDEP`.
- **Release cooldown.** `minimumReleaseAgeExclude` lists `emdash` and `@emdash-cms/*`, so the 1440-minute release cooldown does not apply to them.

## Release a fork change

1. **Change the fork.** Work in `emdash/` on `wasm-blob-sandbox`. Before you commit, run the fork's checks for the packages you touched:

   ```bash
   cd emdash
   pnpm --filter emdash test
   pnpm lint
   pnpm typecheck
   pnpm format
   ```

2. **Add a changeset** under `emdash/.changeset/` for each published package you changed.

3. **Commit and push the fork:**

   ```bash
   git -C emdash commit -am "feat(core): …"
   git -C emdash push origin wasm-blob-sandbox
   ```

4. **Pack and release.** Run this from the repo root:

   ```bash
   ./scripts/release-emdash-fork.sh
   ```

   The script:
   1. reads the submodule's commit, for example `15473214e`;
   2. if the release `emdash-fork-<commit>` does not exist yet:
      - runs `scripts/emdash-fork.sh`, which installs and builds the fork and packs the six packages into `vendor/emdash-fork/`;
      - creates the GitHub release as a prerelease and uploads the tarballs;
   3. rewrites the overrides in `pnpm-workspace.yaml` to the release URLs;
   4. runs `pnpm install` to update the lockfile.

5. **Commit the site side.** That is `pnpm-workspace.yaml`, `pnpm-lock.yaml` and the `emdash` submodule pointer:

   ```bash
   git add pnpm-workspace.yaml pnpm-lock.yaml emdash
   git commit -m "chore: use EmDash fork packages <commit>"
   ```

6. **Verify, deploy and push.** In order:

   ```bash
   pnpm test
   pnpm run deploy:fedfork
   SITE_URL=https://exec.fedfork.com pnpm exec node scripts/e2e.ts
   git push origin main
   ```

   Push only after the e2e run passes. Anyone who pulls `main` gets the new tarballs on their next `pnpm install`.

## Rules for releases

- **One release per fork commit.** The tag is `emdash-fork-` plus the first 9 characters of the submodule's commit.
- **Never replace an uploaded tarball.** The lockfile pins its hash, so a new upload breaks installs for every commit that points at the old one. A new fork commit gets a new release.
- **Never delete a release that a pushed commit still points at.** That breaks `pnpm install` for that commit.
- **Release from the pushed fork.** Push the fork branch before you release, so the commit in the release name exists on GitHub.
- **Keep binaries out of git.** `vendor/` stays in `.gitignore`. We chose release assets over committing tarballs for this reason.

## Try fork changes before releasing

To test unreleased fork changes, point the overrides at local packs for a while:

```bash
./scripts/emdash-fork.sh
sed -i -E 's#https://github.com/[^ ]+/releases/download/[^/]+/#file:vendor/emdash-fork/#' pnpm-workspace.yaml
pnpm install
pnpm build && pnpm dev
```

Do not commit that state. Run `./scripts/release-emdash-fork.sh` when the change is ready. It points the overrides back at a release.

## Proving a clone works without the submodule

We checked that the release alone is enough, with two runs:

1. **Local fresh clone.** We cloned into an empty directory without initializing the submodule. Then we ran `pnpm install --frozen-lockfile`, `pnpm run build` and `pnpm run deploy` against a throwaway Worker, and ran `scripts/e2e.ts` against it.
2. **Clean container.** A `node:24` container, Node 24.22 like Workers Builds, cloned from GitHub. Corepack supplied pnpm 11.9.0, the repo's `packageManager`. It ran the same three commands.

After each run we deleted the throwaway Worker and its D1, R2 and KV resources.

## How we got here

- **First:** `scripts/emdash-fork.sh` packed tarballs into `vendor/emdash-fork/`, and the overrides used `file:` paths. Every clone had to initialize the submodule and build the fork, which takes minutes.
- **Then: the Deploy to Cloudflare button.** The button builds a fresh copy of the repo with no `vendor/`. We considered committing the tarballs, about 6.6 MB per fork change, and chose GitHub release assets instead, to keep binaries out of the tree.
- **The exotic-subdependency block.** The first install from release URLs failed on `blockExoticSubdeps`. We turned that block off and rely on the lockfile's integrity hashes.
