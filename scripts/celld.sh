#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOME_DIR="${CELLD_HOME:-$ROOT/.celld}"
BIN="$HOME_DIR/bin"
CELLD_VERSION="${CELLD_VERSION:-v0.6.3}"
RUSTFS_VERSION="${RUSTFS_VERSION:-1.0.4}"
ESBUILD_VERSION="${ESBUILD_VERSION:-0.28.2}"
S3_PORT="${RUSTFS_PORT:-9000}"
WORKER_PORT="${CELLD_PORT:-8080}"
INTERNAL_PORT="${CELLD_INTERNAL_PORT:-8081}"
BUCKET="${CELLD_BUCKET_NAME:-celld}"
ENDPOINT="http://127.0.0.1:$S3_PORT"
CREDENTIALS="$HOME_DIR/credentials.env"
MODULE_DID="${MODULE_DID:-did:plc:lpfuqerea3deuoyrn7ojser4}"

export PATH="$BIN:$PATH"
export CELLD_ESBUILD="$HOME_DIR/esbuild/node_modules/.bin/esbuild"
export AWS_REGION=us-east-1

install() {
	mkdir -p "$BIN" "$HOME_DIR/dl"
	case "$(uname -s)-$(uname -m)" in
		Linux-x86_64) celld_target=x86_64-unknown-linux-gnu rustfs_target=linux-x86_64-musl ;;
		Linux-aarch64) celld_target=aarch64-unknown-linux-gnu rustfs_target=linux-aarch64-musl ;;
		Darwin-arm64) celld_target=aarch64-apple-darwin rustfs_target=macos-aarch64 ;;
		*) echo "unsupported platform $(uname -s) $(uname -m)" >&2 && exit 1 ;;
	esac

	if [ "$("$BIN/celld" --version 2>/dev/null)" != "celld ${CELLD_VERSION#v}" ]; then
		curl -fsSL "https://github.com/denoland/celld/releases/download/$CELLD_VERSION/celld-$celld_target.gz" \
			-o "$HOME_DIR/dl/celld.gz"
		if command -v gh >/dev/null; then gh attestation verify "$HOME_DIR/dl/celld.gz" --repo denoland/celld; fi
		gzip -dc "$HOME_DIR/dl/celld.gz" >"$BIN/celld"
		chmod 755 "$BIN/celld"
	fi

	if ! "$BIN/rustfs" --version 2>/dev/null | grep -q "^rustfs $RUSTFS_VERSION$"; then
		zip="rustfs-$rustfs_target-v$RUSTFS_VERSION.zip"
		base="https://github.com/rustfs/rustfs/releases/download/$RUSTFS_VERSION"
		rm -rf "$HOME_DIR/dl/rustfs" && mkdir -p "$HOME_DIR/dl/rustfs"
		curl -fsSL "$base/$zip" -o "$HOME_DIR/dl/rustfs/$zip"
		curl -fsSL "$base/SHA256SUMS" -o "$HOME_DIR/dl/rustfs/SHA256SUMS"
		(cd "$HOME_DIR/dl/rustfs" && grep " $zip\$" SHA256SUMS | sha256sum -c -)
		unzip -o -q "$HOME_DIR/dl/rustfs/$zip" -d "$HOME_DIR/dl/rustfs/x"
		command install -m 755 "$HOME_DIR/dl/rustfs/x/rustfs" "$BIN/rustfs"
	fi

	[ -x "$CELLD_ESBUILD" ] || npm install --silent --prefix "$HOME_DIR/esbuild" "esbuild@$ESBUILD_VERSION"

	tarball="$(ls "$ROOT"/vendor/emdash-fork/emdash-[0-9]*.tgz 2>/dev/null | head -n 1 || true)"
	[ -n "$tarball" ] || "$ROOT/scripts/emdash-fork.sh"
	tarball="$(ls "$ROOT"/vendor/emdash-fork/emdash-[0-9]*.tgz | head -n 1)"
	mkdir -p "$ROOT/celld/vendor/emdash"
	tar -xzf "$tarball" -O package/dist/plugins/wasm.mjs >"$ROOT/celld/vendor/emdash/wasm.mjs"

	celld --version
	rustfs --version | head -n 1
	"$CELLD_ESBUILD" --version
}

credentials() {
	if [ ! -f "$CREDENTIALS" ]; then
		(umask 077 && printf 'AWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\n' \
			"$(openssl rand -hex 10)" "$(openssl rand -hex 20)" >"$CREDENTIALS")
	fi
	set -a
	. "$CREDENTIALS"
	set +a
}

wait_for() {
	for _ in $(seq 1 60); do
		curl -s -o /dev/null ${2:-} "$1" && return 0
		sleep 0.5
	done
	echo "timed out waiting for $1" >&2
	exit 1
}

start() {
	name="$1"
	shift
	if [ -f "$HOME_DIR/$name.pid" ] && kill -0 "$(cat "$HOME_DIR/$name.pid")" 2>/dev/null; then return 0; fi
	nohup "$@" >"$HOME_DIR/$name.log" 2>&1 &
	echo $! >"$HOME_DIR/$name.pid"
}

up() {
	credentials
	mkdir -p "$HOME_DIR/rustfs/data" "$HOME_DIR/rustfs/logs" "$HOME_DIR/celld"
	RUSTFS_ACCESS_KEY="$AWS_ACCESS_KEY_ID" RUSTFS_SECRET_KEY="$AWS_SECRET_ACCESS_KEY" \
		RUSTFS_ADDRESS="127.0.0.1:$S3_PORT" RUSTFS_CONSOLE_ENABLE=false \
		RUSTFS_OBS_LOG_DIRECTORY="$HOME_DIR/rustfs/logs" \
		start rustfs rustfs server "$HOME_DIR/rustfs/data"
	wait_for "$ENDPOINT/health/ready" -f

	printf 'user = "%s:%s"\n' "$AWS_ACCESS_KEY_ID" "$AWS_SECRET_ACCESS_KEY" >"$HOME_DIR/curl.cfg"
	chmod 600 "$HOME_DIR/curl.cfg"
	if ! curl -fs -o /dev/null -K "$HOME_DIR/curl.cfg" --aws-sigv4 "aws:amz:$AWS_REGION:s3" -I "$ENDPOINT/$BUCKET"; then
		curl -fsS -K "$HOME_DIR/curl.cfg" --aws-sigv4 "aws:amz:$AWS_REGION:s3" -X PUT "$ENDPOINT/$BUCKET"
	fi

	deploy
	CELLD_WATCH="$HOME_DIR/celld" start celld celld --bucket "s3://$BUCKET" --endpoint "$ENDPOINT" \
		--region "$AWS_REGION" --listen "127.0.0.1:$WORKER_PORT" --internal-listen "127.0.0.1:$INTERNAL_PORT"
	wait_for "http://127.0.0.1:$WORKER_PORT/"
	echo "celld http://127.0.0.1:$WORKER_PORT rustfs $ENDPOINT"
}

deploy() {
	credentials
	celld deploy "$ROOT/celld" --bucket "s3://$BUCKET" --endpoint "$ENDPOINT" --region "$AWS_REGION"
	if curl -fs -o /dev/null -X POST "http://127.0.0.1:$INTERNAL_PORT/reload"; then echo reloaded; fi
}

diagnose() {
	credentials
	celld diagnose --bucket "s3://$BUCKET" --endpoint "$ENDPOINT" --region "$AWS_REGION" --listen 127.0.0.1:0
}

run() {
	curl -sS --get "http://127.0.0.1:$WORKER_PORT/run" \
		--data-urlencode "did=$MODULE_DID" \
		--data-urlencode "rkey=${MODULE_RKEY:-statusphere}" \
		--data-urlencode "entry=${MODULE_ENTRY:-set_status}" \
		--data-urlencode "status=${STATUS:-🦋}" \
		--data-urlencode "now=${NOW:-$(date -u +%Y-%m-%dT%H:%M:%S.000Z)}"
	echo
}

down() {
	for name in celld rustfs; do
		if [ -f "$HOME_DIR/$name.pid" ]; then
			pid="$(cat "$HOME_DIR/$name.pid")"
			kill "$pid" 2>/dev/null || true
			for _ in $(seq 1 60); do
				kill -0 "$pid" 2>/dev/null || break
				sleep 0.5
			done
			rm -f "$HOME_DIR/$name.pid"
		fi
	done
}

case "${1:-all}" in
	install) install ;;
	up) up ;;
	deploy) deploy ;;
	run) run ;;
	diagnose) diagnose ;;
	down) down ;;
	all) install && up && run ;;
	*) echo "usage: $0 [install|up|deploy|run|diagnose|down|all]" >&2 && exit 1 ;;
esac
