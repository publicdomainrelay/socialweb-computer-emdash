#!/usr/bin/env bash
set -euo pipefail

ACTOR="${1:?Usage: verify-source.sh <handle-or-did> <module-rkey>}"
MODULE="${2:?Usage: verify-source.sh <handle-or-did> <module-rkey>}"
ENGINE="${CONTAINER_ENGINE:-$(command -v podman || command -v docker)}"

doc="$(goat resolve "$ACTOR")"
did="$(jq -r .id <<<"$doc")"
pds="$(jq -r '.service[] | select(.id == "#atproto_pds") | .serviceEndpoint' <<<"$doc")"

get() {
	local uri="$1" rest
	rest="${uri#at://}"
	curl -fsS "$pds/xrpc/com.atproto.repo.getRecord?repo=${rest%%/*}&collection=$(cut -d/ -f2 <<<"$rest")&rkey=${rest##*/}"
}

module="$(get "at://$did/com.fedfork.exec.wasm.module/$MODULE")"
source_uri="$(jq -r '.value.source.uri // empty' <<<"$module")"
[ -n "$source_uri" ] || { echo "at://$did/com.fedfork.exec.wasm.module/$MODULE has no source" >&2; exit 1; }
manifest="$(get "$source_uri")"
[ "$(jq -r .cid <<<"$manifest")" = "$(jq -r .value.source.cid <<<"$module")" ] || { echo "manifest CID does not match the module's source reference" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/src"

while read -r entry; do
	path="$(jq -r .path <<<"$entry")"
	case "$path" in /* | *..*) echo "refusing path $path" >&2; exit 1 ;; esac
	file="$(get "$(jq -r .file.uri <<<"$entry")")"
	[ "$(jq -r .cid <<<"$file")" = "$(jq -r .file.cid <<<"$entry")" ] || { echo "$path: CID does not match the manifest" >&2; exit 1; }
	mkdir -p "$work/src/$(dirname "$path")"
	jq -j .value.text <<<"$file" >"$work/src/$path"
	[ "$(sha256sum "$work/src/$path" | cut -d' ' -f1)" = "$(jq -r .value.sha256 <<<"$file")" ] || { echo "$path: sha256 does not match its record" >&2; exit 1; }
done < <(jq -c '.value.files[]' <<<"$manifest")
chmod +x "$work/src"/*.sh 2>/dev/null || true

tool="$(jq -r .value.build.tool <<<"$manifest")"
version="$(jq -r .value.build.version <<<"$manifest")"
command="$(jq -r .value.build.command <<<"$manifest")"
artifact="$(jq -r .value.build.artifact <<<"$manifest")"
case "$tool" in
	cargo)
		image="docker.io/library/rust:$(awk '{print $2}' <<<"$version")"
		setup="rustup target add wasm32-unknown-unknown >/dev/null"
		;;
	asc)
		image="docker.io/library/node:24"
		setup="true"
		;;
	*) echo "unknown build tool $tool" >&2; exit 1 ;;
esac

echo "building $(jq -r .value.name <<<"$manifest") with '$command' in $image" >&2
"$ENGINE" run --rm -v "$work/src:/src:Z" -w /src "$image" bash -c "$setup && $command" >&2

built="$(sha256sum "$work/src/$artifact" | cut -d' ' -f1)"
expected="$(jq -r .value.output.sha256 <<<"$manifest")"
blob_cid="$(jq -r .value.module.ref.\"\$link\" <<<"$module")"
curl -fsS -o "$work/published.wasm" "$pds/xrpc/com.atproto.sync.getBlob?did=$did&cid=$blob_cid"
published="$(sha256sum "$work/published.wasm" | cut -d' ' -f1)"

jq -n --arg built "$built" --arg manifest "$expected" --arg published "$published" \
	'{built: $built, manifest: $manifest, published: $published, reproducible: ($built == $manifest and $built == $published)}'
[ "$built" = "$expected" ] && [ "$built" = "$published" ]
