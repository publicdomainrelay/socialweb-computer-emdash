# WebAssembly modules on celld

A Worker for [celld](https://github.com/denoland/celld). The bucket is [rustfs](https://github.com/rustfs/rustfs). `GET /run` loads a `com.publicdomainrelay.temp.wasm.module` record and its blob from the owner's PDS, checks the blob CID's SHA-256, and runs the module in a Dynamic Worker with `globalOutbound: null`. It runs the same `emdash-wasm-json-v1` runtime as the fork's Cloudflare runner, over rounds (ADR 0018).

It holds no OAuth sessions. It makes a round's calls itself only when they are all unauthenticated queries, such as `listRecords`. At the first call with an input, it stops and returns that round as `pending`.

## Run

```bash
NOW=2026-11-06T12:34:56.789Z ./scripts/celld.sh
```

```text
{"rounds":[{"entry":"set_status","calls":[{"nsid":"com.atproto.repo.listRecords","ok":true,"output":{"records":[]}}]}],"pending":{"entry":"set_status_write","calls":[{"input":{"collection":"xyz.statusphere.status","record":{"$type":"xyz.statusphere.status","createdAt":"2026-11-06T12:34:56.789Z","status":"🦋"},"repo":"did:plc:lpfuqerea3deuoyrn7ojser4"},"nsid":"com.atproto.repo.createRecord"}],"next":"set_status_done","state":{"status":"🦋"}}}
```

```bash
MODULE_ENTRY=clear_status ./scripts/celld.sh run | jq -c .result
```

## Call

```bash
curl -s --get http://127.0.0.1:8080/run \
  --data-urlencode did=did:plc:lpfuqerea3deuoyrn7ojser4 \
  --data-urlencode rkey=statusphere \
  --data-urlencode entry=set_status \
  --data-urlencode status=🦋 \
  --data-urlencode now=2026-11-06T12:34:56.789Z | jq .
```

```bash
STATUS=🙂 MODULE_DID="$(curl -s "https://$ATPROTO_HANDLE/.well-known/atproto-did")" ./scripts/celld.sh run
```

## Steps

```bash
./scripts/celld.sh install
./scripts/celld.sh up
./scripts/celld.sh run
./scripts/celld.sh deploy
./scripts/celld.sh diagnose
./scripts/celld.sh down
```

```text
install    celld v0.6.3 and rustfs 1.0.4 into .celld/; esbuild and emdash come from pnpm install
up         rustfs on 127.0.0.1:9000, bucket celld, celld deploy, celld node on 127.0.0.1:8080
deploy     redeploy celld/ and POST /reload on 127.0.0.1:8081
diagnose   celld diagnose: bucket conditional writes and node probe
down       stop celld, then rustfs
```

```bash
CELLD_HOME=/tmp/celld CELLD_PORT=8787 CELLD_INTERNAL_PORT=8788 RUSTFS_PORT=9100 ./scripts/celld.sh
```

## Layout

```text
celld/wrangler.jsonc        worker_loaders binding LOADER
celld/src/index.js          GET /run
celld/package.json          @scure/base, emdash (fork tarball) and esbuild
.celld/                     binaries, credentials.env, rustfs data, celld state, logs (gitignored)
```

## Limits

```text
module 4 MiB   input 1 MiB   output 1 MiB   memory 1024 pages   cpuMs 5000   wall 5000 ms
rounds 8   calls per round 10   calls per run 25
```
