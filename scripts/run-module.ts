// Run a local wasm module through the plugin's runModule (proxy, service, attest) with an
// app-password session instead of a site and OAuth:
//   ATPROTO_HANDLE=... ATPROTO_PASSWORD=... node scripts/run-module.ts module.wasm module.json entry '{"json":"input"}'
// The attestation key is sealed in RUN_MODULE_STATE (default .run-module-state.json) next to
// its sealing key, so keep that file private; reuse it so bind_key and later signatures share a key.
import { readFile, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";

registerHooks({
	resolve(specifier, context, next) {
		try {
			return next(specifier, context);
		} catch (error) {
			if (!specifier.startsWith(".")) throw error;
			return next(`${specifier}.ts`, context);
		}
	},
});
const { MODULE_COLLECTION, runModule } = await import("../plugins/atproto-integrations-emdash/src/modules.ts");

const env = (name: string, fallback?: string) => {
	const value = process.env[name] ?? fallback;
	if (!value) throw new Error(`Set ${name}`);
	return value;
};
const [wasmPath, manifestPath, entry, inputJson = "{}"] = process.argv.slice(2);
if (!wasmPath || !manifestPath || !entry) throw new Error("usage: node scripts/run-module.ts module.wasm module.json entry [json input]");

const STATE = env("RUN_MODULE_STATE", ".run-module-state.json");
type Store = Record<string, unknown>;
const state: { settings: Store; attest_keys: Store; managed_records: Store } = {
	settings: {},
	attest_keys: {},
	managed_records: {},
	...(await readFile(STATE, "utf8")
		.then((text) => JSON.parse(text))
		.catch(() => ({}))),
};
const save = () => writeFile(STATE, JSON.stringify(state, null, "\t"), { mode: 0o600 });
const kv = (store: Store) => ({
	get: async (key: string) => store[key] ?? null,
	compareAndSet: async (key: string, expected: string | null, value: unknown) => {
		if (expected !== null || store[key] !== undefined) return { applied: false };
		store[key] = value;
		await save();
		return { applied: true };
	},
	put: async (key: string, value: unknown) => {
		store[key] = value;
		await save();
	},
	delete: async (key: string) => {
		delete store[key];
		await save();
	},
});

const pdsEntry = env("ATPROTO_PDS", "https://bsky.social");
const created = await fetch(`${pdsEntry}/xrpc/com.atproto.server.createSession`, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ identifier: env("ATPROTO_HANDLE"), password: env("ATPROTO_PASSWORD") }),
});
const session = (await created.json()) as { did: string; accessJwt: string; didDoc?: { service?: Array<{ id: string; serviceEndpoint: string }> } };
if (!created.ok) throw new Error(`createSession failed: ${JSON.stringify(session)}`);
const pds = session.didDoc?.service?.find((service) => service.id === "#atproto_pds")?.serviceEndpoint ?? pdsEntry;

const agent = {
	userId: "local",
	account: session.did,
	scope: async () => "atproto",
	call: async <T>(nsid: string, init: { params?: Record<string, string>; input?: unknown; headers?: Record<string, string> } = {}) => {
		const response = await fetch(`${pds}/xrpc/${nsid}${init.params ? `?${new URLSearchParams(init.params)}` : ""}`, {
			method: init.input === undefined ? "GET" : "POST",
			headers: { ...init.headers, authorization: `Bearer ${session.accessJwt}`, ...(init.input !== undefined && { "content-type": "application/json" }) },
			body: init.input === undefined ? undefined : JSON.stringify(init.input),
		});
		const body = (await response.json().catch(() => ({}))) as T & { error?: string; message?: string };
		if (!response.ok) throw new Error(`${nsid} failed with ${body.error ?? response.status}${body.message ? `: ${body.message}` : ""}`);
		return body;
	},
	upload: async () => {
		throw new Error("upload is not supported here");
	},
};

const wasm = new Uint8Array(await readFile(wasmPath));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", wasm));
const { base32nopad } = await import("../plugins/atproto-integrations-emdash/node_modules/@scure/base/index.js");
const blobCid = `b${base32nopad.encode(Uint8Array.from([0x01, 0x55, 0x12, 0x20, ...digest])).toLowerCase()}`;
const record = {
	abi: "emdash-wasm-json-v1",
	name: manifest.name,
	module: { $type: "blob", ref: { $link: blobCid }, mimeType: "application/wasm", size: wasm.length },
	session: { uri: `at://${session.did}/com.fedfork.exec.oauth.clientMetadata/${manifest.session}` },
	actions: manifest.actions,
	calls: manifest.calls,
};

const ctx = {
	plugin: { id: "atproto-integrations" },
	log: console,
	settings: kv(state.settings),
	storage: { attest_keys: kv(state.attest_keys), managed_records: kv(state.managed_records) },
	// The module record and blob come from the local files; everything else is the network.
	http: {
		fetch: async (url: string, init?: RequestInit) => {
			if (url.includes("/xrpc/com.atproto.repo.getRecord?") && url.includes(`collection=${MODULE_COLLECTION}`)) return Response.json({ value: record });
			if (url.includes("/xrpc/com.atproto.sync.getBlob?")) return new Response(wasm);
			return fetch(url, init);
		},
	},
	wasm: {
		run: async ({ module, entry: name, input }: { module: Uint8Array; entry: string; input: unknown }) => {
			const { exports } = new WebAssembly.Instance(new WebAssembly.Module(module), {}) as unknown as {
				exports: Record<string, (...args: number[]) => bigint | number> & { memory: WebAssembly.Memory };
			};
			const data = new TextEncoder().encode(JSON.stringify(input));
			const ptr = exports.alloc(data.length) as number;
			new Uint8Array(exports.memory.buffer, ptr, data.length).set(data);
			const packed = BigInt.asUintN(64, exports[name](ptr, data.length) as bigint);
			return JSON.parse(new TextDecoder().decode(new Uint8Array(exports.memory.buffer, Number(packed >> 32n), Number(packed & 0xffffffffn))));
		},
	},
};

const ran = await runModule(ctx as never, async () => agent as never, { did: session.did, rkey: "local" }, entry, JSON.parse(inputJson));
console.log(JSON.stringify(ran, null, "\t"));
