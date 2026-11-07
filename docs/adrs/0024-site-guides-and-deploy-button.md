# 0024. The site as its own guide, and a Deploy to Cloudflare button

Status: accepted. Amends 0022.

## Context

The README explained the project, but someone landing on the site saw only a sign-in page. Deploying your own copy took a clone, a submodule, a fork build of several minutes, hand-made D1 and R2 resources, and edits to a config that held this site's IDs and domain.

Cloudflare's Deploy to Cloudflare button copies a public repo into the user's GitHub. It provisions the resources named in the root `wrangler.jsonc`, asks for the secrets listed in `.dev.vars.example`, and runs the `build` and `deploy` scripts from the root `package.json`.

## Decision

- **Guide pages.** The site has `/how-it-works`, `/use`, `/modules` and `/deploy`, plus an overview at `/`.
- **Diagrams.** Pele renders the Mermaid diagrams to SVG on the server.
  - Every diagram lives in `site/src/diagrams.ts`.
  - They share one palette of `classDef` colors: translucent fills with saturated strokes. These read in light and dark themes.
  - The site maps Pele's CSS variables to its own tokens.
- **Root config.** `wrangler.jsonc` moves to the repo root, and `site/astro.config.mjs` points the Cloudflare adapter at it.
  - Its top level has no resource IDs and no domain. Wrangler, or the button, creates D1, R2 and KV named after the Worker.
  - Later deploys reuse the resources already bound to the Worker.
- **This site's deploy.** The deploy at `exec.fedfork.com` is `env.fedfork`, with its domain, `EMDASH_SITE_URL` and resource IDs pinned. Use `pnpm run deploy:fedfork`.
- **Root scripts.**
  - `pnpm run build` builds the plugin.
  - `pnpm run deploy` builds the plugin and the site, then runs `wrangler deploy --config dist/server/wrangler.json`.
  - Pointing wrangler at the generated config is needed. Otherwise it finds both the root config and the adapter's redirect file and refuses to choose.
  - The deploy script hides `CLOUDFLARE_ENV` from wrangler with `env -u`. The adapter already flattens the chosen environment into the generated config. If wrangler also sees the variable, it appends the environment to the Worker name, deploys a second Worker, and moves the custom domain to it.
- **Fork packages.** The EmDash fork's packages are tarballs on a GitHub release of this repo, `emdash-fork-<commit>`.
  - `pnpm-workspace.yaml` overrides `emdash` and `@emdash-cms/*` with their URLs.
  - `scripts/release-emdash-fork.sh` packs, uploads and repoints them.
  - `blockExoticSubdeps` is off, because pnpm treats these URL overrides as exotic subdependencies.
  - The lockfile still pins every tarball's integrity hash.
  - We chose a release over committing the tarballs, so binaries stay out of the tree.
- **Encryption key.** `EMDASH_ENCRYPTION_KEY` is listed in `.dev.vars.example`, with a generator command in the binding descriptions in `package.json`.

## Consequences

- A fresh clone installs without the submodule and deploys with one command. This was verified by cloning into an empty directory, deploying to a throwaway Worker, and running `scripts/e2e.ts` against it.
- `EMDASH_ENCRYPTION_KEY` is required in practice. Without it, connecting an integration fails with `Plugin secret settings require EMDASH_ENCRYPTION_KEY`.
- A brand-new deploy can answer 404 for the first few seconds while D1 migrates.
- Running plain `pnpm run deploy` on this account would rebind the `socialweb-computer-emdash` Worker to new, empty resources.
- Changing the fork now means cutting a new `emdash-fork-<commit>` release before the site can use it.
- The button flow itself runs in Cloudflare's dashboard. Its build steps are the same scripts we tested.
